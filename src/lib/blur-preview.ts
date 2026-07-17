// Läuft ausschließlich serverseitig (sharp ist ein natives Modul – ein Client-Import
// bricht den Build ab). Bewusst OHNE "server-only", damit scripts/backfill-blur.ts
// dieselbe Funktion nutzen kann: Backfill und Upload müssen identische Vorschauen
// erzeugen, sonst sehen nachgezogene Bilder anders aus als neu hochgeladene.
import sharp from "sharp";
import { IMMUTABLE_CACHE_SECONDS } from "./storage";

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

// Die Vorschau-URL, die beim Speichern in die DB gehört. EINE Regel für alle
// Schreibpfade, damit Upload und Backfill sich identisch verhalten.
//
// Erzeugt NUR neu, wenn sich die Bild-URL wirklich geändert hat. Ohne diese Prüfung
// würde jedes Speichern (auch reine Textänderungen) das Foto erneut laden und durch
// sharp schicken – und schlimmer: Scheitert der Download dabei einmal, stünde plötzlich
// null in der Spalte und eine funktionierende Vorschau wäre still verloren.
//
// Bildwechsel erkennen wir an der URL. Uploads erzeugen einen neuen UUID-Dateinamen,
// ein anderes Foto hat also immer eine andere URL. Wird eine Datei in der Storage unter
// GLEICHEM Namen überschrieben, bleibt die alte Vorschau stehen -> dann `--force`.
export async function blurPreviewFor(
  storage: StorageApi,
  newUrl: string | null | undefined,
  prevUrl: string | null | undefined,
  prevPreviewUrl: string | null | undefined,
): Promise<string | null> {
  const unchanged = !!newUrl && newUrl === prevUrl && !!prevPreviewUrl;
  if (unchanged) return prevPreviewUrl!; // nichts zu tun, alte Vorschau behalten

  // Ab hier wird die alte Vorschau (falls es eine gab) nicht mehr gebraucht.
  const stale = prevPreviewUrl ? pathFromPublicUrl(prevPreviewUrl) : null;

  let next: string | null = null;
  if (newUrl) {
    const buf = await renderPreview(newUrl);
    if (buf) {
      const path = `${PREVIEW_DIR}/${crypto.randomUUID()}.webp`;
      const { error } = await storage.from(BUCKET).upload(path, buf, {
        contentType: "image/webp",
        upsert: false,
        // Der Dateiname ist einmalig – der Inhalt ändert sich nie (siehe lib/storage).
        cacheControl: IMMUTABLE_CACHE_SECONDS,
      });
      if (error) console.error("blurPreviewFor: upload failed", error.message);
      else next = storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }
  }

  // Alte Vorschau erst löschen, wenn die neue steht – sonst stünde bei einem Fehler
  // gar kein Bild mehr da. Scheitert das Löschen, bleibt nur eine verwaiste Mini-Datei
  // liegen; das ist harmlos und darf das Speichern nicht kippen.
  if (stale && next !== prevPreviewUrl) {
    const { error } = await storage.from(BUCKET).remove([stale]);
    if (error) console.error("blurPreviewFor: cleanup failed", error.message);
  }

  return next;
}
