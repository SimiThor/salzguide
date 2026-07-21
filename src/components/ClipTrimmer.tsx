"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getFFmpeg } from "@/lib/ffmpeg";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/ui";

// iOS-2026-Trimmer (wie die Fotos-App): Vorschau oben, darunter ein Filmstreifen mit einem
// ziehbaren Rahmen. Der Rahmen ist genau `windowSec` breit (die Länge, die ins Story-Video
// kommt) und wird über die Zeitleiste geschoben.
//
// Dauer und Bilder kommen aus ffmpeg.wasm, NICHT aus einem <video>-Element. Das ist der
// Grund: ffmpeg liest die Datei direkt (arrayBuffer) und dekodiert selbst - engine-
// unabhängig, klappt auf JEDEM Browser inkl. Safari und mit HEVC. Das <video>-Element
// zickte je nach Browser (Safari-Dauer, Blob-Quirks) und ließ den Trimmer ausfallen.

const FRAMES = 10; // Bilder für Streifen + Vorschau (progressiv per schnellem Seek)
const FRAME_W = 360; // Breite der extrahierten Bilder (Hochkant)

function fmt(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

// Dauer direkt aus dem MP4/MOV-Container lesen (moov -> mvhd). Pures JS, in JEDEM Browser
// gleich, sofort - unabhängig davon, ob das <video>-Element oder der ffmpeg-Log mitspielt.
// Deckt iPhone-Videos (.mov) und normale MP4s ab. Scannt nur Box-Header (schnell, auch
// wenn moov am Dateiende liegt). 0 = nicht gefunden (z.B. WebM) -> Aufrufer nutzt Notnagel.
function mp4Duration(b: Uint8Array): number {
  const u32 = (o: number) => b[o] * 16777216 + b[o + 1] * 65536 + b[o + 2] * 256 + b[o + 3];
  const type = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const scan = (start: number, end: number): number => {
    let o = start;
    while (o + 8 <= end) {
      let size = u32(o);
      let hdr = 8;
      if (size === 1) {
        size = u32(o + 8) * 4294967296 + u32(o + 12);
        hdr = 16;
      } else if (size === 0) {
        size = end - o;
      }
      if (size < hdr || o + size > end + 8) break;
      const t = type(o + 4);
      if (t === "moov" || t === "trak" || t === "mdia") {
        const r = scan(o + hdr, o + size);
        if (r > 0) return r;
      } else if (t === "mvhd") {
        const version = b[o + hdr];
        let p = o + hdr + 4;
        if (version === 1) {
          p += 16;
          const ts = u32(p);
          const dur = u32(p + 4) * 4294967296 + u32(p + 8);
          return ts ? dur / ts : 0;
        }
        p += 8;
        const ts = u32(p);
        const dur = u32(p + 4);
        return ts ? dur / ts : 0;
      }
      o += size;
    }
    return 0;
  };
  try {
    return scan(0, b.length);
  } catch {
    return 0;
  }
}

export default function ClipTrimmer({
  file,
  windowSec,
  onConfirm,
  onCancel,
}: {
  file: File;
  windowSec: number;
  onConfirm: (startSec: number) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Detail.videoMaker");
  const stripRef = useRef<HTMLDivElement>(null);

  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(true);
  const [failed, setFailed] = useState(false);

  // Dauer aus dem Container lesen (pures JS), Datei an ffmpeg geben, Bilder per Seek
  // extrahieren. Kein <video>-Element -> überall gleich, auch Safari/iOS.
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    (async () => {
      try {
        const { fetchFile } = await import("@ffmpeg/util");
        const data = await fetchFile(file); // Uint8Array, einmal lesen
        if (cancelled) return;

        // 1) Dauer: ZUERST direkt aus dem MP4/MOV-Container (pures JS, in jedem Browser gleich,
        // sofort). Deckt iPhone-Videos und normale MP4s ab. Der ffmpeg-Log ist nur Notnagel für
        // exotische Container - in Safari/WebKit ist er ohnehin unvollständig.
        const ff = await getFFmpeg();
        await ff.writeFile("trim_in", data);
        if (cancelled) return;

        let dur = mp4Duration(data);
        if (!(dur > 0)) {
          let log = "";
          const onLog = (e: { message: string }) => {
            log += e.message + "\n";
          };
          ff.on("log", onLog);
          await ff.exec(["-i", "trim_in", "-t", "0.05", "-f", "null", "-"]).catch(() => {});
          ff.off("log", onLog);
          const m = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
          dur = m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0;
        }
        if (cancelled) return;
        if (!(dur > 0)) {
          setFailed(true);
          setPreparing(false);
          return;
        }
        // Dauer reicht: Fenster + Verwenden sind sofort nutzbar. Bilder kommen danach.
        setDuration(dur);
        setPreparing(false);

        // 2) Bilder per SCHNELLEM Seek (kein Ganz-Video-Dekodieren), progressiv nachladen.
        for (let i = 0; i < FRAMES; i++) {
          if (cancelled) return;
          const ts = clamp((dur * (i + 0.5)) / FRAMES, 0, Math.max(0, dur - 0.1));
          try {
            await ff.exec([
              "-ss", String(ts), "-i", "trim_in",
              "-frames:v", "1", "-vf", `scale=${FRAME_W}:-2`, "-q:v", "5", "-y", "f.jpg",
            ]);
            const data = (await ff.readFile("f.jpg")) as Uint8Array;
            const u = URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: "image/jpeg" }));
            made.push(u);
            if (cancelled) {
              URL.revokeObjectURL(u);
              return;
            }
            setFrames([...made]);
          } catch {
            /* dieses Bild überspringen */
          }
        }
      } catch {
        setFailed(true);
        setPreparing(false);
      } finally {
        try {
          const ff = await getFFmpeg();
          await ff.deleteFile("trim_in").catch(() => {});
        } catch {
          /* egal */
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [file]);

  const trimmable = duration > windowSec + 0.05;
  const winFrac = trimmable ? windowSec / duration : 1;

  const previewIdx =
    frames.length > 0
      ? clamp(Math.round((start / (duration || 1)) * (FRAMES - 1)), 0, frames.length - 1)
      : -1;

  // Ziehen des Rahmens: window-Listener statt setPointerCapture -> robust in jedem Browser,
  // auch wenn der Zeiger die Fläche verlässt.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!trimmable) return;
    e.preventDefault();
    const strip = stripRef.current;
    if (!strip) return;
    const w = strip.clientWidth || 1;
    const x0 = e.clientX;
    const s0 = start;
    const dur = duration;
    const move = (ev: PointerEvent) => {
      const next = clamp(s0 + ((ev.clientX - x0) / w) * dur, 0, dur - windowSec);
      setStart(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const from = trimmable ? start : 0;
  const to = trimmable ? start + windowSec : Math.min(duration, windowSec);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">{t("trimHint")}</p>

      {/* Vorschau: das Bild an der aktuellen Stelle (aus ffmpeg extrahiert). */}
      <div className="relative mx-auto grid aspect-[9/16] max-h-[40vh] w-auto place-items-center overflow-hidden rounded-2xl bg-black">
        {previewIdx >= 0 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frames[previewIdx]} alt="" className="h-full w-full object-cover" />
        )}
        {(preparing || previewIdx < 0) && !failed && (
          <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-sm">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          </div>
        )}
      </div>

      {/* Filmstreifen + ziehbarer Rahmen */}
      {duration > 0 && (
        <>
          <div
            ref={stripRef}
            className="relative h-16 w-full touch-none select-none overflow-hidden rounded-xl bg-black/10"
          >
            <div className="pointer-events-none absolute inset-0 flex">
              {frames.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt="" className="h-full flex-1 object-cover" draggable={false} />
              ))}
            </div>

            {/* Abdunklung außerhalb der Auswahl */}
            <div
              className="pointer-events-none absolute inset-y-0 left-0 bg-black/45"
              style={{ width: `${(trimmable ? start / duration : 0) * 100}%` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 right-0 bg-black/45"
              style={{ width: `${(trimmable ? 1 - (start + windowSec) / duration : 0) * 100}%` }}
            />

            {/* Auswahl-Rahmen (heller Rahmen, Griffe an den Enden) */}
            <div
              onPointerDown={onPointerDown}
              className={`absolute inset-y-0 touch-none rounded-xl border-[3px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)] ${
                trimmable ? "cursor-grab active:cursor-grabbing" : ""
              }`}
              style={{ left: `${(trimmable ? start / duration : 0) * 100}%`, width: `${winFrac * 100}%` }}
            >
              <span className="absolute left-1 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-white" />
              <span className="absolute right-1 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-white" />
            </div>
          </div>

          <p className="text-center text-[13px] font-medium text-muted">
            {fmt(from)} – {fmt(to)}
          </p>
        </>
      )}

      {/* Graceful: Datei nicht lesbar -> Hinweis, es werden die ersten Sekunden genommen. */}
      {failed && (
        <p className="py-2 text-center text-[13px] text-muted">{t("trimUnavailable")}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button className={`${BTN_SECONDARY} w-full active:scale-[0.98]`} onClick={onCancel}>
          {t("back")}
        </button>
        <button
          className={`${BTN_PRIMARY} w-full active:scale-[0.98]`}
          disabled={preparing}
          onClick={() => onConfirm(trimmable ? start : 0)}
        >
          {t("use")}
        </button>
      </div>
    </div>
  );
}
