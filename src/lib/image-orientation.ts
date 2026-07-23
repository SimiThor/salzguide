// Bild aufrecht laden - EXIF-Orientierung zuverlässig auf ALLEN Geräten.
//
// createImageBitmap(file, { imageOrientation: "from-image" }) wird von Safari < 17 STILL
// ignoriert (kein Fehler) -> Handy-Fotos lägen dort quer. Ein <img>-Element wendet die
// EXIF-Orientierung dagegen seit Jahren automatisch an (CSS `image-orientation: from-image`
// ist Default seit Chrome/Firefox 2020 und Safari 13.1). Wir dekodieren also über <img>,
// zeichnen das (bereits aufrechte) Bild auf ein Canvas und geben davon eine ImageBitmap
// zurück - dieselbe Schnittstelle wie createImageBitmap, aber überall gleich ausgerichtet.
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
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Kein 2D-Kontext");
    ctx.drawImage(img, 0, 0);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
