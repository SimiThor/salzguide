// Die Fälle der Navigations-Prüfung als DATEN: Routen, Fix-Folgen, Startzustände. EINE Quelle
// für zwei Verbraucher:
//   - scripts/nav-check.ts   (prüft die Ergebnisse gegen Erwartungen)
//   - scripts/nav-fixtures.ts (schreibt Eingaben + Ergebnisse als JSON für das Swift-Paket)
//
// WARUM HIER UND NICHT IN BEIDEN: Ein Fixture-Skript mit eigener Kopie der Fälle würde
// irgendwann andere Fahrten spielen als die Prüfung. Hier steht jede Fahrt genau einmal.
// Die Ergebnisse kommen aus dem ECHTEN stepNav() (src/lib/bike-nav-core.ts), nichts ist
// nachgebaut. Die Erwartungen ("Angebot bei rund 200 m") bleiben in nav-check.ts.
//
// Die Fall-Nummern sind die der Prüfung (nav:check 1 bis 32). Ein Fall kann mehrere Fahrten
// haben (Fall 19: sauber, verrauscht, ohne Kurs) und Zustands-Operationen (Fall 11, 26).
import {
  stepNav,
  initNavState,
  resetForNewRoute,
  settleSpot,
  atSpot,
  navTuningFor,
  NAV,
  WALK_NAV,
  type GeoFix,
  type NavEvent,
  type NavRoute,
  type NavState,
  type NavStep,
  type SpotPhase,
} from "../../src/lib/bike-nav-core.ts";

export type NavMode = "bike" | "walk";

// ═══════════════════════════════════════════════════════════════════════════════════
//  Bausteine (flache Rechnung um Salzburg, nur die Meter<->Grad-Umrechnung zählt)
// ═══════════════════════════════════════════════════════════════════════════════════

export const LAT0 = 47.8;
export const M_PER_DEG_LAT = 110_540;
export const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
export const START_LNG = 13.03;

export function alongRoute(d: number): [number, number] {
  return [START_LNG + d / M_PER_DEG_LNG, LAT0];
}
export function offsetNorth(p: [number, number], m: number): [number, number] {
  return [p[0], p[1] + m / M_PER_DEG_LAT];
}

// Eine gerade Route mit Spots an frei wählbaren Stellen.
export function straightRoute(lengthM: number, spotsAtM: number[] = []): NavRoute {
  const geometry: [number, number][] = [];
  for (let d = 0; d <= lengthM; d += 20) geometry.push(alongRoute(d));
  return { geometry, steps: [], spotAlongM: spotsAtM, totalM: lengthM };
}

export function fix(coord: [number, number], atMs: number, opts: Partial<GeoFix> = {}): GeoFix {
  return {
    lng: coord[0],
    lat: coord[1],
    accuracyM: opts.accuracyM ?? 10,
    headingDeg: opts.headingDeg ?? 90,
    speedMps: opts.speedMps ?? 5,
    at: atMs,
  };
}

// Quadratische Runde, Ende exakt am Start.
export function loopRoute(kanteM: number, spotsAtM: number[] = []): NavRoute {
  const pts: [number, number][] = [];
  const step = 20;
  for (let d = 0; d <= kanteM; d += step) pts.push(alongRoute(d));
  for (let d = step; d <= kanteM; d += step) pts.push(offsetNorth(alongRoute(kanteM), d));
  for (let d = step; d <= kanteM; d += step) pts.push(offsetNorth(alongRoute(kanteM - d), kanteM));
  for (let d = step; d <= kanteM; d += step) pts.push(offsetNorth(alongRoute(0), kanteM - d));
  return { geometry: pts, steps: [], spotAlongM: spotsAtM, totalM: kanteM * 4 };
}

// Runde mit Stichweg: 400 m hin, 100 m in eine Sackgasse hinauf, auf demselben Weg zurück,
// 400 m weiter. Hin- und Rückweg im Stich liegen EXAKT übereinander (Nonnberggasse).
export function spurRoute(): NavRoute {
  const spur: [number, number][] = [];
  for (let d = 0; d <= 400; d += 20) spur.push(alongRoute(d)); // hin
  for (let d = 20; d <= 100; d += 20) spur.push(offsetNorth(alongRoute(400), d)); // Stich hinauf
  for (let d = 80; d >= 0; d -= 20) spur.push(offsetNorth(alongRoute(400), d)); // und zurück
  for (let d = 20; d <= 400; d += 20) spur.push(alongRoute(400 + d)); // weiter
  return { geometry: spur, steps: [], spotAlongM: [450, 800], totalM: 1000 };
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  FAHRT-SIMULATOR (erzeugt die Fix-Folge; stepNav läuft erst in playDrive)
//
//  Bewusst KEIN Math.random(): gleicher Startwert, gleiche Zahlenfolge, überall.
// ═══════════════════════════════════════════════════════════════════════════════════

// Linearer Kongruenzgenerator, -1..1.
export function makeNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

const distM = (a: [number, number], b: [number, number]) =>
  Math.hypot((a[0] - b[0]) * M_PER_DEG_LNG, (a[1] - b[1]) * M_PER_DEG_LAT);

// Einen Weg alle `stepM` Meter abtasten: die Punktfolge, die ein Radl mit konstantem
// Tempo tatsächlich durchfährt, nicht die Stützpunkte des Wegs.
export function samplePath(path: [number, number][], stepM: number): [number, number][] {
  const out: [number, number][] = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = distM(a, b);
    if (segLen <= 0) continue;
    let t = carry;
    while (t + stepM <= segLen) {
      t += stepM;
      const f = t / segLen;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    carry = t - segLen;
  }
  return out;
}

type RideOpts = {
  // Der GEFAHRENE Weg. Weicht er von route.geometry ab, ist das eine Falschabbiegung.
  path: [number, number][];
  speedMps?: number;
  dtMs?: number;
  accuracyM?: number;
  noiseM?: number; // seitliches Rauschen (Häuserschlucht). 0 = perfektes GPS.
  seed?: number;
  haltAt?: { index: number; fixes: number }; // Ampel: gleicher Ort, Tempo 0, Zeit läuft
};

// Die Fix-Folge eines gefahrenen Wegs im festen Takt, mit reproduzierbarem Rauschen.
export function rideFixes(opts: RideOpts): GeoFix[] {
  const speed = opts.speedMps ?? 5;
  const dtMs = opts.dtMs ?? 1000;
  const noiseM = opts.noiseM ?? 0;
  const noise = makeNoise(opts.seed ?? 42);
  const points = samplePath(opts.path, (speed * dtMs) / 1000);

  const fixes: GeoFix[] = [];
  let t = 1000;
  points.forEach((p, i) => {
    const prev = points[i - 1] ?? p;
    const headingDeg =
      i === 0 ? 90 : (Math.atan2(p[0] - prev[0], p[1] - prev[1]) * 180) / Math.PI;
    const push = (speedMps: number) => {
      t += dtMs;
      fixes.push({
        lng: p[0] + (noiseM ? (noise() * noiseM) / M_PER_DEG_LNG : 0),
        lat: p[1] + (noiseM ? (noise() * noiseM) / M_PER_DEG_LAT : 0),
        accuracyM: opts.accuracyM ?? 10,
        headingDeg: ((headingDeg % 360) + 360) % 360,
        speedMps,
        at: t,
      });
    };
    push(speed);
    if (opts.haltAt && opts.haltAt.index === i) {
      for (let h = 0; h < opts.haltAt.fixes; h++) push(0);
    }
  });
  return fixes;
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  Fahrten und ihr Abspielen
// ═══════════════════════════════════════════════════════════════════════════════════

export type DriveSpec = {
  id: string; // "<fall>/<label>"
  caseId: string;
  label: string;
  mode: NavMode;
  route: NavRoute;
  // Alle Fixe, die der Simulator erzeugt hat. Mit stopOn wird danach abgeschnitten.
  fixes: GeoFix[];
  // Nur wenn die Fahrt NICHT bei initNavState(route.spotAlongM.length) beginnt (Fall 26).
  startState?: NavState;
  // Nach diesem Ereignis aufhören. Bildet nach, was die App tut: Meldet der Kern ein
  // "reroute", holt useBikeNavigation eine NEUE Route und resetForNewRoute fängt von vorn an.
  stopOn?: "reroute" | "finished";
  // Zahlen, die nur die Prüfung braucht (z.B. Index des Ausreissers); nicht im Fixture.
  meta: Record<string, number>;
};

export type DriveFrame = { state: NavState; events: NavEvent[] };

export type DriveRun = {
  spec: DriveSpec;
  fixes: GeoFix[]; // die tatsächlich gespielten (nach stopOn abgeschnitten)
  frames: DriveFrame[]; // Zustand + Ereignisse NACH jedem Fix
  states: NavState[];
  events: { type: string; index?: number }[]; // alle Ereignisse, flach
};

// Der Zustand vor dem ersten Fix.
export function initialStateOf(spec: DriveSpec): NavState {
  return spec.startState ?? initNavState(spec.route.spotAlongM.length);
}

export function playDrive(spec: DriveSpec): DriveRun {
  const tuning = navTuningFor(spec.mode);
  let state = initialStateOf(spec);
  const fixes: GeoFix[] = [];
  const frames: DriveFrame[] = [];
  const states: NavState[] = [];
  const events: { type: string; index?: number }[] = [];
  for (const f of spec.fixes) {
    const r = stepNav(state, f, spec.route, tuning);
    state = r.state;
    fixes.push(f);
    frames.push({ state, events: r.events });
    states.push(state);
    for (const e of r.events) events.push(e as { type: string; index?: number });
    if (spec.stopOn && r.events.some((e) => e.type === spec.stopOn)) break;
  }
  return { spec, fixes, frames, states, events };
}

// Zustands-Operationen neben stepNav (Fall 11, 26, 27).
export type StateOp =
  | { op: "resetForNewRoute"; state: NavState; keptPhases: SpotPhase[] }
  | { op: "settleSpot"; state: NavState; route: NavRoute | null; routeIndex: number }
  | { op: "atSpot"; phase: SpotPhase; airlineM: number | null; mode: NavMode }
  | { op: "navTuningFor"; mode: NavMode };

// Führt die Operation mit dem echten Code aus. `navTuningFor` liefert die Tabelle als Namen
// (die Tabellen selbst stehen im Manifest).
export function applyOp(o: StateOp): unknown {
  switch (o.op) {
    case "resetForNewRoute":
      return resetForNewRoute(o.state, o.keptPhases);
    case "settleSpot":
      return settleSpot(o.state, o.route, o.routeIndex);
    case "atSpot":
      return atSpot(o.phase, o.airlineM, navTuningFor(o.mode));
    case "navTuningFor": {
      const t = navTuningFor(o.mode);
      return { table: t === WALK_NAV ? "WALK_NAV" : t === NAV ? "NAV" : "unknown" };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  Die Fälle
// ═══════════════════════════════════════════════════════════════════════════════════

type DriveInit = {
  mode?: NavMode;
  route: NavRoute;
  fixes: GeoFix[];
  startState?: NavState;
  stopOn?: "reroute" | "finished";
  meta?: Record<string, number>;
};

const builders = new Map<string, () => DriveSpec>();
const caseDrives = new Map<string, string[]>();
const caseOps = new Map<string, () => StateOp[]>();
const caseTitles = new Map<string, string>();
const caseOrder: string[] = [];

function defineCase(caseId: string, title: string) {
  caseOrder.push(caseId);
  caseTitles.set(caseId, title);
  caseDrives.set(caseId, []);
}

function drive(caseId: string, label: string, init: () => DriveInit) {
  const id = `${caseId}/${label}`;
  caseDrives.get(caseId)!.push(id);
  builders.set(id, () => {
    const d = init();
    return {
      id,
      caseId,
      label,
      mode: d.mode ?? "bike",
      route: d.route,
      fixes: d.fixes,
      startState: d.startState,
      stopOn: d.stopOn,
      meta: d.meta ?? {},
    };
  });
}

// Eine Fahrt, die ein Fahrer auf `path` abspult (der Normalfall).
type RideDriveOpts = Omit<RideOpts, "path"> & { mode?: NavMode; stopOn?: "reroute" | "finished" };
function rideDrive(caseId: string, label: string, route: () => NavRoute, path: (r: NavRoute) => [number, number][], o: RideDriveOpts = {}) {
  drive(caseId, label, () => {
    const r = route();
    const { mode, stopOn, ...rest } = o;
    return { mode, route: r, fixes: rideFixes({ ...rest, path: path(r) }), stopOn };
  });
}

const geom = (r: NavRoute) => r.geometry;

const specs = new Map<string, DriveSpec>();
export function driveSpec(id: string): DriveSpec {
  let s = specs.get(id);
  if (!s) {
    const b = builders.get(id);
    if (!b) throw new Error(`unbekannte Fahrt: ${id}`);
    s = b();
    specs.set(id, s);
  }
  return s;
}
const runs = new Map<string, DriveRun>();
export function run(id: string): DriveRun {
  let r = runs.get(id);
  if (!r) {
    r = playDrive(driveSpec(id));
    runs.set(id, r);
  }
  return r;
}

export type NavCase = { id: string; title: string; driveIds: string[]; ops: StateOp[] };
export function navCases(): NavCase[] {
  return caseOrder.map((id) => ({
    id,
    title: caseTitles.get(id)!,
    driveIds: caseDrives.get(id)!,
    ops: caseOps.get(id)?.() ?? [],
  }));
}
export function caseOpsOf(caseId: string): StateOp[] {
  return caseOps.get(caseId)?.() ?? [];
}

// Frische, aber unabhängige Spot-Phasen-Eingaben dürfen nicht zwischen Aufrufen geteilt werden.
const clonePhases = (p: SpotPhase[]): SpotPhase[] => [...p];

// --- 1 bis 10
defineCase("01", "Saubere Fahrt über die ganze Runde");
rideDrive("01", "clean", () => straightRoute(1000, [200, 600, 980]), geom);

defineCase("02", "Der Play-Knopf kommt mit dem richtigen Vorlauf");
rideDrive("02", "play-lead", () => straightRoute(1000, [500]), geom);

defineCase("03", "Kein Play-Knopf, während eine Abbiegung ansteht");
rideDrive("03", "maneuver-quiet", () => {
  const route = straightRoute(1000, [500]);
  route.steps = [{ alongM: 420, instruction: "Rechts abbiegen", type: "turn", modifier: "right" }];
  return route;
}, geom);

defineCase("04", "Ein verpasster Spot blockiert die Runde nicht");
rideDrive("04", "missed-spot", () => straightRoute(1000, [300]), geom);

defineCase("05", "Zwei Spots 50 m auseinander werden beide angeboten");
rideDrive("05", "two-spots-50m", () => straightRoute(1000, [400, 450]), geom);

defineCase("06", "Ungenaue Fixe (>60m) werden gar nicht erst bewertet");
drive("06", "inaccurate-fixes", () => {
  const fixes: GeoFix[] = [];
  for (let i = 0; i < 8; i++) {
    fixes.push(fix(offsetNorth(alongRoute(i * 40), 120), 1000 + i * 2000, { accuracyM: 90 }));
  }
  return { route: straightRoute(1000, [500]), fixes };
});

defineCase("07", "Selbstkreuzende Runde: der Fortschritt darf nicht springen");
rideDrive("07", "self-crossing", () => {
  // Die Altstadt-Form: 300 m hinein, wenden, auf einer nur 4 m versetzten Linie zurück.
  const outbound: [number, number][] = [];
  for (let d = 0; d <= 300; d += 20) outbound.push(alongRoute(d));
  const back: [number, number][] = [];
  for (let d = 300; d >= 0; d -= 20) back.push(offsetNorth(alongRoute(d), 4));
  const geometry = [...outbound, ...back];
  return { geometry, steps: [], spotAlongM: [], totalM: 600 };
}, geom, { noiseM: 2.5, seed: 7 });

defineCase("08", "Ein einzelner Ausreisser darf die Fahrt nicht anhalten");
drive("08", "outlier", () => {
  const fixes: GeoFix[] = [];
  let t = 0;
  for (let d = 0; d <= 300; d += 10) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  t += 2000;
  fixes.push(fix(alongRoute(1100), t)); // Sprung, den kein Radl fahren kann
  const atOutlierIdx = fixes.length;
  for (let d = 310; d <= 400; d += 10) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  return { route: straightRoute(1000), fixes, meta: { atOutlierIdx } };
});

defineCase("09", "An der roten Ampel darf sich die Karte nicht drehen");
rideDrive("09", "red-light", () => straightRoute(400), geom, {
  noiseM: 3,
  seed: 10,
  haltAt: { index: 5, fixes: 12 },
});

defineCase("10", "Falschabbiegung: genau eine Neuberechnung, und zwar zügig");
rideDrive("10", "wrong-turn", () => straightRoute(600), () => {
  const path: [number, number][] = [];
  for (let d = 0; d <= 300; d += 20) path.push(alongRoute(d));
  for (let n = 10; n <= 120; n += 10) path.push(offsetNorth(alongRoute(300), n));
  return path;
}, { noiseM: 1.5, seed: 11, stopOn: "reroute" });

// --- 11: Zustand nach einer Neuberechnung (keine Fahrt)
defineCase("11", "Nach einer Neuberechnung bleiben gehörte Spots gehört");
caseOps.set("11", () => {
  const before: SpotPhase[] = ["done", "done", "near", "open"];
  const kept: SpotPhase[] = ["near", "open"]; // die beiden erledigten fallen weg
  const state = { ...initNavState(4), spotPhase: before, alongM: 800, bearingDeg: 123 };
  return [{ op: "resetForNewRoute", state, keptPhases: clonePhases(kept) }];
});

// --- 12 bis 18: Rundtouren und Sonderfälle
defineCase("12", "Rundtour: ein Ausreisser in Startnähe beendet die Runde NICHT");
drive("12", "loop-outlier-near-start", () => {
  const fixes: GeoFix[] = [];
  let t = 1000;
  for (let d = 0; d <= 200; d += 10) {
    t += 1000;
    fixes.push(fix(alongRoute(d), t));
  }
  // Ortungslücke von drei Minuten, dann ein Fix nahe am Start.
  t += 180_000;
  fixes.push(fix(offsetNorth(alongRoute(0), 25), t, { accuracyM: 30 }));
  return { route: loopRoute(400, [100, 500, 900, 1300]), fixes };
});

defineCase("13", "Am Start stehen und seitlich abdriften beendet die Runde NICHT");
drive("13", "loop-drift-at-start", () => {
  const fixes: GeoFix[] = [];
  let t = 1000;
  for (let i = 0; i < 8; i++) {
    t += 2000;
    fixes.push(fix(offsetNorth(alongRoute(0), i * 7), t, { accuracyM: 45, speedMps: 0.6 }));
  }
  return { route: loopRoute(400, [100, 500, 900, 1300]), fixes };
});

defineCase("14", "Falschabbiegung auf der Rundtour springt nicht auf den Rückweg");
rideDrive("14", "loop-wrong-turn", () => {
  // Die Runde benutzt dieselbe Gasse hin und zurück (8 m versetzt).
  const outbound: [number, number][] = [];
  for (let d = 0; d <= 400; d += 20) outbound.push(alongRoute(d));
  const back: [number, number][] = [];
  for (let d = 400; d >= 0; d -= 20) back.push(offsetNorth(alongRoute(d), 8));
  const geometry = [...outbound, ...back];
  return { geometry, steps: [], spotAlongM: [200, 600], totalM: 800 };
}, () => {
  const path: [number, number][] = [];
  for (let d = 0; d <= 25; d += 5) path.push(alongRoute(d));
  for (let n = 10; n <= 90; n += 10) path.push(offsetNorth(alongRoute(25), -n));
  return path;
}, { seed: 14, stopOn: "reroute" });

defineCase("15", "Ein falsches \"fertig\" ist umkehrbar");
drive("15", "reversible-finish", () => {
  const fixes: GeoFix[] = [];
  let t = 1000;
  for (let d = 0; d <= 600; d += 20) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  // Und dann fährt der Gast weiter, über das Ende hinaus zurück auf die Route.
  for (let d = 580; d >= 400; d -= 20) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  return { route: straightRoute(600, [300]), fixes };
});

defineCase("16", "Eine Kette von Abbiegungen verschluckt keinen Spot");
rideDrive("16", "maneuver-chain", () => {
  const route = straightRoute(1000, [500]);
  route.steps = [300, 400, 500, 600, 700].map((alongM) => ({
    alongM,
    instruction: "Abbiegen",
    type: "turn",
    modifier: "right",
  }));
  return route;
}, geom);

defineCase("17", "Der LETZTE Spot einer Runde wird angeboten");
rideDrive("17", "last-spot", () => {
  const route = straightRoute(1000, [1000]);
  route.steps = [
    { alongM: 880, instruction: "Rechts abbiegen", type: "turn", modifier: "right" },
    { alongM: 1000, instruction: "Ziel erreicht", type: "arrive" },
  ];
  return route;
}, geom);

defineCase("18", "Zwei Spots im selben Schritt: keiner geht verloren");
rideDrive("18", "two-spots-same-step", () => {
  const route = straightRoute(1000, [400, 480]);
  route.steps = [{ alongM: 380, instruction: "Links abbiegen", type: "turn", modifier: "left" }];
  return route;
}, geom);

// --- 19 und 24: Stichweg (dieselben Fahrten, andere Erwartung)
// Fall 19 prüft den Fortschritt, Fall 24 den fehlenden Umdreh-Hinweis; die Fahrten sind
// dieselben und entstehen deshalb aus EINER Beschreibung.
function spurDrives(caseId: string) {
  rideDrive(caseId, "clean", spurRoute, geom, { speedMps: 5 });
  // Mit verrauschtem GPS: Die Fahrtrichtung wird aus zwei Punkten gerechnet, die bei 18 km/h
  // nur rund 5 m auseinanderliegen.
  rideDrive(caseId, "noisy", spurRoute, geom, { speedMps: 5, noiseM: 8, accuracyM: 12, seed: 7 });
  // Ohne jede Geräterichtung: iOS liefert `heading` in der Geolocation-API oft gar nicht.
  drive(caseId, "no-heading", () => {
    const route = spurRoute();
    const fixes = rideFixes({ path: route.geometry, speedMps: 5 }).map((f) => ({
      ...f,
      headingDeg: null,
      speedMps: null,
    }));
    return { route, fixes };
  });
}
defineCase("19", "Stichweg: der Fortschritt läuft nicht rückwärts");
spurDrives("19");

defineCase("20", "Rundtour mit Ziel: die Runde endet am Start, nicht am letzten Spot");
rideDrive("20", "round-with-finish", () => straightRoute(1600, [400, 800]), geom, { speedMps: 5 });

// Fall 21 (isMereCurve/prepareSteps) hat keine Fahrt: eigener Fixture-Typ (NAV_STEPS_CASE_21).
defineCase("21", "Ein Bogen ist keine Abbiegung, zwei dichte gehören zusammen");

// --- 22 bis 26: was ein echter Gast tut
defineCase("22", "Ortungslücke: nach fünf Minuten und 1,5 km weiter genau eine Neuberechnung");
drive("22", "gps-gap", () => {
  const fixes: GeoFix[] = [];
  let t = 1000;
  for (let d = 0; d <= 200; d += 10) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  t += 300_000;
  const afterGapIdx = fixes.length;
  for (let d = 1700; d <= 1800; d += 10) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  // Wie die App: Beim ersten Reroute holt useBikeNavigation eine neue Route, hier Schluss.
  return { route: straightRoute(2000, [300, 1200, 1800]), fixes, stopOn: "reroute", meta: { afterGapIdx } };
});

// Die Rückwärts-Fahrt aus Fall 23, auch in Fall 32 gebraucht (Rad, Gegenrichtung).
function wrongWayDrive(caseId: string) {
  rideDrive(caseId, "wrong-way", () => straightRoute(1200, [900]), () => {
    const path: [number, number][] = [];
    for (let d = 0; d <= 500; d += 20) path.push(alongRoute(d));
    for (let d = 480; d >= 300; d -= 20) path.push(alongRoute(d));
    for (let d = 320; d <= 1000; d += 20) path.push(alongRoute(d));
    return path;
  }, { noiseM: 2, seed: 23 });
}
defineCase("23", "Gegenrichtung: ein Hinweis zum Umdrehen, keine Neuberechnung");
wrongWayDrive("23");

defineCase("24", "Stichweg: der Rückweg aus der Sackgasse ist KEINE Gegenrichtung");
spurDrives("24");

defineCase("25", "Rundtour rückwärts ab Start: Neuberechnung statt Stillstand");
rideDrive("25", "loop-backwards", () => loopRoute(400, [100, 500, 900, 1300]), () => {
  const path: [number, number][] = [];
  for (let d = 0; d <= 200; d += 10) path.push(offsetNorth(alongRoute(0), d));
  return path;
}, { stopOn: "reroute" });

defineCase("26", "Abhaken von Hand: das Ziel rückt sofort weiter, der nächste Spot kommt trotzdem");
const route26 = () => straightRoute(1000, [200, 600]);
rideDrive("26", "approach", route26, () => {
  const hin: [number, number][] = [];
  for (let d = 0; d <= 150; d += 10) hin.push(alongRoute(d));
  return hin;
});
// Weiterfahren NACH dem Abhaken: startet im Zustand, den settleSpot geliefert hat.
drive("26", "continue-after-settle", () => {
  const route = route26();
  const erst = run("26/approach");
  const vorher = erst.states[erst.states.length - 1];
  const danach = settleSpot(vorher, route, 0);
  const fixes: GeoFix[] = [];
  let t = erst.fixes[erst.fixes.length - 1].at;
  for (let d = 155; d <= 700; d += 5) {
    t += 1000;
    fixes.push(fix(alongRoute(d), t));
  }
  return { route, fixes, startState: danach };
});
// atSpot in Fall 26: Eingabe und Erwartung stehen zusammen, damit keine Eingabe ohne Erwartung
// bleiben kann. nav-check.ts prüft `expected`; das Fixture hält die Ausgabe des echten Codes.
export const AT_SPOT_CASES_26: { phase: SpotPhase; airlineM: number | null; expected: boolean; what: string }[] = [
  { phase: "open", airlineM: 400, expected: false, what: "weit weg, nicht im Fenster" },
  { phase: "pending", airlineM: 400, expected: true, what: "im Fenster entlang der Route" },
  { phase: "near", airlineM: null, expected: true, what: "angeboten, ohne Luftlinie" },
  { phase: "open", airlineM: 60, expected: true, what: "Fortschritt haengt, aber 60 m Luftlinie" },
  { phase: "open", airlineM: null, expected: false, what: "nichts bekannt" },
];
caseOps.set("26", () => {
  const route = route26();
  const erst = run("26/approach");
  const vorher = erst.states[erst.states.length - 1];
  const danach = settleSpot(vorher, route, 0);
  // "Dort gewesen": die Phase reicht, sonst die Luftlinie.
  return [
    { op: "settleSpot", state: vorher, route, routeIndex: 0 },
    { op: "settleSpot", state: danach, route, routeIndex: 0 }, // zweites Abhaken: derselbe Zustand
    ...AT_SPOT_CASES_26.map(({ phase, airlineM }) => ({ op: "atSpot" as const, phase, airlineM, mode: "bike" as const })),
  ];
});

// --- 27 bis 32: zu Fuss
defineCase("27", "Zu Fuss: Angebot bei rund 60 m, verpasst nach 40 m, Ende am Ziel");
rideDrive("27", "walk-basics", () => straightRoute(600, [200, 450]), geom, {
  mode: "walk", speedMps: 1.4, noiseM: 3, accuracyM: 12, seed: 27,
});
caseOps.set("27", () => [
  { op: "navTuningFor", mode: "walk" },
  { op: "navTuningFor", mode: "bike" },
]);

// Der Weg aus Fall 28: hin, 140 m zurück, wieder vor.
const walkWrongWayPath = (): [number, number][] => {
  const path: [number, number][] = [];
  for (let d = 0; d <= 300; d += 10) path.push(alongRoute(d));
  for (let d = 290; d >= 150; d -= 10) path.push(alongRoute(d));
  for (let d = 160; d <= 600; d += 10) path.push(alongRoute(d));
  return path;
};
defineCase("28", "Zu Fuss: Gegenrichtung wird erkannt, obwohl die Fixe nur 1,4 m auseinanderliegen");
rideDrive("28", "walk-1s", () => straightRoute(800, [550]), walkWrongWayPath, {
  mode: "walk", speedMps: 1.4, noiseM: 2, seed: 28,
});
// Dasselbe mit dünneren Fixen (alle drei Sekunden, Safari drosselt) ...
rideDrive("28", "walk-3s", () => straightRoute(800, [550]), walkWrongWayPath, {
  mode: "walk", speedMps: 1.4, dtMs: 3000, noiseM: 2, seed: 28,
});
// ... und im Tempo des Geh-Simulators (6 m/s).
rideDrive("28", "walk-6mps", () => straightRoute(800, [550]), walkWrongWayPath, {
  mode: "walk", speedMps: 6, noiseM: 2, seed: 28,
});

defineCase("29", "Zu Fuss: Stehenbleiben mit Rauschen ist weder Gegenrichtung noch Off-Route");
const walkStandingPath = (): [number, number][] => {
  const path: [number, number][] = [];
  for (let d = 0; d <= 150; d += 10) path.push(alongRoute(d));
  return path;
};
rideDrive("29", "walk-standing", () => straightRoute(600, [400]), walkStandingPath, {
  mode: "walk", speedMps: 1.4, noiseM: 6, accuracyM: 12, seed: 29,
  // Wie in der Prüfung: der Index zählt in den ABGETASTETEN Punkten (siehe rideFixes), und
  // `path.length - 1` ist dort nur zufällig die Zahl 15. Bewusst so belassen.
  haltAt: { index: walkStandingPath().length - 1, fixes: 120 },
});

defineCase("30", "Zu Fuss: keine Sperrzone, das Angebot kommt auch direkt vor einer Abbiegung");
rideDrive("30", "walk-no-quiet-zone", () => {
  const route = straightRoute(600, [200]);
  route.steps = [{ alongM: 185, instruction: "Links abbiegen", type: "turn", modifier: "left" }];
  return route;
}, geom, { mode: "walk", speedMps: 1.4 });

defineCase("31", "Zu Fuss: der Teleport-Filter lässt Stand-Rauschen durch und verwirft echte Sprünge");
drive("31", "walk-teleport-filter", () => {
  let t = 1000;
  // Achtung: `fix()` macht aus headingDeg null den Vorgabewert 90 (`??`). So lief die Prüfung
  // immer, und die Fixture hält es fest.
  const f = (d: number, dt: number) => {
    t += dt;
    return fix(alongRoute(d), t, { speedMps: 0, headingDeg: null });
  };
  return { mode: "walk", route: straightRoute(600, []), fixes: [f(100, 1000), f(107, 1000), f(122, 1000), f(113, 1000)] };
});

defineCase("32", "Der Anker ändert am Rad nichts: Stichweg und Gegenrichtung wie vorher");
rideDrive("32", "spur-bike", spurRoute, geom, { speedMps: 5 });
wrongWayDrive("32");

// ═══════════════════════════════════════════════════════════════════════════════════
//  Fall 21: Winkel, Bogen, Bündeln (src/lib/nav-steps.ts)
// ═══════════════════════════════════════════════════════════════════════════════════

export type RawCaseStep = NavStep & { angleDeg?: number | null };

// turnAngle(before, after) -> erwartet. Der Winkel war beim ersten Anlauf INVERTIERT, deshalb
// steht er als eigene Prüfung da.
export const TURN_ANGLE_CASES: { before: number; after: number; expected: number; what: string }[] = [
  { before: 0, after: 0, expected: 0, what: "geradeaus" },
  { before: 350, after: 10, expected: 20, what: "ueber die 360-Grad-Grenze" },
  { before: 10, after: 350, expected: 20, what: "andersherum ueber die Grenze" },
  { before: 0, after: 90, expected: 90, what: "rechter Winkel" },
  { before: 0, after: 180, expected: 180, what: "Kehre" },
  { before: 90, after: 120, expected: 30, what: "flacher Bogen" },
];

// Verworfen wird nur, was flach UND harmlos ist.
export const MERE_CURVE_STEPS = {
  bogen: { alongM: 100, instruction: "", type: "turn", modifier: "slight right", angleDeg: 20 } as RawCaseStep,
  knick: { alongM: 100, instruction: "", type: "end of road", modifier: "right", angleDeg: 20 } as RawCaseStep,
  ohneWinkel: { alongM: 100, instruction: "", type: "turn", modifier: "slight left", angleDeg: null } as RawCaseStep,
};

// Bündeln: die zweite bleibt eigener Schritt, hängt aber zusätzlich an der ersten.
export const PREPARE_STEPS_RAW: RawCaseStep[] = [
  { alongM: 0, instruction: "a", type: "turn", modifier: "right", angleDeg: 90 },
  { alongM: 30, instruction: "b", type: "turn", modifier: "left", angleDeg: 90 },
  { alongM: 400, instruction: "c", type: "turn", modifier: "right", angleDeg: 90 },
];

// Weitere Eingaben, die nur der Fixture-Export braucht (Randfälle der Regeln in nav-steps.ts,
// die Fall 21 nicht einzeln trifft). Fall 21 selbst bleibt oben unverändert.
export const MERE_CURVE_EXTRA_STEPS: { label: string; step: RawCaseStep }[] = [
  { label: "arrive-flat", step: { alongM: 0, instruction: "", type: "arrive", angleDeg: 5 } },
  { label: "depart-flat", step: { alongM: 0, instruction: "", type: "depart", angleDeg: 5 } },
  { label: "always-announce-modifier", step: { alongM: 0, instruction: "", type: "turn", modifier: "left", angleDeg: 10 } },
  { label: "harmless-no-modifier", step: { alongM: 0, instruction: "", type: "new name", angleDeg: 34 } },
  { label: "boundary-35", step: { alongM: 0, instruction: "", type: "continue", modifier: "slight left", angleDeg: 35 } },
  { label: "fork-flat", step: { alongM: 0, instruction: "", type: "fork", modifier: "slight left", angleDeg: 10 } },
];

// Weitere Eingaben für turnAngle/prepareSteps, die nur der Fixture-Export braucht: fehlende
// Winkel (null) und die 50-m-Grenze des Bündelns. Fall 21 selbst bleibt oben unverändert.
export const TURN_ANGLE_EXTRA_CASES: { before: number | undefined; after: number | undefined; what: string }[] = [
  { before: undefined, after: 10, what: "ohne Winkel vorher" },
  { before: 10, after: undefined, what: "ohne Winkel nachher" },
  { before: 0, after: 360, what: "volle Drehung" },
  { before: 180, after: 0, what: "Kehre andersherum" },
  { before: 359.5, after: 0.5, what: "Nachkommastellen ueber die Grenze" },
];
export const PREPARE_STEPS_EXTRA: { label: string; steps: RawCaseStep[] }[] = [
  { label: "empty", steps: [] },
  {
    label: "bundle-boundary-50m",
    steps: [
      { alongM: 0, instruction: "a", type: "turn", modifier: "right", angleDeg: 90 },
      { alongM: 50, instruction: "b", type: "turn", modifier: "left", angleDeg: 90 },
      { alongM: 101, instruction: "c", type: "turn", modifier: "right", angleDeg: 90 },
    ],
  },
  {
    label: "curve-removed-between",
    steps: [
      { alongM: 0, instruction: "a", type: "turn", modifier: "right", angleDeg: 90 },
      { alongM: 20, instruction: "bogen", type: "turn", modifier: "slight right", angleDeg: 20 },
      { alongM: 40, instruction: "b", type: "turn", modifier: "left", angleDeg: 90 },
    ],
  },
  {
    label: "arrive-bundled",
    steps: [
      { alongM: 900, instruction: "a", type: "turn", modifier: "left", angleDeg: 90 },
      { alongM: 930, instruction: "Ziel", type: "arrive" },
    ],
  },
  {
    label: "keeps-extra-fields",
    steps: [{ alongM: 5, instruction: "x", type: "fork", modifier: "slight left", angleDeg: 10 }],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════════
//  nav-format.ts und die Banner-Stufen (nav-urgency.ts): Eingaben für den Fixture-Export
// ═══════════════════════════════════════════════════════════════════════════════════
export const FORMAT_DISTANCE_INPUTS: number[] = [
  0, 2.4, 2.5, 4.9, 7.5, 49.9, 50, 54.9, 55, 99.4, 994, 994.9, 995, 999.4, 999.5, 999.9, 1000, 1049, 1050, 1249, 1250, 1251, 1749, 1750, 2249, 2250, 2251, 950, 1949, 1950,
  12_345, 99_999, -5, NaN, Infinity, -Infinity,
];
export const ARROW_MODIFIER_INPUTS: (string | undefined)[] = [
  "sharp left", "left", "slight left", "straight", "slight right", "right", "sharp right", "uturn",
  undefined, "", "unknown",
];
const ETA_REMAINING_M = [0, 10, 100, 1000, 5000, 12_345.6];
const ETA_SPEEDS: (number | null)[] = [null, 0, 0.5, 0.6, 1, 1.1, 1.25, 3.3, 5, 20];
// [remainingM, speedMps, mode]; mode fehlt = Vorgabe (Rad).
export const ETA_INPUTS: [number, number | null, NavMode | undefined][] = [
  ...(["bike", "walk"] as const).flatMap((mode) =>
    ETA_REMAINING_M.flatMap((m) => ETA_SPEEDS.map((v): [number, number | null, NavMode | undefined] => [m, v, mode])),
  ),
  [1000, 2, undefined],
  [1000, null, undefined],
  [90, 1.5, "walk"], // x.5 beim Runden: 90 / 1.5 / 60 = 1
  [135, 1.5, "walk"], // 135 / 1.5 / 60 = 1.5 -> Math.round rundet auf 2
];
const URGENCY_DISTANCES: (number | null)[] = [null, 0, 9.9, 10, 10.1, 29.9, 30, 30.1, 39.9, 40, 40.1, 119.9, 120, 120.1, 500];
export const URGENCY_INPUTS: [number | null, NavMode][] = (["bike", "walk"] as const).flatMap((mode) =>
  URGENCY_DISTANCES.map((d): [number | null, NavMode] => [d, mode]),
);
