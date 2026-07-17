"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IMMUTABLE_CACHE_SECONDS } from "@/lib/storage";

// Bild client-seitig zu WebP konvertieren (max. Kantenlänge, Qualität) -> klein & schnell
async function fileToWebp(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
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
  return blob;
}

export default function PhotoUploader({
  images,
  onChange,
}: {
  images: string[];
  onChange: (urls: string[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // erneutes Wählen derselben Datei erlauben
    if (!files.length) return;
    setErr("");
    setBusy(true);
    const supabase = createClient();
    const added: string[] = [];
    try {
      for (const file of files) {
        const blob = await fileToWebp(file);
        const path = `${crypto.randomUUID()}.webp`;
        const { error } = await supabase.storage
          .from("spot-media")
          .upload(path, blob, { contentType: "image/webp", upsert: false, cacheControl: IMMUTABLE_CACHE_SECONDS });
        if (error) {
          setErr(error.message);
          break;
        }
        added.push(supabase.storage.from("spot-media").getPublicUrl(path).data.publicUrl);
      }
      if (added.length) onChange([...images, ...added]);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Upload fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  function remove(i: number) {
    onChange(images.filter((_, idx) => idx !== i));
  }
  function makeHero(i: number) {
    const next = [...images];
    const [u] = next.splice(i, 1);
    next.unshift(u);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((url, i) => (
            <div
              key={url}
              className="relative h-20 w-28 overflow-hidden rounded-[10px] bg-black/5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Hero
                </span>
              )}
              <div className="absolute right-1 top-1 flex gap-1">
                {i !== 0 && (
                  <button
                    type="button"
                    onClick={() => makeHero(i)}
                    title="Als Hero setzen"
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[11px] text-ink shadow"
                  >
                    ★
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  title="Entfernen"
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[11px] text-accent shadow"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-full bg-black/5 px-3.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
        >
          {busy ? "lädt hoch …" : "📷 Foto hinzufügen"}
        </button>
        {images.length > 0 && (
          <span className="text-xs text-muted">
            {images.length} Foto(s) · erstes = Hero
          </span>
        )}
        {err && <span className="text-xs text-accent">{err}</span>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onFiles}
        className="hidden"
      />
    </div>
  );
}
