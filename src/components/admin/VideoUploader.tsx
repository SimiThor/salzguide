"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IMMUTABLE_CACHE_SECONDS } from "@/lib/storage";
import { encodeCanvas, uploadImage } from "@/lib/image-upload";
import { getFFmpeg } from "@/lib/ffmpeg";

// 9:16-Video je Spot: IMMER komprimieren, NIE das Original hochladen (zu unperformant).
// Kompression via ffmpeg.wasm -> läuft in JEDEM Browser inkl. Safari (reines WebAssembly,
// Core self-hosted unter /public/ffmpeg). Ausgabe = kleines H.264-MP4 (max 720x1280, CRF 28).
// Standbild = erster Frame des KOMPRIMIERTEN MP4 -> überall dekodierbar, als WebP.
// Schlägt die Kompression fehl -> Ablehnung (kein Upload).

const POSTER_LONG_EDGE = 720;
const HARD_MAX_BYTES = 60 * 1024 * 1024; // Sicherheits-Deckel nach der Kompression

// ffmpeg.wasm-Lader liegt jetzt in src/lib/ffmpeg.ts (geteilt mit dem Video-Maker).

// Auf ein Media-Event warten (mit Fehler-Reject), robust aufräumen.
function once(el: HTMLVideoElement, ev: string): Promise<void> {
  return new Promise((res, rej) => {
    const ok = () => {
      cleanup();
      res();
    };
    const bad = () => {
      cleanup();
      rej(new Error(ev));
    };
    const cleanup = () => {
      el.removeEventListener(ev, ok);
      el.removeEventListener("error", bad);
    };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

// Erster Frame des (H.264-)MP4 -> WebP-Standbild.
async function makePoster(mp4: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(mp4);
  const v = document.createElement("video");
  v.src = url;
  v.muted = true;
  v.playsInline = true;
  try {
    await once(v, "loadeddata");
    const dur = Number.isFinite(v.duration) ? v.duration : 1;
    v.currentTime = Math.min(0.1, dur / 2);
    await once(v, "seeked");
    const long = Math.max(v.videoWidth, v.videoHeight) || 1;
    const scale = Math.min(1, POSTER_LONG_EDGE / long);
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    // encodeCanvas prüft, ob wirklich WebP herauskam, und weicht sonst auf JPEG aus.
    // Ohne die Prüfung läge (wie lange bei den Fotos) ein PNG unter dem Namen .webp.
    return await encodeCanvas(c, 0.8);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function VideoUploader({
  videoUrl,
  posterUrl,
  onChange,
}: {
  videoUrl: string | null;
  posterUrl: string | null;
  onChange: (videoUrl: string | null, posterUrl: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [err, setErr] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setErr("Bitte ein Video wählen.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      setStage("Video-Encoder wird geladen … (einmalig)");
      const ff = await getFFmpeg();
      const { fetchFile } = await import("@ffmpeg/util");

      const inExt = file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp4";
      const inName = `in${inExt}`;
      const outName = "out.mp4";
      const onProg = (ev: { progress: number }) => {
        const pct = Math.max(0, Math.min(100, Math.round(ev.progress * 100)));
        setStage(`Video wird komprimiert … ${pct}%`);
      };
      ff.on("progress", onProg);
      let mp4: Blob;
      try {
        await ff.writeFile(inName, await fetchFile(file));
        await ff.exec([
          "-i",
          inName,
          "-vf",
          "scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "28",
          "-c:a",
          "aac",
          "-b:a",
          "96k",
          "-movflags",
          "+faststart",
          outName,
        ]);
        const data = (await ff.readFile(outName)) as Uint8Array;
        await ff.deleteFile(inName).catch(() => {});
        await ff.deleteFile(outName).catch(() => {});
        if (!data || data.length < 1024) throw new Error("empty output");
        mp4 = new Blob([data as unknown as BlobPart], { type: "video/mp4" });
      } finally {
        ff.off("progress", onProg);
      }

      if (mp4.size > HARD_MAX_BYTES) {
        setErr("Video ist auch nach der Komprimierung zu groß. Bitte einen kürzeren Clip.");
        return;
      }

      setStage("Standbild wird erstellt …");
      const poster = await makePoster(mp4);

      setStage("Wird hochgeladen …");
      const supabase = createClient();
      const vidPath = `spots/video-${crypto.randomUUID()}.mp4`;
      const up = await supabase.storage
        .from("spot-media")
        .upload(vidPath, mp4, { contentType: "video/mp4", upsert: false, cacheControl: IMMUTABLE_CACHE_SECONDS });
      if (up.error) {
        const m = up.error.message || "";
        setErr(
          /exceed|maximum allowed size|too large|413/i.test(m)
            ? "Video ist größer als das Supabase-Speicherlimit. Bitte im Bucket „spot-media“ das Datei-Limit erhöhen – oder ein kürzeres Video."
            : m || "Upload hat nicht geklappt.",
        );
        return;
      }
      const newVideoUrl = supabase.storage.from("spot-media").getPublicUrl(vidPath).data.publicUrl;

      let newPosterUrl: string | null = null;
      if (poster) {
        // Endung folgt dem echten Blob-Typ (webp oder jpg). Ein Fehlschlag beim Poster
        // darf den Video-Upload nicht kippen, das Standbild ist nachrangig.
        try {
          newPosterUrl = await uploadImage(poster, "spots");
        } catch {
          newPosterUrl = null;
        }
      }
      onChange(newVideoUrl, newPosterUrl);
    } catch {
      setErr("Komprimierung/Upload hat nicht geklappt. Bitte ein anderes Video/Format probieren.");
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  return (
    <div className="space-y-2">
      {videoUrl && (
        <div className="h-48 w-[108px] overflow-hidden rounded-[12px] bg-black">
          <video
            src={videoUrl}
            poster={posterUrl ?? undefined}
            controls
            playsInline
            preload="none"
            // sg-video (globals.css): auch die Admin-Vorschau zeigt im Vollbild das ganze
            // Video. Sonst prüfst du hier einen Ausschnitt und gibst etwas anderes frei.
            className="sg-video"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-full bg-black/5 px-3.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
        >
          {busy ? (stage || "verarbeitet …") : videoUrl ? "🎬 Video ersetzen" : "🎬 Video hochladen"}
        </button>
        {videoUrl && !busy && (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="rounded-full bg-black/5 px-3.5 py-1.5 text-xs font-semibold text-accent"
          >
            Entfernen
          </button>
        )}
        {err && <span className="text-xs text-accent">{err}</span>}
      </div>
      <p className="text-[11px] text-muted">
        Hochkant (9:16), kurzer Clip. Wird automatisch komprimiert (H.264-MP4, max 720×1280);
        Standbild = erster Frame. Das Original wird nie hochgeladen.
      </p>
      <input ref={fileRef} type="file" accept="video/*" onChange={onFile} className="hidden" />
    </div>
  );
}
