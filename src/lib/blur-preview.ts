// Läuft ausschließlich serverseitig (sharp ist ein natives Modul – ein Client-Import
// bricht den Build ab). Bewusst OHNE "server-only", damit scripts/backfill-blur.ts
// dieselbe Funktion nutzen kann: Backfill und Upload müssen identische Vorschauen
// erzeugen, sonst sehen nachgezogene Bilder anders aus als neu hochgeladene.
import sharp from "sharp";

// Erzeugt die winzige Blur-Vorschau für gesperrte Pro-Inhalte (siehe Migration 0034).
//
// Kernidee: Das Bild wird auf PREVIEW_WIDTH heruntergerechnet, BEVOR es den Server
// verlässt. Der Client bekommt damit physisch keine Details mehr – im Gegensatz zu
// einem CSS-Blur auf dem Originalbild, der sich in den DevTools einfach abschalten
// lässt. Der optische Weichzeichner in der UI ist dann nur noch Kosmetik auf einem
// Bild, das ohnehin keine Details enthält.
//
// 160px dient der CONVERSION, nicht der Geheimhaltung: Das Motiv soll WIRKEN
// ("türkise Schlucht mit Steg") – die Fotos sind das beste Verkaufsargument, ein
// dunkler Matsch verkauft nichts. Was Pro wert ist, sind Name und exakte Lage, und
// die verlassen den Server ohnehin nie (Titel geschwärzt, Koordinaten auf ~1 km
// gerundet). Gegen jemanden, der ernsthaft Aufwand betreibt, schützt eine kleinere
// Vorschau nicht – der findet den Ort auch durch Recherche.
//
// Kosten im Blick behalten: Die Vorschau geht als Text in JEDE Seite, in der der Spot
// vorkommt (bei mehreren Karussells also mehrfach). ~5-10 kB pro Bild sind bei wenigen
// Geheimtipps irrelevant; bei vielen gesperrten Spots auf einer Seite summiert sich das
// und der Wert gehört überprüft.
// ACHTUNG: Wird dieser Wert geändert, sind bestehende Vorschauen veraltet. Sie
// werden NICHT automatisch neu gebaut -> `npm run backfill:blur -- --force`.
const PREVIEW_WIDTH = 160;
const PREVIEW_QUALITY = 72;
// Schutz gegen absurd große Quellbilder (Speicher) – 25 MB reicht für jedes Hero-Foto.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

// Liefert "data:image/webp;base64,..." oder null, wenn das Bild nicht lesbar ist.
// Wirft NIE: Ein fehlendes Vorschaubild darf niemals das Speichern eines Spots oder
// einen Seitenaufruf kippen – die UI fällt dann auf den Emoji-Platzhalter zurück.
export async function buildBlurPreview(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("buildBlurPreview: fetch failed", res.status, imageUrl);
      return null;
    }

    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_SOURCE_BYTES) {
      console.error("buildBlurPreview: source too large", len, imageUrl);
      return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_SOURCE_BYTES) {
      console.error("buildBlurPreview: source too large", buf.byteLength, imageUrl);
      return null;
    }

    const out = await sharp(buf)
      .rotate() // EXIF-Ausrichtung anwenden, sonst kippt die Vorschau gegen das Original
      .resize(PREVIEW_WIDTH, null, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: PREVIEW_QUALITY })
      .toBuffer();

    return `data:image/webp;base64,${out.toString("base64")}`;
  } catch (e) {
    console.error("buildBlurPreview:", e instanceof Error ? e.message : e);
    return null;
  }
}

// Die Vorschau, die beim Speichern in die DB gehört. EINE Regel für alle Schreibpfade
// (Spot-Fotos und Tour-Stopp-Fotos), damit sich beide gleich verhalten.
//
// Erzeugt NUR neu, wenn sich die Bild-URL wirklich geändert hat. Das ist wichtig:
//   - Ohne diese Prüfung würde jedes Speichern (auch reine Textänderungen) das Foto
//     erneut laden und durch sharp schicken – unnötige Last bei jedem Klick.
//   - Und schlimmer: Scheitert der Download dabei einmal (Netzwerk), stünde plötzlich
//     null in der Spalte und eine funktionierende Vorschau wäre still verloren.
//
// Bildwechsel erkennen wir an der URL. Uploads erzeugen einen neuen UUID-Dateinamen,
// ein anderes Foto hat also immer eine andere URL. Wird eine Datei in der Storage unter
// GLEICHEM Namen überschrieben, bleibt die alte Vorschau stehen -> dann `--force`.
export async function blurPreviewFor(
  newUrl: string | null | undefined,
  prevUrl: string | null | undefined,
  prevBlur: string | null | undefined,
): Promise<string | null> {
  if (!newUrl) return null; // kein Bild (mehr) -> keine Vorschau, UI zeigt Emoji
  if (newUrl === prevUrl && prevBlur) return prevBlur; // unverändert -> behalten
  return buildBlurPreview(newUrl);
}
