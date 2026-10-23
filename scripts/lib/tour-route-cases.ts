// Die Aufrufe der Routen-Prüfung als DATEN: welche reine Funktion (src/lib/tour-route.ts,
// src/lib/bike-directions.ts) mit welchen Eingaben aufgerufen wird. EINE Quelle für zwei
// Verbraucher:
//   - scripts/tour-route-check.ts (prüft die Ergebnisse gegen Erwartungen)
//   - scripts/nav-fixtures.ts     (schreibt Eingaben + Ergebnis als JSON fürs Swift-Paket)
//
// Die Ergebnisse kommen aus den ECHTEN Funktionen. Die Erwartungen bleiben in der Prüfung.
// Eingaben dürfen von früheren Ergebnissen abhängen (`args` ist eine Funktion): Das bildet
// die Kette "clean -> reconcile -> Marke" nach, ohne dass die Daten kopiert werden.
import {
  cleanRouteVia,
  chainKeys,
  reconcileVia,
  flattenChain,
  chainCoords,
  tourRouteHash,
  legForTap,
  insertVia,
  moveVia,
  removeVia,
  viaIdOf,
  countVia,
  type LngLat,
  type ViaLeg,
} from "@/lib/tour-route";
import { buildBikeChain, selectNavVias, alongFromViaWaypoints, type NavVia } from "@/lib/bike-directions";

// Flache Rechnung um Salzburg: x nach Osten, y nach Norden, in Metern.
export const LAT0 = 47.8;
export const LNG0 = 13.03;
export const M_PER_DEG_LAT = 110_540;
export const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
export const P = (x: number, y: number): LngLat => [LNG0 + x / M_PER_DEG_LNG, LAT0 + y / M_PER_DEG_LAT];
export const RP = (x: number, y: number) => ({ lng: P(x, y)[0], lat: P(x, y)[1] });
export const leg = (from: string, to: string, ...pts: LngLat[]): ViaLeg => ({ from, to, coords: pts });

// Die Funktionen, die Fixtures bekommen. Der Name ist der Schlüssel im JSON.
const FUNCTIONS = {
  tourRouteHash,
  cleanRouteVia,
  chainKeys,
  reconcileVia,
  flattenChain,
  chainCoords,
  countVia,
  legForTap,
  insertVia,
  moveVia,
  removeVia,
  viaIdOf,
  selectNavVias,
  buildBikeChain,
  alongFromViaWaypoints,
} as const;
export type TourRouteFn = keyof typeof FUNCTIONS;

export type TourRouteCall = { id: string; fn: TourRouteFn; args: () => unknown[] };

const calls: TourRouteCall[] = [];
const byId = new Map<string, TourRouteCall>();
function def(id: string, fn: TourRouteFn, args: () => unknown[]) {
  const c = { id, fn, args };
  calls.push(c);
  byId.set(id, c);
}

export function tourRouteCalls(): readonly TourRouteCall[] {
  return calls;
}

// Ein Aufruf mit dem echten Code, jedes Mal frisch (für "zweimal gleich"-Prüfungen).
export function evaluate(id: string): unknown {
  const c = byId.get(id);
  if (!c) throw new Error(`unbekannter Aufruf: ${id}`);
  return (FUNCTIONS[c.fn] as (...a: unknown[]) => unknown)(...c.args());
}
const memo = new Map<string, unknown>();
export function out<T = unknown>(id: string): T {
  if (!memo.has(id)) memo.set(id, evaluate(id));
  return memo.get(id) as T;
}
export function argsOf(id: string): unknown[] {
  const c = byId.get(id);
  if (!c) throw new Error(`unbekannter Aufruf: ${id}`);
  return c.args();
}

// ── 1. Die Marke ──────────────────────────────────────────────────────────────────────
export const S1_BASE = () => ({
  start: RP(0, 0),
  end: RP(0, 0),
  stops: [
    { id: "a", coord: P(0, 300) },
    { id: "b", coord: P(100, 300) },
  ],
  mode: "bike" as const,
  via: [] as ViaLeg[],
});
export const S1_WITH_VIA = () => ({ ...S1_BASE(), via: [leg("a", "b", P(50, 320))] });
def("01/hash-base", "tourRouteHash", () => [S1_BASE()]);
def("01/hash-mode-walk", "tourRouteHash", () => [{ ...S1_BASE(), mode: "walk" }]);
def("01/hash-with-via", "tourRouteHash", () => [S1_WITH_VIA()]);
def("01/hash-via-moved-2m", "tourRouteHash", () => [{ ...S1_BASE(), via: [leg("a", "b", P(52, 320))] }]);
def("01/hash-noisy", "tourRouteHash", () => {
  const base = S1_BASE();
  return [
    {
      ...base,
      stops: base.stops.map((s) => ({ ...s, coord: [s.coord[0] + 1e-8, s.coord[1] - 1e-8] as LngLat })),
    },
  ];
});
def("01/chain-keys", "chainKeys", () => [S1_BASE().start, S1_BASE().end, ["a", "b"]]);
def("01/clean-via", "cleanRouteVia", () => [S1_WITH_VIA().via]);
def("01/reconcile-cleaned", "reconcileVia", () => [out("01/clean-via"), out("01/chain-keys")]);
def("01/hash-cleaned-reconciled", "tourRouteHash", () => [
  { ...S1_WITH_VIA(), via: (out("01/reconcile-cleaned") as { legs: ViaLeg[] }).legs },
]);
def("01/hash-station-moved", "tourRouteHash", () => {
  const base = S1_BASE();
  return [{ ...base, stops: [{ id: "a", coord: P(0, 310) }, base.stops[1]] }];
});

// ── 2. Fremde Daten festnageln ────────────────────────────────────────────────────────
export const S2_GARBAGE: [string, string, unknown][] = [
  ["null", "null", null],
  ["undefined", "undefined", undefined],
  ["leer", "empty", []],
  ["String", "string", "x"],
  ["Objekt", "object", {}],
  ["Schlüssel keine Strings", "keys-not-strings", [{ from: 1, to: "b", coords: [[13, 47]] }]],
  ["from = to", "from-equals-to", [{ from: "a", to: "a", coords: [[13, 47]] }]],
  ["NaN", "nan", [{ from: "a", to: "b", coords: [[NaN, 47]] }]],
  ["ausserhalb", "out-of-range", [{ from: "a", to: "b", coords: [[13, 97]] }]],
  ["ohne Koordinaten", "no-coords", [{ from: "a", to: "b", coords: [] }]],
];
for (const [, key, v] of S2_GARBAGE) def(`02/garbage-${key}`, "cleanRouteVia", () => [v]);
def("02/cap-per-leg", "cleanRouteVia", () => [
  [{ from: "a", to: "b", coords: Array.from({ length: 30 }, () => [13, 47]) }],
]);
def("02/cap-total", "cleanRouteVia", () => [
  [
    { from: "a", to: "b", coords: Array.from({ length: 20 }, () => [13, 47]) },
    { from: "b", to: "c", coords: Array.from({ length: 10 }, () => [13, 47]) },
  ],
]);
def("02/count-cap-total", "countVia", () => [out("02/cap-total")]);
def("02/duplicate-pair", "cleanRouteVia", () => [
  [
    { from: "a", to: "b", coords: [[13, 47]] },
    { from: "a", to: "b", coords: [[13.1, 47.1]] },
  ],
]);
def("02/broken-coordinate", "cleanRouteVia", () => [[{ from: "a", to: "b", coords: [[13, 47], "kaputt"] }]]);

// ── 3. Wegpunkte folgen den Abschnitten ───────────────────────────────────────────────
export const S3_START = "start";
export const S3_END = "end";
export const S3_LEGS = (): ViaLeg[] => [
  leg(S3_START, "1", P(1, 1)),
  leg("1", "2", P(2, 2)),
  leg("2", "3", P(3, 3), P(3, 4)),
  leg("3", "4", P(4, 4)),
  leg("4", S3_END, P(5, 5)),
];
const S = S3_START;
const E = S3_END;
def("03/unchanged", "reconcileVia", () => [S3_LEGS(), [S, "1", "2", "3", "4", E]]);
def("03/swap-2-3", "reconcileVia", () => [S3_LEGS(), [S, "1", "3", "2", "4", E]]);
def("03/remove-2", "reconcileVia", () => [S3_LEGS(), [S, "1", "3", "4", E]]);
def("03/remove-2-3", "reconcileVia", () => [S3_LEGS(), [S, "1", "4", E]]);
def("03/remove-start", "reconcileVia", () => [S3_LEGS(), ["1", "2", "3", "4", E]]);
def("03/remove-start-end", "reconcileVia", () => [S3_LEGS(), ["1", "2", "3", "4"]]);
def("03/unknown-keys", "reconcileVia", () => [[leg("x", "y", P(9, 9)), ...S3_LEGS()], [S, "1", "2", "3", "4", E]]);
def("03/idempotent", "reconcileVia", () => [
  (out("03/swap-2-3") as { legs: ViaLeg[] }).legs,
  [S, "1", "3", "2", "4", E],
]);
def("03/skipped-stop", "reconcileVia", () => [S3_LEGS(), [S, "2", "4", E]]);

// ── 4. Die Kette ───────────────────────────────────────────────────────────────────────
export const S4_STOPS = () => [
  { id: "a", coord: P(0, 100) },
  { id: "b", coord: P(0, 200) },
  { id: "c", coord: P(0, 300) },
];
export const S4_VIA = () => [leg("start", "a", P(0, 50)), leg("b", "c", P(0, 250))];
export const S4_MANY = () => Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, coord: P(i * 10, 0) }));
def("04/chain", "flattenChain", () => [{ start: RP(0, 0), end: RP(0, 400), stops: S4_STOPS(), via: S4_VIA() }]);
def("04/chain-no-start", "flattenChain", () => [{ start: null, end: RP(0, 400), stops: S4_STOPS(), via: S4_VIA() }]);
def("04/chain-no-end", "flattenChain", () => [{ start: RP(0, 0), end: null, stops: S4_STOPS(), via: S4_VIA() }]);
def("04/chain-unplaced", "flattenChain", () => [
  { start: null, end: null, stops: [{ id: "x", coord: null }, ...S4_STOPS()], via: [] },
]);
def("04/coords-unplaced", "chainCoords", () => [out("04/chain-unplaced")]);
def("04/chain-full", "flattenChain", () => [{ start: RP(-10, 0), end: RP(240, 0), stops: S4_MANY(), via: [] }]);
def("04/coords-full", "chainCoords", () => [out("04/chain-full")]);
def("04/chain-over", "flattenChain", () => [
  { start: RP(-10, 0), end: RP(240, 0), stops: S4_MANY(), via: [leg("start", "p0", P(-5, 0))] },
]);
def("04/coords-over", "chainCoords", () => [out("04/chain-over")]);

// ── 5. Wo ein Tipp hingehört ──────────────────────────────────────────────────────────
// U-förmige Linie: hinauf, hinüber, hinunter, dann nach Osten.
export const S5_LINE = (): LngLat[] => {
  const line: LngLat[] = [];
  for (let y = 0; y <= 300; y += 10) line.push(P(0, y));
  for (let x = 10; x <= 100; x += 10) line.push(P(x, 300));
  for (let y = 290; y >= 0; y -= 10) line.push(P(100, y));
  for (let x = 110; x <= 200; x += 10) line.push(P(x, 0));
  return line;
};
const s5chain = (via: ViaLeg[], aY = 0) =>
  flattenChain({ start: RP(0, 0), end: RP(200, 0), stops: [{ id: "A", coord: P(100, aY) }], via });
const S5_VIAS = () => [leg("start", "A", P(0, 150), P(100, 300))];
const S5_TAP = () => P(100, 150); // rechter Arm des U, kurz vor Station A
def("05/on-line", "legForTap", () => [{ chain: s5chain([]), line: S5_LINE(), tap: S5_TAP() }]);
def("05/stale", "legForTap", () => [{ chain: s5chain([]), line: S5_LINE(), tap: S5_TAP(), stale: true }]);
def("05/no-line", "legForTap", () => [{ chain: s5chain([]), line: null, tap: S5_TAP() }]);
def("05/between-vias", "legForTap", () => [{ chain: s5chain(S5_VIAS()), line: S5_LINE(), tap: P(50, 300) }]);
def("05/between-vias-stale", "legForTap", () => [
  { chain: s5chain(S5_VIAS()), line: S5_LINE(), tap: P(50, 300), stale: true },
]);
def("05/after-vias", "legForTap", () => [{ chain: s5chain(S5_VIAS()), line: S5_LINE(), tap: P(100, 100) }]);
// Station A 80 m neben der Linie: Die Linie passt nicht mehr, also gerade Kette.
def("05/anchor-off-line", "legForTap", () => [{ chain: s5chain([], -80), line: S5_LINE(), tap: P(150, 0) }]);
def("05/anchor-off-line-stale", "legForTap", () => [
  { chain: s5chain([], -80), line: S5_LINE(), tap: P(150, 0), stale: true },
]);
def("05/single-anchor", "legForTap", () => [
  {
    chain: flattenChain({ start: RP(0, 0), end: null, stops: [], via: [] }),
    line: S5_LINE(),
    tap: S5_TAP(),
  },
]);

// ── 6. Formular-Helfer ────────────────────────────────────────────────────────────────
export const S6_LEGS = (): ViaLeg[] => [leg("start", "a", P(1, 1), P(3, 3)), leg("a", "b", P(5, 5))];
def("06/insert-at-1", "insertVia", () => [S6_LEGS(), "start", "a", 1, P(2, 2)]);
def("06/insert-new-leg", "insertVia", () => [S6_LEGS(), "b", "end", 0, P(7, 7)]);
def("06/move", "moveVia", () => [S6_LEGS(), viaIdOf(P(3, 3)), P(4, 4)]);
def("06/remove", "removeVia", () => [S6_LEGS(), viaIdOf(P(5, 5))]);
def("06/via-id", "viaIdOf", () => [P(1, 1)]);
def("06/via-id-noisy", "viaIdOf", () => [[P(1, 1)[0] + 1e-9, P(1, 1)[1]]]);

// ── 7. Navigation ─────────────────────────────────────────────────────────────────────
export const S7 = (() => {
  const stopCoords = [P(0, 300), P(100, 300), P(200, 300), P(300, 300)];
  const start = P(0, 0);
  const a = P(0, 150);
  const b = P(50, 320);
  const c = P(150, 320);
  const d = P(250, 320);
  const e = P(300, 150);
  const legs = [leg("start", "0", a), leg("0", "1", b), leg("1", "2", c), leg("2", "3", d), leg("3", "end", e)];
  return { stopCoords, start, a, b, c, d, e, legs };
})();
const id7 = viaIdOf;
const base7 = () => ({
  legs: S7.legs,
  stopCoords: S7.stopCoords,
  end: S7.start as LngLat | null,
  origin: S7.start,
  isReroute: false,
});
def("07/fresh-start", "selectNavVias", () => [{ ...base7(), keep: [0, 1, 2, 3] }]);
def("07/chain-fresh-start", "buildBikeChain", () => [
  S7.start,
  S7.stopCoords,
  S7.start,
  out("07/fresh-start"),
]);
def("07/reentry-before-stop-2", "selectNavVias", () => [{ ...base7(), keep: [2, 3], origin: P(120, 300) }]);
def("07/reroute", "selectNavVias", () => [
  {
    ...base7(),
    keep: [1, 2, 3],
    origin: P(90, 300),
    isReroute: true,
    alongM: 530,
    viaAlongM: { [id7(S7.c)]: 550, [id7(S7.d)]: 750 },
  },
]);
def("07/skipped-stop-1", "selectNavVias", () => [{ ...base7(), keep: [0, 2, 3] }]);
def("07/no-end", "selectNavVias", () => [{ ...base7(), keep: [0, 1, 2, 3], end: null }]);
def("07/chain-no-end", "buildBikeChain", () => [S7.start, S7.stopCoords, null, out("07/no-end")]);
// Deckel: 22 Halte + Origin + Ziel = 24, Platz für genau einen Wegpunkt.
const manyStops7 = () => Array.from({ length: 22 }, (_, i) => P(i * 10, 300));
def("07/cap-one-via", "selectNavVias", () => [
  {
    legs: [leg("start", "0", P(0, 150)), leg("21", "end", P(210, 150))],
    keep: manyStops7().map((_, i) => i),
    stopCoords: manyStops7(),
    end: S7.start,
    origin: S7.start,
    isReroute: false,
  },
]);
const tenStops7 = () => Array.from({ length: 10 }, (_, i) => P(i * 10, 300));
def("07/cap-large", "selectNavVias", () => [
  {
    legs: [
      leg("start", "0", P(0, 100), P(0, 200)),
      ...Array.from({ length: 9 }, (_, i) => leg(String(i), String(i + 1), P(i * 10 + 3, 310), P(i * 10 + 6, 310))),
    ],
    keep: tenStops7().map((_, i) => i),
    stopCoords: tenStops7(),
    end: S7.start,
    origin: S7.start,
    isReroute: false,
  },
]);
def("07/chain-cap-large", "buildBikeChain", () => [S7.start, tenStops7(), S7.start, out("07/cap-large")]);
def("07/no-stops", "selectNavVias", () => [{ ...base7(), keep: [] }]);

// ── 8. Antwort zurücklesen ────────────────────────────────────────────────────────────
export const S8 = (() => {
  const start = P(0, 0);
  const stops = [P(0, 300), P(100, 300)];
  const vias: NavVia[] = [
    { id: "v1", coord: P(0, 150), before: 0 },
    { id: "v2", coord: P(50, 320), before: 1 },
  ];
  // origin, v1, s0, v2, s1, end -> stille Punkte 1..4
  const cum = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
  const via = [
    { waypoint_index: 1, geometry_index: 1, distance_from_start: 50 },
    { waypoint_index: 2, geometry_index: 3, distance_from_start: 150 },
    { waypoint_index: 3, geometry_index: 5, distance_from_start: 250 },
    { waypoint_index: 4, geometry_index: 7, distance_from_start: 350 },
  ];
  return { start, stops, vias, cum, via };
})();
def("08/chain-mixed", "buildBikeChain", () => [S8.start, S8.stops, S8.start, S8.vias]);
def("08/along-mixed", "alongFromViaWaypoints", () => [
  (out("08/chain-mixed") as ReturnType<typeof buildBikeChain>).kinds,
  S8.via,
  S8.cum,
  S8.stops.length,
]);
def("08/chain-plain", "buildBikeChain", () => [S8.start, S8.stops, null, []]);
def("08/along-plain", "alongFromViaWaypoints", () => [
  (out("08/chain-plain") as ReturnType<typeof buildBikeChain>).kinds,
  [{ waypoint_index: 1, geometry_index: 4, distance_from_start: 200 }],
  S8.cum,
  S8.stops.length,
]);
def("08/along-unknown-index", "alongFromViaWaypoints", () => [
  (out("08/chain-plain") as ReturnType<typeof buildBikeChain>).kinds,
  [{ waypoint_index: 9, geometry_index: 4, distance_from_start: 200 }],
  S8.cum,
  S8.stops.length,
]);
