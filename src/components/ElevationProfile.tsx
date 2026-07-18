"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ElevationProfile as Profile } from "@/lib/admin-actions";
import { DIR_THRESHOLD } from "./useBodyDrag";

// Touch-und-Halten liest ab, ohne dass der Finger wandern muss (wie in Apples Health/Aktien).
const PRESS_MS = 250;

// Glatte Linie via monotoner kubischer Interpolation (wie D3 curveMonotoneX):
// geht durch JEDEN Datenpunkt und schwingt NICHT über -> rundet die Ecken,
// erfindet aber keine Gipfel/Senken (kein falscher Eindruck).
function smoothLine(P: { x: number; y: number }[]): string {
  const n = P.length;
  if (n < 2) return "";
  if (n === 2) return `M${P[0].x},${P[0].y}L${P[1].x},${P[1].y}`;
  const sgn = Math.sign;
  const secant = (i: number) => {
    const h = P[i + 1].x - P[i].x;
    return h !== 0 ? (P[i + 1].y - P[i].y) / h : 0;
  };
  const t = new Array<number>(n);
  for (let i = 1; i < n - 1; i++) {
    const s0 = secant(i - 1);
    const s1 = secant(i);
    if (s0 * s1 <= 0) {
      t[i] = 0; // lokales Extremum -> flache Tangente (kein Überschwingen)
    } else {
      const h0 = P[i].x - P[i - 1].x;
      const h1 = P[i + 1].x - P[i].x;
      const p = (s0 * h1 + s1 * h0) / (h0 + h1);
      t[i] =
        (sgn(s0) + sgn(s1)) *
        Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p));
    }
  }
  t[0] = secant(0);
  t[n - 1] = secant(n - 2);
  let d = `M${P[0].x.toFixed(2)},${P[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (P[i + 1].x - P[i].x) / 3;
    const c1x = P[i].x + h;
    const c1y = P[i].y + h * t[i];
    const c2x = P[i + 1].x - h;
    const c2y = P[i + 1].y - h * t[i + 1];
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${P[i + 1].x.toFixed(2)},${P[i + 1].y.toFixed(2)}`;
  }
  return d;
}

// Minimalistisches, interaktives Höhenprofil (nur Wanderungen) – Apple-iOS-2026-Stil,
// inspiriert von Komoot/Bergfex: sanfte Flächenfüllung + Akzentlinie. Hover/Wischen zeigt
// Höhe + Distanz; onHover meldet den Bruchteil (0..1) für den Punkt auf der Karte.
export default function ElevationProfile({
  profile,
  title,
  className = "",
  onHover,
}: {
  profile: Profile;
  title?: string;
  className?: string;
  onHover?: (fraction: number | null) => void;
}) {
  const t = useTranslations("Detail");
  const locale = useLocale();
  const areaRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<
    { leftPct: number; topPct: number; e: number; d: number } | null
  >(null);

  // Zustand EINER Berührung. `decided` heisst: die Richtung steht fest und bleibt bis zum
  // Loslassen — entweder wir lesen ab (`reading`) oder die Seite scrollt (dann rühren wir
  // uns bis zum Ende der Geste nicht mehr).
  const touch = useRef<{
    reading: boolean;
    decided: boolean;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ reading: false, decided: false, x: 0, y: 0, timer: null });

  // Nicht-passiver touchmove: die EINZIGE Stelle, die iOS' Scrollen noch stoppen kann,
  // sobald das Ablesen läuft (sonst fährt die Seite unter dem Finger weg, wenn man beim
  // Ablesen schräg wischt). React hängt touchmove passiv ein, dort wird preventDefault
  // ignoriert — deshalb von Hand ans DOM, genau wie in useBodyDrag.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (touch.current.reading && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      if (touch.current.timer) clearTimeout(touch.current.timer);
    };
  }, []);

  const pts = profile.points;
  if (!pts || pts.length < 2) return null;

  const W = 320;
  const H = 110;
  const padT = 10;
  const padB = 8;
  const maxD = pts[pts.length - 1].d || 1;
  const minE = Math.min(...pts.map((p) => p.e));
  const maxE = Math.max(...pts.map((p) => p.e));
  const rangeE = maxE - minE || 1;
  const x = (d: number) => (d / maxD) * W;
  const y = (e: number) => padT + (1 - (e - minE) / rangeE) * (H - padT - padB);

  const P = pts.map((p) => ({ x: x(p.d), y: y(p.e) }));
  const line = smoothLine(P);
  const area = `${line} L${W},${H} L0,${H} Z`;

  const fmtKm = (km: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(km);

  function move(clientX: number) {
    const el = areaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetD = f * maxD;
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dd = Math.abs(pts[i].d - targetD);
      if (dd < best) {
        best = dd;
        idx = i;
      }
    }
    const p = pts[idx];
    setHover({
      leftPct: (p.d / maxD) * 100,
      topPct: (y(p.e) / H) * 100,
      e: p.e,
      d: p.d,
    });
    onHover?.(p.d / maxD);
  }
  function leave() {
    setHover(null);
    onHover?.(null);
  }

  function stopTimer() {
    const s = touch.current;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
  }

  // Ab hier folgt die Anzeige dem Finger — und die Seite steht still (siehe touchmove oben).
  function startReading(el: HTMLElement, pointerId: number, clientX: number) {
    const s = touch.current;
    s.decided = true;
    s.reading = true;
    try {
      el.setPointerCapture(pointerId);
    } catch {}
    move(clientX);
  }

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse") {
      move(e.clientX);
      return;
    }
    // Am Finger warten wir ab, wohin die Geste geht. Nichts anzeigen, sonst blitzt die
    // Pille bei jedem Vorbeiscrollen kurz auf.
    const el = e.currentTarget;
    const id = e.pointerId;
    const x = e.clientX;
    stopTimer();
    touch.current = { reading: false, decided: false, x, y: e.clientY, timer: null };
    touch.current.timer = setTimeout(() => {
      touch.current.timer = null;
      if (!touch.current.decided) startReading(el, id, x); // gehalten -> ablesen
    }, PRESS_MS);
  }

  function drag(e: React.PointerEvent<HTMLDivElement>) {
    const s = touch.current;
    if (e.pointerType === "mouse") {
      move(e.clientX);
      return;
    }
    if (s.reading) {
      move(e.clientX);
      return;
    }
    if (s.decided) return; // als Scrollen eingeordnet -> diese Geste gehört der Seite
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < DIR_THRESHOLD && Math.abs(dy) < DIR_THRESHOLD) return;
    stopTimer();
    if (Math.abs(dx) > Math.abs(dy)) {
      startReading(e.currentTarget, e.pointerId, e.clientX); // quer -> ablesen
    } else {
      s.decided = true; // hoch/runter -> Seite scrollt, alte Anzeige weg
      leave();
    }
  }

  function up(e: React.PointerEvent<HTMLDivElement>) {
    const s = touch.current;
    stopTimer();
    if (e.pointerType === "mouse") {
      s.reading = false;
      s.decided = false;
      leave();
      return;
    }
    // Kurzes Tippen (keine Richtung, kein Halten): einmal ablesen.
    if (!s.decided) move(e.clientX);
    // Nach dem Ablesen stehen lassen: der Finger verdeckt das Profil, der Punkt auf der
    // Karte ist ja das Interessante. Weg ist es beim nächsten Scrollen über das Profil.
    s.reading = false;
    s.decided = false;
  }

  function cancel() {
    stopTimer();
    touch.current.reading = false;
    touch.current.decided = false;
    leave();
  }

  const tipLeft = hover ? Math.max(12, Math.min(88, hover.leftPct)) : 0;

  return (
    <div className={`rounded-[16px] bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold text-ink">
          {title ?? t("elevation.profile")}
        </h3>
        <span className="text-xs font-medium text-muted">
          {fmtKm(profile.distanceKm ?? maxD)} km
        </span>
      </div>

      {/* Chart: feste Höhen-Label-Spalte links (px-fest) + Plot rechts */}
      <div className="flex gap-1.5">
        <div className="w-11 shrink-0">
          <div className="h-6" />
          <div className="relative h-24">
            <span className="absolute right-0 top-0 text-[10px] font-medium text-muted">
              {profile.max} m
            </span>
            <span className="absolute bottom-0 right-0 text-[10px] font-medium text-muted">
              {profile.min} m
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {/* Info-Pille ÜBER dem Chart -> überdeckt nie die Linie */}
          <div className="relative h-6">
            {hover && (
              <span
                className="pointer-events-none absolute bottom-0 -translate-x-1/2 whitespace-nowrap rounded-[9px] bg-white px-2 py-1 text-[11px] shadow-md ring-1 ring-black/5"
                style={{ left: `${tipLeft}%` }}
              >
                <span className="font-semibold text-ink">{hover.e} m</span>
                <span className="ml-1.5 text-muted">{fmtKm(hover.d)} km</span>
              </span>
            )}
          </div>

          <div
            ref={areaRef}
            className="relative h-24 cursor-crosshair select-none"
            // pan-y: Hoch- und Runterwischen gehört IMMER der Seite. Nur quer (oder
            // gehalten) lesen wir ab – wer nur am Profil vorbeiscrollt, bleibt nie hängen.
            style={{ touchAction: "pan-y" }}
            onPointerDown={down}
            onPointerMove={drag}
            onPointerLeave={(e) => e.pointerType === "mouse" && leave()}
            onPointerUp={up}
            onPointerCancel={cancel}
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-24 w-full"
              preserveAspectRatio="none"
              aria-hidden
            >
              <defs>
                <linearGradient id="sg-ele-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#cc2924" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#cc2924" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#sg-ele-fill)" />
              <path
                d={line}
                fill="none"
                stroke="#cc2924"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {/* Hover: Haarlinie + Punkt auf der Kurve */}
            {hover && (
              <>
                <span
                  className="pointer-events-none absolute top-0 bottom-0 w-px bg-accent/30"
                  style={{ left: `${hover.leftPct}%` }}
                />
                <span
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow"
                  style={{ left: `${hover.leftPct}%`, top: `${hover.topPct}%` }}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <span className="text-ink">
            ↑ {profile.ascent} {t("elevation.unitElevation")}
          </span>{" "}
          {t("elevation.ascent")}
        </span>
        <span>
          <span className="text-ink">
            ↓ {profile.descent} {t("elevation.unitElevation")}
          </span>{" "}
          {t("elevation.descent")}
        </span>
        <span>
          <span className="text-ink">⛰️ {profile.max} m</span>{" "}
          {t("elevation.highest")}
        </span>
      </div>
    </div>
  );
}
