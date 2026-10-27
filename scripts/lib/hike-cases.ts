// Die Fälle der Wander-Geometrie als DATEN: Routenform, Dauer, Höhenmeter. Verbraucher ist
// scripts/nav-fixtures.ts (Abschnitt hike/), das Eingaben UND Ergebnisse als JSON für das
// Swift-Paket SalzNavCore schreibt (HikeGeo.swift, Abschnitt "Wanderung" in docs/41).
//
// WARUM HIER: Die iOS-App führt Spaziergänger über die Route eines Spots. Dafür braucht sie
// classifyRoute (Rundweg, hin/retour oder Punkt-zu-Punkt?) und die Wanderzeit, und beides
// muss dort GLEICH rechnen wie hier, sonst steht im Spot "35 min" und am Start der Wanderung
// etwas anderes. Die Ergebnisse stammen aus dem ECHTEN geo.ts, nichts ist nachgebaut.
//
// DIE ECHTEN ROUTEN (hike-routes.json) sind die zwei kürzesten Spots mit Route, so wie die
// öffentliche App-API sie liefert (Gaisberg 90 Punkte, Kapuzinerberg 160). Die künstlichen
// Routen entstehen hier deterministisch (kein Math.random): gleiche Bytes bei jedem Lauf.
import {
  classifyRoute,
  isClosedRoute,
  walkingTimeMinutes,
  hikingTimeMinutes,
  ascentDescent,
  routeCumulativeMeters,
} from "../../src/lib/geo.ts";
import { alongRoute, offsetNorth, loopRoute } from "./nav-cases.ts";
import real from "./hike-routes.json" with { type: "json" };

type LngLat = [number, number];

// Gerader Weg mit Punkt alle 20 m, optional leicht verrauscht (deterministisch, +-amp Meter quer).
function line(lengthM: number, noiseM = 0): LngLat[] {
  const out: LngLat[] = [];
  for (let d = 0, i = 0; d <= lengthM; d += 20, i++) {
    const p = alongRoute(d);
    out.push(noiseM ? offsetNorth(p, Math.sin(i * 12.9898) * noiseM) : p);
  }
  return out;
}

// Hin und auf demselben Weg zurück (Wendepunkt = letzter Punkt des Hinwegs).
function outAndBack(outbound: LngLat[], noiseM = 0): LngLat[] {
  const back = outbound
    .slice(0, -1)
    .reverse()
    .map((p, i) => (noiseM ? offsetNorth(p, Math.sin((i + 7) * 78.233) * noiseM) : p));
  return [...outbound, ...back];
}

// Ein Bogen (Hochkeil-artig): der Weg krümmt sich, der Wendepunkt liegt nicht am weitesten Punkt vom Start.
function arc(lengthM: number): LngLat[] {
  const out: LngLat[] = [];
  for (let d = 0; d <= lengthM; d += 20) out.push(offsetNorth(alongRoute(d), 0.0015 * d * d / 10));
  return out;
}

export type ClassifyCase = { id: string; what: string; route: LngLat[] | null };

export function classifyCases(): ClassifyCase[] {
  const gaisberg = real.gaisberg.route as LngLat[];
  const kapu = real.kapuzinerberg.route as LngLat[];
  return [
    { id: "gaisberg", what: "echte Route Gaisberg (Gipfelrunde)", route: gaisberg },
    { id: "kapuzinerberg", what: "echte Route Kapuzinerberg", route: kapu },
    { id: "null", what: "keine Route", route: null },
    { id: "empty", what: "leere Route", route: [] },
    { id: "short-3", what: "unter 4 Punkten", route: line(40) },
    { id: "p2p-straight", what: "gerade, Start und Ziel weit auseinander", route: line(1200) },
    { id: "loop-square", what: "quadratischer Rundweg, Ende exakt am Start", route: loopRoute(250).geometry as LngLat[] },
    { id: "out-and-back-exact", what: "hin und auf demselben Weg zurück", route: outAndBack(line(600)) },
    { id: "out-and-back-noisy", what: "hin/retour mit 12 m Rauschen im Rückweg (Snapping-Jitter)", route: outAndBack(line(600), 12) },
    { id: "out-and-back-arc", what: "hin/retour auf einem Bogen (Wendepunkt nicht am weitesten Punkt)", route: outAndBack(arc(500)) },
    {
      id: "out-and-back-uneven",
      what: "hin/retour, Rückweg mit anderer Punktdichte",
      route: [...line(600), ...line(580).reverse().filter((_, i) => i % 2 === 0)],
    },
    {
      id: "closed-gap-100",
      what: "Rundweg, Ende 100 m neben dem Start (innerhalb 120 m: geschlossen)",
      route: [...(loopRoute(250).geometry as LngLat[]).slice(0, -1), offsetNorth(alongRoute(0), 100)],
    },
    {
      id: "open-gap-140",
      what: "Rundweg, Ende 140 m neben dem Start (ausserhalb 120 m: offen)",
      route: [...(loopRoute(250).geometry as LngLat[]).slice(0, -1), offsetNorth(alongRoute(0), 140)],
    },
    { id: "loop-with-spur", what: "Rundweg mit Stichweg: nur Teile doppelt, kein hin/retour", route: spurLoop() },
  ];
}

// Quadratrunde (250 m Kante) mit einem 100-m-Stich nach Süden, 60 m nach dem Start: hin und auf
// derselben Linie zurück, danach weiter die Runde. Nur Teile liegen doppelt, es ist kein hin/retour.
function spurLoop(): LngLat[] {
  const sq = loopRoute(250).geometry as LngLat[];
  const joint = alongRoute(60);
  const at = sq.findIndex((p) => p[0] === joint[0] && p[1] === joint[1]);
  if (at < 0) throw new Error("Stich-Abzweig liegt nicht auf der Runde");
  const south: LngLat[] = [];
  for (let d = 20; d <= 100; d += 20) south.push(offsetNorth(joint, -d));
  return [...sq.slice(0, at + 1), ...south, ...south.slice(0, -1).reverse(), joint, ...sq.slice(at + 1)];
}

export function classifyOutput(route: LngLat[] | null) {
  const cls = classifyRoute(route);
  return {
    shape: cls.shape,
    turnaroundIndex: cls.turnaroundIndex,
    closed: cls.closed,
    isClosedRoute: isClosedRoute(route),
    // Gesamtlänge in Metern (haversine), damit Swift die Summenformel mitprüft.
    totalM: route && route.length >= 2 ? routeCumulativeMeters(route)[route.length - 1] : 0,
  };
}

// Referenztouren aus scripts/hiking-check.ts (km, Aufstieg, Abstieg) und Randfälle.
export const TIME_INPUTS: [number, number, number][] = [
  [0.975, 114, 114], // Gaisberg (Gipfelrunde)
  [2.1, 159, 159], // Kapuzinerberg
  [1.3, 194, 194], // Gollinger Wasserfall
  [8.2, 770, 769],
  [7.6, 1207, 102],
  [15.6, 1253, 1253],
  [30, 2500, 2500],
  [2, 100, 100],
  [0, 0, 0],
  [0.15, 0, 0],
  [5, 0, 0], // flach: Strecke bestimmt
  [1, 600, 0], // kurz und steil: Höhe bestimmt
  [-1, -5, -5], // negativ -> 0
  [Number.NaN, 10, 10], // NaN -> 0 km
];

export const ASCENT_SERIES: { label: string; elevations: number[] }[] = [
  { label: "empty", elevations: [] },
  { label: "single", elevations: [500] },
  { label: "flat", elevations: [500, 500, 500, 500] },
  { label: "climb-100", elevations: Array.from({ length: 101 }, (_, i) => 500 + i) },
  { label: "jitter", elevations: Array.from({ length: 101 }, (_, i) => 500 + i + (i % 2 === 0 ? 1.5 : -1.5)) },
  { label: "threshold-exact-3", elevations: [500, 503, 500, 503] },
  { label: "under-threshold-2.9", elevations: [500, 502.9, 500, 502.9] },
  { label: "up-down", elevations: [500, 540, 600, 580, 520, 530, 600] },
  { label: "gaisberg-profile", elevations: real.gaisberg.elevation.points.map((p: { e: number }) => p.e) },
  { label: "kapuzinerberg-profile", elevations: real.kapuzinerberg.elevation.points.map((p: { e: number }) => p.e) },
];

export const timeOutput = (km: number, up: number, down: number) => ({
  walking: walkingTimeMinutes(km, up, down),
  hiking: hikingTimeMinutes(km, up, down),
});
export const ascentOutput = (el: number[]) => ascentDescent(el);
