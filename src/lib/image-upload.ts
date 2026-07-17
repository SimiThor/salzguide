// Bild im Browser verkleinern, komprimieren und in den Storage legen. EIN Weg für den ganzen Admin.
//
// Diese Funktion stand sechsmal fast wortgleich in den Admin-Formularen. Sechs Kopien
// heissen: Wer die Qualität anpasst, ändert eine davon, und die anderen fünf laden
// weiterhin das Alte.
//
// Läuft im Browser (createImageBitmap, canvas): nur aus Client-Komponenten aufrufen.
import { createClient } from "./supabase/client";
import { IMMUTABLE_CACHE_SECONDS } from "./storage";

/** Alle Admin-Medien liegen im selben Bucket, unter zufälligem Pfad. */
const BUCKET = "spot-media";

/**
 * Lange Kante der gespeicherten Fassung. 1600 deckt jedes Handy inklusive Retina ab;
 * für die Anzeige rechnet next/image ohnehin nochmal herunter. Ein 1600er Foto wiegt
 * so rund 200 KB, ein 2400er schon 600 KB, ohne dass man den Unterschied sähe.
 */
export const MAX_DIM = 1600;
/** Vollflächige Bilder (Hero) dürfen mehr, sie stehen quer über den ganzen Schirm. */
export const HERO_MAX_DIM = 2048;
/** Runde Porträts stehen nie grösser als ein paar Dutzend Pixel. */
export const AVATAR_DIM = 512;

const QUALITY = 0.82;
const AVATAR_QUALITY = 0.85;

/** Nur was der Browser wirklich kodieren kann. Der Wert landet 1:1 als MIME im Storage. */
const EXTENSION: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

export type CompressedImage = {
  blob: Blob;
  /** Masse NACH dem Verkleinern. next/image braucht sie, sonst springt das Layout. */
  width: number;
  height: number;
};

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob((b) => res(b), type, quality));
}

/** Weisser Grund statt Transparenz: JPEG kann kein Alpha, sonst würde es schwarz. */
function flatten(src: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas nicht verfügbar");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

/**
 * Kodiert das Canvas und PRÜFT, was dabei herauskam.
 *
 * `toBlob` mit einem Typ, den der Browser nicht kodieren kann, wirft keinen Fehler: Laut
 * Spec liefert er dann stillschweigend PNG. Genau das ist hier jahrelang passiert – im
 * Storage lagen 3-MB-PNGs unter dem Namen .webp, rund dreissigmal so schwer wie nötig.
 * Darum wird der Typ hier nicht geglaubt, sondern nachgesehen.
 *
 * JPEG als Rückfall ist kein Notnagel: Bei diesen Fotos ist es gleich gross wie WebP, und
 * next/image liefert dem Besucher ohnehin AVIF/WebP – egal, was im Storage liegt.
 */
export async function encodeCanvas(canvas: HTMLCanvasElement, quality = QUALITY): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp?.type === "image/webp") return webp;

  const jpeg = await toBlob(flatten(canvas), "image/jpeg", quality);
  if (jpeg?.type === "image/jpeg") return jpeg;

  throw new Error("Browser kann das Bild weder als WebP noch als JPEG speichern.");
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas nicht verfügbar");
  return [canvas, ctx];
}

/**
 * Skaliert auf die lange Kante `maxDim` herunter (nie hoch) und komprimiert.
 * Die tatsächlichen Masse kommen mit: Ein Bild ohne Masse zwingt next/image zu `fill`,
 * und dann muss jede Aufrufstelle das Seitenverhältnis selbst kennen.
 */
export async function compressImage(
  file: File,
  maxDim = MAX_DIM,
  quality = QUALITY,
): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const [canvas, ctx] = canvasOf(width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return { blob: await encodeCanvas(canvas, quality), width, height };
}

/**
 * Wie `compressImage`, aber schneidet mittig auf ein Quadrat zu.
 *
 * Für runde Porträts (Gründer, Toni). Ohne den Zuschnitt läge ein Hochformat-Foto im
 * Storage, von dem der Browser nachher per object-cover ohnehin nur die Mitte zeigt: Wir
 * lüden also Bildfläche hoch, die nie jemand sieht.
 */
export async function compressSquareImage(
  file: File,
  dim = AVATAR_DIM,
  quality = AVATAR_QUALITY,
): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  // Mittig: Bei einem Porträt ist das Gesicht fast immer dort. Wer den Ausschnitt genau
  // will, schneidet vorher selbst zu.
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  // Ein kleines Bild NICHT hochrechnen: Das macht es nur gross, nicht besser.
  const out = Math.min(dim, side);
  const [canvas, ctx] = canvasOf(out, out);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
  bitmap.close?.();
  return { blob: await encodeCanvas(canvas, quality), width: out, height: out };
}

/**
 * Legt ein Blob unter einem frischen UUID-Pfad ab und gibt die öffentliche URL zurück.
 * Frischer Pfad + upsert:false ist die Bedingung dafür, dass IMMUTABLE_CACHE_SECONDS
 * gefahrlos ist: Unter einer URL liegt für immer dasselbe Bild (siehe storage.ts).
 *
 * Die Endung kommt aus `blob.type`, nicht aus dem Wunschdenken der Aufrufstelle: Supabase
 * übernimmt bei einem Blob dessen Typ als MIME und ignoriert die `contentType`-Option
 * (storage-js baut daraus ein FormData). Name und Inhalt müssen also aus derselben Quelle
 * kommen, sonst heisst die Datei wieder .webp und ist es nicht.
 */
export async function uploadImage(blob: Blob, folder?: string): Promise<string> {
  const ext = EXTENSION[blob.type];
  if (!ext) throw new Error(`Unerwartetes Bildformat: ${blob.type || "unbekannt"}`);
  const supabase = createClient();
  const path = `${folder ? `${folder}/` : ""}${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type,
    upsert: false,
    cacheControl: IMMUTABLE_CACHE_SECONDS,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
