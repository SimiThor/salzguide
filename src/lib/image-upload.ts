// Bild im Browser zu WebP rechnen und in den Storage legen. EIN Weg für den ganzen Admin.
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

export type WebpImage = {
  blob: Blob;
  /** Masse NACH dem Verkleinern. next/image braucht sie, sonst springt das Layout. */
  width: number;
  height: number;
};

/**
 * Skaliert auf die lange Kante `maxDim` herunter (nie hoch) und gibt WebP zurück.
 * Die tatsächlichen Masse kommen mit: Ein Bild ohne Masse zwingt next/image zu `fill`,
 * und dann muss jede Aufrufstelle das Seitenverhältnis selbst kennen.
 */
export async function fileToWebp(file: File, maxDim = 1600, quality = 0.82): Promise<WebpImage> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas nicht verfügbar");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/webp", quality),
  );
  if (!blob) throw new Error("WebP-Konvertierung fehlgeschlagen");
  return { blob, width, height };
}

/**
 * Legt ein Blob unter einem frischen UUID-Pfad ab und gibt die öffentliche URL zurück.
 * Frischer Pfad + upsert:false ist die Bedingung dafür, dass IMMUTABLE_CACHE_SECONDS
 * gefahrlos ist: Unter einer URL liegt für immer dasselbe Bild (siehe storage.ts).
 */
export async function uploadWebp(blob: Blob): Promise<string> {
  const supabase = createClient();
  const path = `${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: IMMUTABLE_CACHE_SECONDS,
  });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
