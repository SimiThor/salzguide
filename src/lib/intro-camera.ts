// Reine Kamera-Bahn für das Intro-Video (kein Mapbox, kein DOM -> testbar).
// Aus einer Route [lng,lat][] entsteht pro Frame ein Kamerastand plus der exakte Kopf
// der Linie (für den Punkt). Deterministisch: gleiche Route + Config -> gleiche Frames.
//
// Cinematisch-ruhig (wie Apple): Die Linie zeichnet exakt die echte, kurvige Route, aber
// die KAMERA folgt einer GEGLÄTTETEN Bahn und dreht nur langsam mit. So schwenkt nichts
// nervös bei jeder kleinen Kurve; die Kamera gleitet und dreht sanft dem Verlauf nach.

import { coordAtFraction } from "@/lib/geo";

export type IntroKeyframe = {
  center: [number, number]; // geglättete Kamera-Position (gleitet ruhig)
  head: [number, number]; // exakter Kopf der Linie (für den wandernden Punkt)
  bearing: number;
  pitch: number;
  zoom: number;
  trim: number; // 0..1, so viel der Linie ist gezeichnet
};

export type IntroCameraConfig = {
  fps: number; // Bilder pro Sekunde
  durationSec: number; // Länge der Fahrt
  pitch: number; // Kamera-Neigung in Grad (0 = Draufsicht, ~62 = schräg/3D)
  zoom: number; // Zoom entlang der Fahrt
};

export const DEFAULT_INTRO_CAMERA: IntroCameraConfig = {
  fps: 30,
  durationSec: 10,
  pitch: 62,
  zoom: 14,
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

// Symmetrischer gleitender Mittelwert über eine Koordinatenreihe (glättet die Bahn, ohne
// nachzulaufen). Fenster wird an den Enden geklemmt.
function smoothPath(pts: [number, number][], win: number): [number, number][] {
  const n = pts.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sy = 0;
    let k = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
      sx += pts[j][0];
      sy += pts[j][1];
      k++;
    }
    out.push([sx / k, sy / k]);
  }
  return out;
}

// Erzeugt die vollständige Kamera-Bahn.
export function buildIntroCameraPath(
  route: [number, number][],
  cfg: Partial<IntroCameraConfig> = {},
): IntroKeyframe[] {
  const c = { ...DEFAULT_INTRO_CAMERA, ...cfg };
  const frames = Math.max(2, Math.round(c.fps * c.durationSec));

  // Entartete Route (kein oder ein Punkt): ruhiges Standbild.
  if (!route || route.length < 2) {
    const p = (route && route[0]) || ([13.05, 47.6] as [number, number]);
    return Array.from({ length: frames }, () => ({
      center: p,
      head: p,
      bearing: 0,
      pitch: c.pitch,
      zoom: c.zoom,
      trim: route && route.length ? 1 : 0,
    }));
  }

  // 1) Fortschritt (mit sanftem Start/Schluss) und der exakte Kopf der Linie je Frame.
  const fs: number[] = [];
  const heads: [number, number][] = [];
  for (let i = 0; i < frames; i++) {
    const f = easeInOutSine(i / (frames - 1));
    fs.push(f);
    heads.push(coordAtFraction(route, f) ?? route[route.length - 1]);
  }

  // 2) Kamera gleitet auf einer GEGLÄTTETEN Version der Köpfe (kein Zappeln bei Kurven).
  const centers = smoothPath(heads, Math.max(1, Math.round(frames * 0.05)));

  // 3) Blickrichtung: Heading der geglätteten Bahn mit Vorlauf, dann langsames Nachdrehen
  //    mit Winkelbremse -> nie schnelles Hin-und-Her-Schwenken.
  const lead = Math.max(1, Math.round(frames * 0.08));
  const emaK = 0.1; // je kleiner, desto träger/ruhiger die Drehung
  const maxStepDeg = 1.2; // harte Obergrenze pro Frame (bei 30fps = max 36°/s)

  let bearing = bearingBetween(centers[0], centers[Math.min(frames - 1, lead)]);
  const out: IntroKeyframe[] = [];
  for (let i = 0; i < frames; i++) {
    const target = bearingBetween(centers[i], centers[Math.min(frames - 1, i + lead)]);
    const aimed = unwrap(bearing, target);
    let next = bearing + emaK * (aimed - bearing);
    const step = next - bearing;
    if (step > maxStepDeg) next = bearing + maxStepDeg;
    else if (step < -maxStepDeg) next = bearing - maxStepDeg;
    bearing = next;

    out.push({
      center: centers[i],
      head: heads[i],
      bearing: ((bearing % 360) + 360) % 360,
      pitch: c.pitch,
      zoom: c.zoom,
      trim: fs[i],
    });
  }
  return out;
}
