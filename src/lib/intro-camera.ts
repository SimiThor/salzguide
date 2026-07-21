// Reine Kamera-Bahn für das Intro-Video (kein Mapbox, kein DOM -> testbar).
// Aus einer Route [lng,lat][] entsteht pro Frame ein Kamerastand
// (center/bearing/pitch/zoom) plus trim = Anteil der bereits gezeichneten Linie.
// Die Kamera folgt dem Kopf der wachsenden Linie: center = Punkt bei Anteil f,
// bearing = Blickrichtung des Wegs dort. So "wandert" die Kamera die Strecke ab.
//
// Sprachneutral und ohne Text: Beschriftung/Wasserzeichen kommen erst später
// (ffmpeg-Overlay bzw. Video-Maker), damit ein Render pro Spot genügt.

import { coordAtFraction } from "@/lib/geo";

export type IntroKeyframe = {
  center: [number, number];
  bearing: number;
  pitch: number;
  zoom: number;
  trim: number; // 0..1, so viel der Linie ist gezeichnet
};

export type IntroCameraConfig = {
  fps: number; // Bilder pro Sekunde
  durationSec: number; // Länge der Fahrt
  pitch: number; // Kamera-Neigung in Grad (0 = Draufsicht, ~62 = schräg/3D)
  zoom: number; // fixer Zoom entlang der Fahrt
  bearingSmoothing: number; // 0..1, höher = ruhiger (aber träger) beim Drehen
};

export const DEFAULT_INTRO_CAMERA: IntroCameraConfig = {
  fps: 30,
  durationSec: 10,
  pitch: 62,
  zoom: 14.5,
  bearingSmoothing: 0.85,
};

// Sanftes An- und Abbremsen der Fahrt (kein harter Start/Stopp).
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

// Kompasspeilung a->b in Grad (0 = Nord, im Uhrzeigersinn).
function bearingBetween(a: [number, number], b: [number, number]): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const toDeg = (x: number) => (x * 180) / Math.PI;
  const dLng = toRad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Winkel entpacken, damit die Glättung den kurzen Weg nimmt (359°->1° = +2°, nicht -358°).
function unwrap(prev: number, next: number): number {
  let d = next - prev;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return prev + d;
}

// Erzeugt die vollständige Kamera-Bahn. Deterministisch: gleiche Route + Config -> gleiche Frames.
export function buildIntroCameraPath(
  route: [number, number][],
  cfg: Partial<IntroCameraConfig> = {},
): IntroKeyframe[] {
  const c = { ...DEFAULT_INTRO_CAMERA, ...cfg };
  const frames = Math.max(2, Math.round(c.fps * c.durationSec));

  // Entartete Route (kein oder ein Punkt): ruhiges Standbild.
  if (!route || route.length < 2) {
    const center = (route && route[0]) || ([13.05, 47.6] as [number, number]);
    return Array.from({ length: frames }, () => ({
      center,
      bearing: 0,
      pitch: c.pitch,
      zoom: c.zoom,
      trim: route && route.length ? 1 : 0,
    }));
  }

  // Tangenten-Abstand für die Blickrichtung (Anteil der Strecke vor/hinter dem Kopf).
  const look = 0.02;

  const out: IntroKeyframe[] = [];
  let smoothed = Number.NaN;
  for (let i = 0; i < frames; i++) {
    const p = i / (frames - 1);
    const f = easeInOutSine(p); // 0..1, langsamer Start und Schluss
    const center = coordAtFraction(route, f) ?? route[route.length - 1];

    // Blickrichtung aus einem Punkt hinter und vor dem Kopf.
    const behind = coordAtFraction(route, Math.max(0, f - look)) ?? center;
    const ahead = coordAtFraction(route, Math.min(1, f + look)) ?? center;
    const raw = bearingBetween(behind, ahead);

    // Exponentielle Glättung mit Entpackung, damit die Kamera nicht ruckt.
    if (Number.isNaN(smoothed)) {
      smoothed = raw;
    } else {
      const target = unwrap(smoothed, raw);
      smoothed = smoothed + (1 - c.bearingSmoothing) * (target - smoothed);
    }

    out.push({
      center,
      bearing: ((smoothed % 360) + 360) % 360,
      pitch: c.pitch,
      zoom: c.zoom,
      trim: f,
    });
  }
  return out;
}
