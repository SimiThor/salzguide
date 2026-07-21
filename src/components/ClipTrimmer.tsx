"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/ui";

// iOS-2026-Trimmer (wie die Fotos-App): Vorschau oben, darunter ein Filmstreifen mit einem
// ziehbaren Rahmen. Der Rahmen ist genau `windowSec` breit (die Länge, die ins Story-Video
// kommt) und wird über die Zeitleiste geschoben. Ist das Video kürzer als windowSec, wird
// es komplett verwendet.
//
// Robust: Dauer und Thumbnails werden aus dem SICHTBAREN Vorschau-Video gelesen (das
// dekodiert überall verlässlich, inkl. HEVC auf iOS Safari) - versteckte/abgekoppelte
// Videos dekodieren manche Browser nicht. Während die Thumbnails entstehen, deckt ein
// kurzer "wird vorbereitet"-Schleier das Suchen ab. Scheitern die Thumbnails, bleibt eine
// schlichte, voll funktionsfähige Zeitleiste. Das Ziehen läuft über Pointer-Events mit
// Capture (Touch + Maus).

const THUMB_COUNT = 10;

function fmt(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

// Dauer robust lesen. Safari meldet für manche MP4/HEVC beim loadedmetadata
// duration = Infinity und liefert die echte Länge erst nach einem Sprung weit hinter das
// Ende (dann feuert durationchange). Ohne das bleibt die Dauer 0 und der Trimmer fehlt.
function readDuration(v: HTMLVideoElement): Promise<number> {
  const ok = (d: number) => Number.isFinite(d) && d > 0;
  return new Promise((resolve) => {
    if (ok(v.duration)) return resolve(v.duration);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener("durationchange", onChange);
      clearTimeout(to);
      const d = ok(v.duration) ? v.duration : 0;
      try {
        v.currentTime = 0;
      } catch {
        /* egal */
      }
      resolve(d);
    };
    const onChange = () => {
      if (ok(v.duration)) finish();
    };
    v.addEventListener("durationchange", onChange);
    try {
      v.currentTime = 1e7; // Safari zum Berechnen der echten Dauer zwingen
    } catch {
      /* egal */
    }
    const to = setTimeout(finish, 4000);
  });
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
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  const previewRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(true);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  // Dauer + Thumbnails aus dem sichtbaren Vorschau-Video. Der Schleier verdeckt das Suchen.
  useEffect(() => {
    const v = previewRef.current;
    if (!v) return;
    let cancelled = false;

    const seek = (ts: number) =>
      new Promise<void>((res, rej) => {
        const to = setTimeout(() => rej(new Error("seek-timeout")), 3000);
        const done = () => {
          clearTimeout(to);
          v.removeEventListener("seeked", done);
          res();
        };
        v.addEventListener("seeked", done);
        v.currentTime = ts;
      });

    (async () => {
      // Metadaten abwarten (mit Timeout, damit es nie hängt).
      if (v.readyState < 1) {
        await new Promise<void>((res) => {
          const done = () => res();
          v.addEventListener("loadedmetadata", done, { once: true });
          v.addEventListener("error", done, { once: true });
          setTimeout(done, 4000);
        });
      }
      if (cancelled) return;
      const dur = await readDuration(v);
      if (cancelled) return;
      setDuration(dur);

      const canvas = document.createElement("canvas");
      canvas.width = 72;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      const out: string[] = [];
      if (ctx && dur > 0) {
        for (let i = 0; i < THUMB_COUNT; i++) {
          const ts = clamp((dur * (i + 0.5)) / THUMB_COUNT, 0, Math.max(0, dur - 0.05));
          try {
            await seek(ts);
            if (cancelled) return;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            out.push(canvas.toDataURL("image/jpeg", 0.6));
            setThumbs([...out]);
          } catch {
            break; // Thumbnails sind optional.
          }
        }
      }
      if (cancelled) return;
      try {
        await seek(0);
      } catch {
        /* egal */
      }
      setPreparing(false);
    })().catch(() => setPreparing(false));

    return () => {
      cancelled = true;
    };
    // Nur einmal beim Mount; url ist stabil (useMemo auf file).
  }, [url]);

  const trimmable = duration > windowSec + 0.05;
  const winFrac = trimmable ? windowSec / duration : 1;

  // Vorschau an den Fensteranfang setzen (throttled per rAF).
  const rafRef = useRef(0);
  const seekPreview = (s: number) => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const v = previewRef.current;
      if (v && Number.isFinite(s)) v.currentTime = s;
    });
  };

  // Ziehen des Rahmens (Pointer-Capture, Touch + Maus).
  const drag = useRef<{ x0: number; s0: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!trimmable) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x0: e.clientX, s0: start };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const strip = stripRef.current;
    if (!d || !strip) return;
    const w = strip.clientWidth || 1;
    const dSec = ((e.clientX - d.x0) / w) * duration;
    const next = clamp(d.s0 + dSec, 0, duration - windowSec);
    setStart(next);
    seekPreview(next);
  };
  const endDrag = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    drag.current = null;
  };

  const playSelection = () => {
    const v = previewRef.current;
    if (!v || preparing) return;
    const from = trimmable ? start : 0;
    const to = trimmable ? start + windowSec : duration;
    v.currentTime = from;
    v.muted = false;
    const onTime = () => {
      if (v.currentTime >= to) {
        v.pause();
        v.removeEventListener("timeupdate", onTime);
      }
    };
    v.addEventListener("timeupdate", onTime);
    v.play().catch(() => {});
  };

  const from = trimmable ? start : 0;
  const to = trimmable ? start + windowSec : Math.min(duration, windowSec);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">{t("trimHint")}</p>

      {/* Vorschau (dekodiert -> Quelle für Dauer & Thumbnails). Schleier verdeckt das Suchen. */}
      <div className="relative mx-auto w-fit">
        <video
          ref={previewRef}
          src={url}
          playsInline
          muted
          preload="auto"
          onClick={playSelection}
          className="max-h-[40vh] rounded-2xl bg-black"
        />
        {preparing && (
          <div className="absolute inset-0 grid place-items-center rounded-2xl bg-black/40 backdrop-blur-sm">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          </div>
        )}
      </div>

      {/* Filmstreifen + ziehbarer Rahmen (nur wenn die Dauer gelesen werden konnte) */}
      {duration > 0 && (
        <>
      <div
        ref={stripRef}
        className="relative h-16 w-full touch-none select-none overflow-hidden rounded-xl bg-black/10"
      >
        <div className="pointer-events-none absolute inset-0 flex">
          {thumbs.map((src, i) => (
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

        {/* Auswahl-Rahmen (iOS-Stil: heller Rahmen, Griffe an den Enden) */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => (drag.current = null)}
          className={`absolute inset-y-0 rounded-xl border-[3px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)] ${
            trimmable ? "cursor-grab touch-none active:cursor-grabbing" : ""
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

      {/* Graceful: Vorschau nicht ladbar -> Hinweis, es werden die ersten Sekunden genommen. */}
      {!preparing && duration <= 0 && (
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
