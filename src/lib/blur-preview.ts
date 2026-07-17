// Läuft ausschließlich serverseitig (sharp ist ein natives Modul – ein Client-Import
// bricht den Build ab). Bewusst OHNE "server-only", damit scripts/backfill-blur.ts
// dieselbe Funktion nutzen kann: Backfill und Upload müssen identische Vorschauen
// erzeugen, sonst sehen nachgezogene Bilder anders aus als neu hochgeladene.
import sharp from "sharp";
// Endung PFLICHT: scripts/backfill-blur.ts lädt diese Datei mit Nodes ESM-Loader, und der
// rät keine Endungen (siehe tsconfig, allowImportingTsExtensions). Ohne ".ts" baut Next
// weiterhin fehlerfrei – nur `npm run backfill:blur` stirbt beim Start.
import { IMMUTABLE_CACHE_SECONDS } from "./storage.ts";

// Vorschaubild für gesperrte Pro-Spots ("Geheimtipps").
//
// WARUM ALS DATEI, NICHT INLINE:
// Die Vorschau lag zuerst als data:-URI in der Seite. Das skaliert nicht: Bei ~65
// gesperrten Spots wären das ~0,6 MB HTML (gemessen), und Inline-Daten lassen sich
// NICHT lazy laden – sie stehen in der Seite, ob sichtbar oder nicht. Als echte Datei
// lädt der Browser nur, was ins Bild scrollt, und cacht sie danach.
//
// WARUM EIN EIGENER, ZUFÄLLIGER DATEINAME:
// Der Bucket ist öffentlich. Hieße die Vorschau wie das Original (nur in einem
// Unterordner), verriete ihre URL den Pfad zum vollen Foto. Deshalb bekommt jede
// Vorschau eine frische UUID ohne Bezug zum Original.
//
// 160px dient der CONVERSION, nicht der Geheimhaltung: Das Motiv soll WIRKEN
// ("türkise Schlucht mit Steg") – die Fotos sind das beste Verkaufsargument, ein
// dunkler Matsch verkauft nichts. Was Pro wert ist, sind Name und exakte Lage, und
// die verlassen den Server ohnehin nie (Titel geschwärzt, Koordinaten auf ~1 km
// gerundet). Gegen jemanden, der ernsthaft Aufwand betreibt, schützt eine kleinere
// Vorschau nicht – der findet den Ort auch durch Recherche.
//
// ACHTUNG: Wird PREVIEW_WIDTH geändert, sind bestehende Vorschauen veraltet. Sie
// werden NICHT automatisch neu gebaut -> `npm run backfill:blur -- --force`.
const PREVIEW_WIDTH = 160;
const PREVIEW_QUALITY = 72;
const BUCKET = "spot-media";
const PREVIEW_DIR = "previews";
// Schutz gegen absurd große Quellbilder (Speicher) – 25 MB reicht für jedes Hero-Foto.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

// Nur der Teil der Supabase-Storage-API, den wir brauchen. So können saveSpot (Admin-
// Session) und das Backfill (Service-Key) dieselbe Funktion mit ihrem eigenen Client
// aufrufen.
type StorageApi = {
  from(bucket: string): {
    upload(
      path: string,
      body: Buffer,
      opts?: { contentType?: string; upsert?: boolean; cacheControl?: string },
    ): Promise<{ error: { message: string } | null }>;
    remove(paths: string[]): Promise<{ error: { message: string } | null }>;
    getPublicUrl(path: string): { data: { publicUrl: string } };
  };
};

// Pfad im Bucket aus einer öffentlichen Storage-URL zurückgewinnen (zum Aufräumen).
// null, wenn die URL nicht aus unserem Bucket stammt.
function pathFromPublicUrl(url: string): string | null {
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
}

// Bild laden und auf PREVIEW_WIDTH herunterrechnen. null bei jedem Problem – ein
// fehlendes Vorschaubild darf nie das Speichern eines Spots kippen.
async function renderPreview(imageUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("renderPreview: fetch failed", res.status, imageUrl);
      return null;
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_SOURCE_BYTES) {
      console.error("renderPreview: source too large", len, imageUrl);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_SOURCE_BYTES) {
      console.error("renderPreview: source too large", buf.byteLength, imageUrl);
      return null;
    }
    return await sharp(buf)
      .rotate() // EXIF-Ausrichtung anwenden, sonst kippt die Vorschau gegen das Original
      .resize(PREVIEW_WIDTH, null, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: PREVIEW_QUALITY })
      .toBuffer();
  } catch (e) {
    console.error("renderPreview:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type PrevImageRow = { url: string; blur_url?: string | null };

export type ImageBlurPlan = {
  /** Vorschau je Bild-URL, soweit schon eine existiert. */
  blurByUrl: Map<string, string>;
  /** Hero-URL, falls dafür noch KEINE Vorschau da ist – sonst null (dann ist nichts zu tun). */
  heroNeedingPreview: string | null;
  /** Vorschauen von Fotos, die nicht mehr zum Spot gehören. */
  orphanPreviews: string[];
};

/**
 * Entscheidet aus altem und neuem Bildstand, WAS beim Speichern zu tun ist:
 * welche Vorschau schon da ist, welche fehlt, welche weg kann.
 *
 * Reine Rechnung, kein I/O – deshalb prüfbar, ohne etwas hochzuladen. Der Aufrufer führt
 * aus, was hier herauskommt (siehe saveSpot in lib/admin-actions.ts).
 *
 * Die eine Regel: Eine Vorschau gehört zum BILD, nicht zur Hero-Rolle. Wer ein Foto nach
 * vorn zieht, das schon einmal Hero war, bekommt dessen Vorschau geschenkt; und ein
 * Umsortieren kann nie eine funktionierende Vorschau wegwerfen, weil nur Vorschauen
 * entfernter FOTOS als verwaist gelten.
 */
export function planImageBlur(prevRows: PrevImageRow[], images: string[]): ImageBlurPlan {
  const blurByUrl = new Map<string, string>();
  for (const row of prevRows) {
    if (typeof row.url === "string" && row.blur_url) blurByUrl.set(row.url, row.blur_url);
  }

  // Vorschau NUR fürs Hero: Nur dieses eine Bild zeigen gesperrte Pro-Spots als
  // unscharfen Teaser (heroPreviewFromMedia in lib/spots.ts). Für Galeriebilder wäre es
  // Arbeit und Speicher für etwas, das nie jemand unscharf sieht.
  const heroUrl = images[0] ?? null;
  const heroNeedingPreview = heroUrl && !blurByUrl.has(heroUrl) ? heroUrl : null;

  const kept = new Set(images);
  const orphanPreviews = [...blurByUrl]
    .filter(([url]) => !kept.has(url))
    .map(([, preview]) => preview);

  return { blurByUrl, heroNeedingPreview, orphanPreviews };
}

// Vorschau zu EINEM Bild erzeugen und ablegen. null bei jedem Problem – ein fehlendes
// Vorschaubild darf nie das Speichern eines Spots kippen (die UI fällt dann auf das Emoji
// zurück, und `npm run backfill:blur` holt es später nach).
//
// Der Aufrufer entscheidet, WANN das nötig ist. Diese Funktion rendert immer: Sie ist
// teuer (Download + sharp), also darf sie nur laufen, wenn zu dem Bild wirklich noch
// keine Vorschau existiert.
export async function createBlurPreview(
  storage: StorageApi,
  imageUrl: string,
): Promise<string | null> {
  const buf = await renderPreview(imageUrl);
  if (!buf) return null;
  const path = `${PREVIEW_DIR}/${crypto.randomUUID()}.webp`;
  const { error } = await storage.from(BUCKET).upload(path, buf, {
    contentType: "image/webp",
    upsert: false,
    // Der Dateiname ist einmalig – der Inhalt ändert sich nie (siehe lib/storage).
    cacheControl: IMMUTABLE_CACHE_SECONDS,
  });
  if (error) {
    console.error("createBlurPreview: upload failed", error.message);
    return null;
  }
  return storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Vorschau-Dateien löschen, zu denen es kein Bild mehr gibt. Scheitert das Löschen,
// bleibt nur eine verwaiste ~5-KB-Datei liegen; das ist harmlos und darf das Speichern
// nicht kippen. Deshalb: nur loggen, nie werfen.
export async function removeBlurPreviews(
  storage: StorageApi,
  previewUrls: string[],
): Promise<void> {
  const paths = previewUrls
    .map((u) => pathFromPublicUrl(u))
    .filter((p): p is string => p !== null);
  if (!paths.length) return;
  const { error } = await storage.from(BUCKET).remove(paths);
  if (error) console.error("removeBlurPreviews: cleanup failed", error.message);
}

// Die Vorschau-URL für einen Schreibpfad, der pro Bild GENAU EINE Vorschau kennt und
// die alte beim Wechsel wegräumt. Genutzt vom Backfill (scripts/backfill-blur.ts).
//
// Erzeugt NUR neu, wenn sich die Bild-URL wirklich geändert hat. Ohne diese Prüfung
// würde jeder Lauf das Foto erneut laden und durch sharp schicken – und schlimmer:
// Scheitert der Download dabei einmal, stünde plötzlich null in der Spalte und eine
// funktionierende Vorschau wäre still verloren.
//
// Bildwechsel erkennen wir an der URL. Uploads erzeugen einen neuen UUID-Dateinamen,
// ein anderes Foto hat also immer eine andere URL. Wird eine Datei in der Storage unter
// GLEICHEM Namen überschrieben, bleibt die alte Vorschau stehen -> dann `--force`.
//
// ACHTUNG: saveSpot nutzt das bewusst NICHT. Dort gehört die Vorschau zum Bild und nicht
// zur Hero-Rolle, damit Umsortieren keine funktionierende Vorschau wegwirft – siehe den
// Kommentar bei den Fotos in lib/admin-actions.ts.
export async function blurPreviewFor(
  storage: StorageApi,
  newUrl: string | null | undefined,
  prevUrl: string | null | undefined,
  prevPreviewUrl: string | null | undefined,
): Promise<string | null> {
  const unchanged = !!newUrl && newUrl === prevUrl && !!prevPreviewUrl;
  if (unchanged) return prevPreviewUrl!; // nichts zu tun, alte Vorschau behalten

  const next = newUrl ? await createBlurPreview(storage, newUrl) : null;

  // Alte Vorschau erst löschen, wenn die neue steht – sonst stünde bei einem Fehler
  // gar kein Bild mehr da.
  if (prevPreviewUrl && next !== prevPreviewUrl) {
    await removeBlurPreviews(storage, [prevPreviewUrl]);
  }

  return next;
}
