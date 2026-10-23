import "server-only";

import { createHash } from "node:crypto";
import { bearingBetween, routeCumulativeMeters, toLocalM } from "../geo";
import type { LngLat, NormalizedRoute, RouteSource, RouteStep } from "./types";

// Was jeder Adapter gleich macht: Linie säubern, Strecke aufsummieren, Eingabepunkte auf
// die Linie legen, Kurse rechnen, Schritte abschliessen. Der Adapter liefert nur Linie und
// rohe Manöver (Index + Art + Winkel). Damit gilt für jeden Anbieter dasselbe Verfahren,
// auch wenn er einmal wechselt (docs/42, Abschnitt 2).

/** Ein Manöver, wie es ein Adapter erkennt: an welchem Punkt, welche Art, welcher Winkel. */
export type RawManeuver = {
  index: number;
  type: RouteStep["type"];
  modifier?: RouteStep["modifier"];
  /** Abbiegewinkel in Grad, -180 bis 180, positiv = rechts. */
  angleDeg: number;
  exit?: number;
};

// Obergrenze wie cleanRouteGeo (tour-route.ts): mehr Stützpunkte sind keine Runde mehr.
export const MAX_GEOMETRY_POINTS = 10_000;

// Für den Kurs VOR einem Manöver so weit zurückschauen: Ein einzelnes 2-m-Stück an der
// Kreuzung ist sonst Zufall der Kartierung.
const BEARING_LOOKBACK_M = 12;

/** Ein Eingabepunkt gilt ab diesem Abstand als "auf der Linie". */
const WAYPOINT_SNAP_M = 30;
/** Nach dem ersten Treffer so weit nach dem nächsten Minimum suchen (Kreuzung, Platz). */
const WAYPOINT_SETTLE_M = 150;
/** Ab hier bekommt der Admin eine Warnung: Der Punkt liegt neben jedem Weg. */
const WAYPOINT_WARN_M = 60;

/** Doppelte Punkte hintereinander raus, mit Abbildung alter Index -> neuer Index. */
export function dedupe(points: LngLat[]): { geometry: LngLat[]; indexMap: number[] } {
  const geometry: LngLat[] = [];
  const indexMap: number[] = [];
  for (const p of points) {
    const last = geometry[geometry.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) geometry.push(p);
    indexMap.push(geometry.length - 1);
  }
  return { geometry, indexMap };
}

/** Fingerabdruck der Linie (6 Nachkommastellen ≈ 0,1 m). */
export function lineHashOf(geometry: LngLat[]): string {
  const h = createHash("sha256");
  for (const [lng, lat] of geometry) h.update(`${lng.toFixed(6)},${lat.toFixed(6)};`);
  return h.digest("hex").slice(0, 32);
}

function segmentHit(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { t, d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) };
}

/**
 * Jeden Eingabepunkt auf die Linie legen, in Reihenfolge und nie vor dem vorigen. Genommen
 * wird die ERSTE Stelle, an der die Linie dem Punkt nahe kommt (innerhalb 150 m danach das
 * Minimum), nicht die global nächste: Auf einer Rundtour liegt das Ende am Start, und auf
 * einem Stichweg liegen Hin- und Rückweg übereinander. Mapbox lieferte die Stellen als
 * via_waypoints mit; BRouter nicht, deshalb hier.
 */
export function projectWaypoints(
  geometry: LngLat[],
  alongM: number[],
  points: LngLat[],
): { alongM: number[]; offM: number[] } {
  const out: number[] = [];
  const off: number[] = [];
  const total = alongM[alongM.length - 1] ?? 0;
  let seg0 = 0;
  let prevAlong = 0;
  points.forEach((pt, k) => {
    if (k === 0) {
      out.push(0);
      off.push(0);
      return;
    }
    const lat0 = pt[1];
    const p = toLocalM(pt, lat0);
    let best: { seg: number; along: number; d: number } | null = null;
    let firstHitAlong: number | null = null;
    for (let i = seg0; i < geometry.length - 1; i++) {
      const { t, d } = segmentHit(p, toLocalM(geometry[i], lat0), toLocalM(geometry[i + 1], lat0));
      const along = alongM[i] + t * (alongM[i + 1] - alongM[i]);
      if (along < prevAlong - 1e-6) continue;
      if (firstHitAlong != null && along > firstHitAlong + WAYPOINT_SETTLE_M) break;
      if (!best || d < best.d) best = { seg: i, along, d };
      if (firstHitAlong == null && d <= WAYPOINT_SNAP_M) firstHitAlong = along;
    }
    // Der letzte Punkt ist das Ende der Linie, egal wie weit der Weg davor endet.
    const along = k === points.length - 1 ? total : (best?.along ?? prevAlong);
    out.push(along);
    off.push(best?.d ?? Infinity);
    if (best) seg0 = best.seg;
    prevAlong = along;
  });
  return { alongM: out, offM: off };
}

/**
 * Höhen auf die gesäuberte Linie übertragen: Je neuem Punkt die Höhe seines ersten
 * Rohpunkts. Fehlt irgendwo eine Höhe, gibt es keine Reihe (null), denn ein Profil mit
 * Lücken rechnet falsche Höhenmeter.
 */
function elevationFor(indexMap: number[], count: number, raw: (number | null)[] | null | undefined): number[] | null {
  if (!raw || raw.length !== indexMap.length) return null;
  const out: number[] = new Array(count);
  for (let i = 0; i < indexMap.length; i++) {
    const j = indexMap[i];
    if (out[j] !== undefined) continue;
    const v = raw[i];
    if (v == null || !Number.isFinite(v)) return null;
    out[j] = v;
  }
  return out;
}

function bearingBeforeAt(geometry: LngLat[], alongM: number[], index: number): number {
  if (index <= 0) return geometry.length > 1 ? bearingBetween(geometry[0], geometry[1]) : 0;
  let j = index - 1;
  while (j > 0 && alongM[index] - alongM[j] < BEARING_LOOKBACK_M) j--;
  return bearingBetween(geometry[j], geometry[index]);
}

const norm360 = (deg: number) => Math.round(((deg % 360) + 360) % 360) % 360;

/**
 * Linie + rohe Manöver -> NormalizedRoute. Der Kurs danach ist Kurs davor plus Winkel des
 * Dienstes: Der Dienst misst ihn mit Blick auf die Kreuzung, und turnAngle(before, after)
 * ergibt so genau seinen Winkel. Am Ende steht immer ein "arrive" (wie bei Mapbox), denn
 * stepNav und ManeuverBanner rechnen damit.
 */
export function finishRoute(input: {
  rawGeometry: LngLat[];
  maneuvers: RawManeuver[];
  points: LngLat[];
  durationS: number | null;
  ascentM: number | null;
  source: RouteSource;
  warnings?: string[];
  /** Name je Eingabepunkt für die Hinweise; ohne: "Punkt N". */
  labels?: string[];
  /** Höhe je Punkt von rawGeometry; fehlt eine, gilt die ganze Reihe als nicht geliefert. */
  rawElevationM?: (number | null)[] | null;
}): NormalizedRoute {
  const { geometry, indexMap } = dedupe(input.rawGeometry);
  const alongM = routeCumulativeMeters(geometry);
  const distanceM = alongM[alongM.length - 1] ?? 0;
  const warnings = [...(input.warnings ?? [])];
  const elevationM = elevationFor(indexMap, geometry.length, input.rawElevationM);

  const nameOf = (k: number) => input.labels?.[k] ?? `Punkt ${k + 1}`;
  const way = projectWaypoints(geometry, alongM, input.points);
  way.offM.forEach((d, k) => {
    if (d > WAYPOINT_WARN_M && Number.isFinite(d))
      warnings.push(`${nameOf(k)} liegt ${Math.round(d)} m neben der berechneten Linie.`);
  });

  const steps: RouteStep[] = [];
  for (const m of [...input.maneuvers].sort((a, b) => a.index - b.index)) {
    const index = indexMap[m.index];
    if (index == null || index <= 0 || index >= geometry.length - 1) continue;
    const before = bearingBeforeAt(geometry, alongM, index);
    steps.push({
      index,
      alongM: alongM[index],
      type: m.type,
      modifier: m.modifier,
      bearingBefore: norm360(before),
      bearingAfter: norm360(before + m.angleDeg),
      distanceM: 0,
      ...(m.exit ? { exit: m.exit } : {}),
    });
  }
  const last = geometry.length - 1;
  const finalBearing = norm360(bearingBeforeAt(geometry, alongM, last));
  steps.push({
    index: last,
    alongM: distanceM,
    type: "arrive",
    bearingBefore: finalBearing,
    bearingAfter: finalBearing,
    distanceM: 0,
  });
  for (let i = 0; i < steps.length - 1; i++) steps[i].distanceM = steps[i + 1].alongM - steps[i].alongM;

  // Kehre genau an einem Eingabepunkt: Der Punkt liegt neben dem Weg, den das Profil nimmt,
  // und die Linie macht einen Stich hin und zurück. Mapbox tat an denselben Stellen dasselbe
  // (gemessen 23.10.2026, docs/42 Abschnitt 3); der Admin soll es sehen und den Punkt
  // auf den Weg schieben.
  for (const s of steps) {
    if (s.modifier !== "uturn") continue;
    const k = way.alongM.findIndex((a) => Math.abs(a - s.alongM) < 5);
    if (k > 0) warnings.push(`Kehre bei ${nameOf(k)} (nach ${Math.round(s.alongM)} m): Er liegt neben dem Weg.`);
  }

  return {
    v: 1,
    geometry,
    alongM,
    elevationM,
    distanceM,
    durationS: input.durationS,
    ascentM: input.ascentM,
    steps,
    waypointAlongM: way.alongM,
    lineHash: lineHashOf(geometry),
    source: input.source,
    warnings,
  };
}
