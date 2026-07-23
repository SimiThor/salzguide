"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/ui";
import { loadOrientedBitmap } from "@/lib/image-orientation";
import {
  drawStory,
  exportStoryJpeg,
  coverScale,
  clampTransform,
  STORY_W,
  STORY_H,
  type StoryColor,
  type StoryPreset,
  type StoryTransform,
  type StoryDrawOpts,
  type StoryStat,
} from "@/lib/story-canvas";

const WORDMARK = "SalzGuide";
// Sehr große Fotos (viele MP) können auf älteren Handys den Speicher sprengen. 40 MB deckt
// normale Handy-Fotos locker ab und schützt vor Out-of-Memory beim Dekodieren.
const MAX_PHOTO_BYTES = 40 * 1024 * 1024;
const MAX_ZOOM_FACTOR = 3; // bis 3x über "cover"

// Foto-Story (Strava-Look, an unseren Stil): eigenes Foto rein, echter Routenverlauf als
// Linie drüber, schlichte Werte + Wortmarke, 9:16. Ausschnitt per Verschieben/Zoomen. Alles
// im Browser (story-canvas.ts) - das Foto verlässt das Gerät nie.
export default function StoryPhotoPanel({
  slug,
  route,
  stats,
  onUiChange,
}: {
  slug: string;
  route: [number, number][];
  stats: StoryStat[];
  // Meldet dem Sheet: Editor sichtbar (-> Voll) und ob gerade exportiert wird (-> Umschalten sperren).
  onUiChange?: (s: { expanded: boolean; busy: boolean }) => void;
}) {
  const t = useTranslations("Detail.storyMaker");
  const hasRoute = route.length >= 2;

  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState<StoryTransform>({ scale: 1, dx: 0, dy: 0 });
  const [cover, setCover] = useState(1);
  const [preset, setPreset] = useState<StoryPreset>(hasRoute ? "big" : "clean");
  const [color, setColor] = useState<StoryColor>("white");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  // Aktuelle Transform als Ref: Pan/Pinch-Handler feuern schneller als React committet (bis
  // 120 Hz). Läse man `transform` aus dem State, wäre er zwischen zwei Frames veraltet und
  // Bewegungen würden verschluckt (Bild hängt dem Finger nach). Der Ref ist immer aktuell.
  const transformRef = useRef<StoryTransform>({ scale: 1, dx: 0, dy: 0 });
  // Aktive Zeiger (für Pan mit einem Finger, Pinch-Zoom mit zwei).
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null);

  const opts = useCallback(
    (): StoryDrawOpts => ({
      image: bitmap,
      imgW: dims.w,
      imgH: dims.h,
      transform,
      route,
      stats,
      wordmark: WORDMARK,
      preset,
      color,
    }),
    [bitmap, dims, transform, route, stats, preset, color],
  );

  // Vorschau zeichnen. Canvas-Backing an CSS-Größe × DPR anpassen, dann drawStory (skaliert
  // intern auf 1080×1920). Aspekt 9:16 stimmt, also passt das Referenzbild exakt.
  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const cssW = c.clientWidth;
    const cssH = c.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawStory(ctx, W, H, opts());
  }, [opts]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Neu zeichnen, wenn sich die Breite des Sheets ändert (Drehen, Detent).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  // Bitmap beim Aushängen freigeben.
  useEffect(() => {
    return () => {
      bitmapRef.current?.close?.();
    };
  }, []);

  // Zustand ans Sheet melden: Foto gewählt -> Editor sichtbar (Voll); Export läuft -> busy
  // (Modus-Umschalten sperren, sonst bricht der Export ab).
  useEffect(() => {
    onUiChange?.({ expanded: bitmap != null, busy });
  }, [bitmap, busy, onUiChange]);

  const loadPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setErrorMsg(t("tooBig"));
      return;
    }
    try {
      // EXIF-Drehung von Handy-Fotos respektieren (über <img>, damit es auch auf Safari <17
      // aufrecht ist - createImageBitmap({imageOrientation}) wird dort still ignoriert).
      const bmp = await loadOrientedBitmap(file);
      bitmapRef.current?.close?.();
      bitmapRef.current = bmp;
      const cov = coverScale(bmp.width, bmp.height, STORY_W, STORY_H);
      setErrorMsg(null);
      setBitmap(bmp);
      setDims({ w: bmp.width, h: bmp.height });
      setCover(cov);
      transformRef.current = { scale: cov, dx: 0, dy: 0 };
      setTransform({ scale: cov, dx: 0, dy: 0 });
      if (hasRoute) setPreset("big");
    } catch {
      setErrorMsg(t("error"));
    }
  };

  // css-Pixel -> Referenz-Pixel (1080 breit). Aspekt gleich, ein Faktor reicht.
  const refFactor = () => {
    const c = canvasRef.current;
    return c && c.clientWidth ? STORY_W / c.clientWidth : 1;
  };

  const applyTransform = (next: StoryTransform) => {
    const clamped = clampTransform(next, dims.w, dims.h, STORY_W, STORY_H);
    transformRef.current = clamped; // sofort aktuell für den nächsten Move
    setTransform(clamped); // + Re-Render fürs Zeichnen
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bitmap) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bitmap) return;
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const f = refFactor();

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const ratio = pinch.current.dist ? dist / pinch.current.dist : 1;
      const cur = transformRef.current;
      const nextScale = Math.min(cover * MAX_ZOOM_FACTOR, Math.max(cover, cur.scale * ratio));
      applyTransform({
        scale: nextScale,
        dx: cur.dx + (midX - pinch.current.midX) * f,
        dy: cur.dy + (midY - pinch.current.midY) * f,
      });
      pinch.current = { dist, midX, midY };
      return;
    }

    // Ein Finger: verschieben.
    const cur = transformRef.current;
    applyTransform({
      scale: cur.scale,
      dx: cur.dx + (e.clientX - prev.x) * f,
      dy: cur.dy + (e.clientY - prev.y) * f,
    });
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onZoom = (v: number) => {
    const scale = cover * (1 + v * (MAX_ZOOM_FACTOR - 1));
    applyTransform({ scale, dx: transformRef.current.dx, dy: transformRef.current.dy });
  };
  const zoomValue = cover ? (transform.scale / cover - 1) / (MAX_ZOOM_FACTOR - 1) : 0;

  const doExport = async (): Promise<File | null> => {
    try {
      setBusy(true);
      const blob = await exportStoryJpeg(opts());
      return new File([blob], `salzguide-${slug}.jpg`, { type: "image/jpeg" });
    } catch (e) {
      console.error("story export:", e);
      setErrorMsg(t("error"));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const file = await doExport();
    if (!file) return;
    if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        // Nutzer hat den Teilen-Dialog abgebrochen -> NICHT ersatzweise herunterladen
        // (sonst landet ungefragt eine Datei im Download-Ordner). Nur bei echtem Fehler
        // auf Download ausweichen.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
    saveFile(file);
  };

  const save = async () => {
    const file = await doExport();
    if (file) saveFile(file);
  };

  const saveFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const pick = () => inputRef.current?.click();
  // Neues Foto wählen: nur den Dialog öffnen. NICHT vorher das aktuelle Bild verwerfen -
  // sonst wechselt die UI in den Auswahl-Zustand, hängt den offenen File-Input aus und die
  // Auswahl geht verloren; ausserdem bliebe man bei Abbruch ohne Bild da. loadPhoto ersetzt
  // das Bitmap ohnehin erst, wenn wirklich ein Foto gewählt wurde.
  const newPhoto = () => {
    setErrorMsg(null);
    pick();
  };

  // ---- Auswahl-Zustand: schlichte Pick-Fläche (wie der Video-Tab) ----
  if (!bitmap) {
    return (
      <div className="pb-2">
        <button
          type="button"
          onClick={pick}
          className="sg-native-tap flex w-full flex-col items-center gap-3 rounded-[22px] border border-black/[0.08] bg-black/[0.02] px-6 py-11 text-center transition active:scale-[0.99]"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-2xl">
            📸
          </span>
          <span className="text-[15px] font-semibold text-ink">{t("pick")}</span>
          <span className="max-w-[15rem] text-[13px] leading-snug text-muted">{t("hint")}</span>
        </button>
        {errorMsg && <p className="mt-3 text-center text-[13px] text-accent">{errorMsg}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            loadPhoto(e.target.files?.[0]);
            e.target.value = ""; // gleiche Datei nach Fehler erneut wählbar (feuert sonst kein change)
          }}
        />
      </div>
    );
  }

  // ---- Editor-Zustand ----
  const presetChips: { key: StoryPreset; label: string }[] = hasRoute
    ? [
        { key: "big", label: t("presetBig") },
        { key: "stack", label: t("presetStack") },
        { key: "corner", label: t("presetCorner") },
        { key: "clean", label: t("presetClean") },
      ]
    : [];

  return (
    <div className="space-y-4 pb-2">
      <div ref={wrapRef} className="flex justify-center">
        <canvas
          ref={canvasRef}
          data-sheet-no-drag
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLostPointerCapture={endPointer}
          className="aspect-[9/16] w-full touch-none select-none rounded-2xl bg-black shadow-sm ring-1 ring-black/10"
          // Höhe ADAPTIV: der ganze Editor (Kopf, Regler, Presets, Farben, Aktionen, "Neues Foto"
          // ~31rem) plus die mobile Tab-Leiste muss ÜBER die Leiste passen - sonst rutschen die
          // Aktionen auf kleinen Handys (iPhone SE) dahinter. `100svh - 31rem` reserviert diesen
          // Platz; nach oben bei 46svh gedeckelt (auf grossen Handys nicht riesig), nach unten bei
          // 140px (Querformat/sehr flach kollabiert die Vorschau sonst - dann scrollt der Inhalt).
          style={{ maxWidth: "max(120px, min(calc(46svh * 9 / 16), calc((100svh - 31rem) * 9 / 16)))" }}
        />
      </div>

      {/* Zoom */}
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={zoomValue}
        onChange={(e) => onZoom(Number(e.target.value))}
        aria-label={t("zoom")}
        className="sg-native-tap h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-accent"
      />

      {/* Presets (nur mit Route) */}
      {presetChips.length > 0 && (
        <div className="inline-flex w-full rounded-full bg-black/5 p-1 text-[13px] font-medium">
          {presetChips.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              aria-pressed={preset === p.key}
              className={`sg-native-tap flex-1 whitespace-nowrap rounded-full px-2 py-1.5 leading-5 transition-colors active:opacity-70 ${
                preset === p.key ? "bg-white text-ink shadow-sm" : "text-muted"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Linienfarbe (nur wenn eine Linie sichtbar ist) */}
      {preset !== "clean" && hasRoute && (
        <div className="flex items-center justify-center gap-3">
          {(["white", "red"] as StoryColor[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-pressed={color === c}
              aria-label={c === "white" ? t("colorWhite") : t("colorRed")}
              className={`sg-native-tap h-8 w-8 rounded-full transition active:scale-90 ${
                color === c
                  ? "ring-2 ring-accent ring-offset-2 ring-offset-cream"
                  : "ring-1 ring-black/10"
              }`}
              style={{ background: c === "white" ? "#ffffff" : "#e04848" }}
            />
          ))}
        </div>
      )}

      {/* Aktionen */}
      <div className="grid grid-cols-2 gap-3">
        <button
          className={`${BTN_PRIMARY} w-full active:scale-[0.98]`}
          onClick={share}
          disabled={busy}
        >
          {busy ? t("working") : t("share")}
        </button>
        <button
          className={`${BTN_SECONDARY} w-full active:scale-[0.98]`}
          onClick={save}
          disabled={busy}
        >
          {t("save")}
        </button>
      </div>
      <button className="w-full py-1 text-[14px] text-muted underline" onClick={newPhoto}>
        {t("again")}
      </button>
      {errorMsg && <p className="text-center text-[13px] text-accent">{errorMsg}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          loadPhoto(e.target.files?.[0]);
          e.target.value = ""; // gleiches Foto nach "Neues Foto"/Fehler erneut wählbar
        }}
      />
    </div>
  );
}
