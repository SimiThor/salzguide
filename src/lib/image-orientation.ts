// Bild aufrecht laden - EXIF-Orientierung zuverlässig auf ALLEN Geräten.
//
// createImageBitmap(file, { imageOrientation: "from-image" }) wird von Safari < 17 STILL
// ignoriert (kein Fehler) -> Handy-Fotos lägen dort quer. Ein <img>-Element wendet die
// EXIF-Orientierung dagegen seit Jahren automatisch an (CSS `image-orientation: from-image`
// ist Default seit Chrome/Firefox 2020 und Safari 13.1). Wir dekodieren also über <img>,
// zeichnen das (bereits aufrechte) Bild auf ein Canvas und geben davon eine ImageBitmap
// zurück - dieselbe Schnittstelle wie createImageBitmap, aber überall gleich ausgerichtet.

/**
 * Obergrenze für das Zwischen-Canvas, in Pixeln (Fläche) und langer Kante.
 *
 * WARUM DAS DIE WICHTIGSTE ZEILE DIESER DATEI IST:
 * Safari auf iOS gibt Canvas über ~16,7 Mio. Pixel (4096²) einfach auf. Es wirft KEINEN
 * Fehler - `drawImage` läuft durch, und das Canvas bleibt leer. Ein 48-MP-Foto vom iPhone
 * (8064×6048) wurde damit zu einem weissen Bild, das brav komprimiert und in den Storage
 * gelegt wurde. Niemand sieht den Fehler, bis das Bild auf der Seite steht.
 *
 * 12 MP mit maximal 4096 langer Kante liegt sicher unter jedem bekannten Limit und immer
 * noch weit über allem, was hinterher herauskommt (Hero 2048, Foto 1600, Story 1080). Die
 * Verkleinerung kostet also keine sichtbare Qualität - sie passiert ohnehin gleich danach.
 *
 * Zweiter Gewinn: Speicher. Ein 48-MP-Canvas belegt ~190 MB RGBA, und bis createImageBitmap
 * fertig ist, liegen zwei davon nebeneinander. Genau daran starben Uploads auf älteren
 * Handys.
 */
const MAX_DECODE_PIXELS = 12_000_000;
const MAX_DECODE_EDGE = 4096;

/** Faktor <= 1, der (w, h) unter beide Grenzen bringt. 1 = passt schon. */
function decodeScale(w: number, h: number): number {
  return Math.min(1, MAX_DECODE_EDGE / Math.max(w, h), Math.sqrt(MAX_DECODE_PIXELS / (w * h)));
}

export async function loadOrientedBitmap(file: File): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("Bild konnte nicht dekodiert werden");
    // naturalWidth/Height sind bereits die AUFRECHTEN Maße; drawImage zeichnet das aufrechte Bild.
    const scale = decodeScale(w, h);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Kein 2D-Kontext");
    // Ohne diese Zeile filtert Chrome beim Verkleinern grob ("low") und ein Foto bekommt
    // ausgefranste Kanten. Kostet bei einem einzelnen Bild nichts Messbares.
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cw, ch);
    const bitmap = await createImageBitmap(canvas);
    // Zwischenspeicher freigeben, statt auf den Aufräumer zu warten.
    //
    // Bis hierher liegen drei Fassungen desselben Fotos im Speicher: das dekodierte <img>
    // in voller Grösse (bei 48 MP ~190 MB RGBA), das Canvas und die fertige Bitmap. Nur
    // die Bitmap wird noch gebraucht, und PhotoUploader hat bis zu drei Fotos gleichzeitig
    // in Arbeit. canvas.width = 0 wirft den Canvas-Puffer weg, src = "" nimmt dem <img>
    // sein Bild; beides nach createImageBitmap, die Bitmap ist eine eigene Kopie.
    //
    // Ehrlichkeitshalber: Das ist Hygiene, kein gemessener Fix. Ein Testlauf mit
    // synthetischen 32-MB-PNGs liess den dritten Dekodier-Vorgang sterben, aber daran
    // änderten diese Zeilen nichts - mit echten Kamera-JPEGs trat der Fall gar nicht auf.
    canvas.width = 0;
    canvas.height = 0;
    img.src = "";
    return bitmap;
  } finally {
    URL.revokeObjectURL(url);
  }
}
