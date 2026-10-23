// Eine BRouter-Route durch den ECHTEN stepNav fahren (docs/42, Abschnitt 5).
//
//   npm run routing:drive                 alle veröffentlichten Runden
//                                         (nur im Speicher, nichts wird gespeichert)
//
// Kette wie das Offline-Paket: ab Tour-Start (buildBikeChain mit from = Start). Gefahren
// wird mit dem Simulator aus scripts/lib/nav-cases.ts (rideFixes: fester Takt,
// reproduzierbares Rauschen) genau die Linie entlang, also eine fehlerfreie Fahrt. Jede
// Neuberechnung und jedes "Bitte umdrehen" ist damit ein FEHLALARM.
//
// nav-cases.ts kommt mit PR #309 (feat/nav-fixtures). Bis dahin: NAV_CASES=<pfad> setzen.
import { stepNav, initNavState, navTuningFor, type NavRoute } from "../src/lib/bike-nav-core.ts";
import { BrouterProvider } from "../src/lib/routing/brouter.ts";
import { toNavSteps, type InstructionFor } from "../src/lib/routing/types.ts";
import type { TourMode } from "../src/lib/tour-mode.ts";
import { brouterBase, loadPublishedTours, navChain, tourTitle } from "./lib/routing-tours.ts";

type RideFixes = (opts: {
  path: [number, number][];
  speedMps?: number;
  dtMs?: number;
  accuracyM?: number;
  noiseM?: number;
  seed?: number;
}) => import("../src/lib/bike-nav-core.ts").GeoFix[];
const navCasesPath = process.env.NAV_CASES ?? new URL("./lib/nav-cases.ts", import.meta.url).href;
const { rideFixes } = (await import(navCasesPath).catch(() => {
  console.error("scripts/lib/nav-cases.ts fehlt (kommt mit PR #309). Bis dahin NAV_CASES=<pfad zu nav-cases.ts> setzen.");
  process.exit(1);
})) as { rideFixes: RideFixes };

// Banner-Schwellen aus ManeuverBanner.tsx (URGENCY_M): "gleich" und "jetzt".
const BANNER: Record<TourMode, { near: number; now: number }> = { bike: { near: 120, now: 30 }, walk: { near: 40, now: 10 } };
const SPEED: Record<TourMode, number> = { bike: 5, walk: 1.4 };

// Platzhalter-Texte fürs Skript. Im Produkt kommen sie aus den Sprachdateien (docs/42, 4.3).
const instructionDe: InstructionFor = (s) => {
  if (s.type === "arrive") return "Ziel erreicht";
  if (s.modifier === "uturn") return "Wenden";
  if (s.type === "roundabout") return `Im Kreisverkehr ${s.exit ?? ""}. Ausfahrt`;
  const side = s.modifier?.includes("left") ? "links" : "rechts";
  if (s.type === "fork" || s.type === "off ramp") return `${side} halten`;
  if (s.modifier?.startsWith("sharp")) return `scharf ${side}`;
  if (s.modifier?.startsWith("slight")) return `leicht ${side}`;
  return s.modifier === "straight" ? "geradeaus" : `${side} abbiegen`;
};

type Drive = { label: string; noiseM: number; seed: number };
const DRIVES: Drive[] = [
  { label: "sauber", noiseM: 0, seed: 1 },
  { label: "Rauschen 6 m", noiseM: 6, seed: 7 },
  { label: "Rauschen 12 m", noiseM: 12, seed: 23 },
];

function drive(route: NavRoute, mode: TourMode, d: Drive) {
  const fixes = rideFixes({ path: route.geometry, speedMps: SPEED[mode], dtMs: 1000, accuracyM: 10, noiseM: d.noiseM, seed: d.seed });
  const tuning = navTuningFor(mode);
  let state = initNavState(route.spotAlongM.length);
  const ev: Record<string, number> = {};
  const near = new Set<number>();
  const now = new Set<number>();
  const offeredAt: (number | null)[] = route.spotAlongM.map(() => null);
  const firstAt: Record<string, number> = {};
  const alarmsAt: string[] = [];
  for (const f of fixes) {
    const r = stepNav(state, f, route, tuning);
    state = r.state;
    for (const e of r.events) {
      ev[e.type] = (ev[e.type] ?? 0) + 1;
      if (firstAt[e.type] == null) firstAt[e.type] = Math.round(state.alongM);
      if (e.type === "spot-near") offeredAt[e.index] = route.spotAlongM[e.index] - state.alongM;
      if (e.type === "wrong-way" || e.type === "reroute") {
        // Liegt der Fehlalarm an einer Kehre der Route? Dann ist es der Stich an einem Stopp.
        const kehre = route.steps.find((s) => s.modifier === "uturn" && Math.abs(s.alongM - state.maxAlongM) < 80);
        alarmsAt.push(`${e.type === "reroute" ? "Neuberechnung" : "umdrehen"} bei ${Math.round(state.maxAlongM)} m${kehre ? " (Kehre)" : ""}`);
      }
    }
    if (state.stepIndex >= 0 && state.distanceToManeuverM != null && !state.wrongWay) {
      if (state.distanceToManeuverM <= BANNER[mode].near) near.add(state.stepIndex);
      if (state.distanceToManeuverM <= BANNER[mode].now) now.add(state.stepIndex);
    }
  }
  const turns = route.steps.filter((s) => s.type !== "arrive").length;
  const neverNear = route.steps.map((s, i) => (s.type !== "arrive" && !near.has(i) ? i : -1)).filter((i) => i >= 0);
  const offered = offeredAt.filter((x) => x != null).length;
  return {
    fixes: fixes.length,
    turns,
    nearCount: [...near].filter((i) => route.steps[i].type !== "arrive").length,
    nowCount: [...now].filter((i) => route.steps[i].type !== "arrive").length,
    neverNear: neverNear.length,
    bundled: route.steps.filter((s) => s.followedBy).length,
    offered,
    offeredLead: offeredAt.map((x) => (x == null ? "nie" : `${Math.round(x)}`)).join("/"),
    passed: ev["spot-passed"] ?? 0,
    reroute: ev["reroute"] ?? 0,
    wrongWay: ev["wrong-way"] ?? 0,
    alarmsAt,
    finished: state.finished,
    finishedAt: firstAt["finished"],
    total: Math.round(route.totalM),
  };
}

function report(name: string, route: NavRoute, mode: TourMode) {
  console.log(`  ${name}: ${(route.totalM / 1000).toFixed(2)} km, ${route.steps.length - 1} Ansagen nach prepareSteps (+ Ankunft)`);
  for (const d of DRIVES) {
    const r = drive(route, mode, d);
    console.log(
      `    ${d.label.padEnd(13)} ${r.fixes} Fixe | Ansagen: ${r.nearCount}/${r.turns} erreichen "gleich" (${BANNER[mode].near} m), ` +
        `${r.nowCount} "jetzt", ${r.bundled} mit "dann" | Stopps angeboten ${r.offered}/${route.spotAlongM.length} ` +
        `(Vorlauf m: ${r.offeredLead}), vorbei ${r.passed} | Neuberechnung ${r.reroute}, Bitte umdrehen ${r.wrongWay} | ` +
        `Ziel ${r.finished ? `ja (Meldung bei ${r.finishedAt} von ${r.total} m)` : "NEIN"}`,
    );
    if (r.alarmsAt.length) console.log(`      Fehlalarme: ${r.alarmsAt.join(", ")}`);
  }
}

async function main() {
  const tours = await loadPublishedTours();
  const provider = new BrouterProvider(brouterBase());
  for (const t of tours) {
    const c = navChain(t);
    console.log(`${tourTitle(t)}: ab Tour-Start, ${c.stops.length} Stopps, ${c.vias.length} Wegpunkte`);
    const r = await provider.route({ points: c.chain.coords, mode: t.mode });
    const stopAlong = r.waypointAlongM.filter((_, i) => c.chain.kinds[i].kind === "stop");
    const navRoute: NavRoute = {
      geometry: r.geometry,
      steps: toNavSteps(r.steps, instructionDe),
      spotAlongM: stopAlong,
      totalM: r.distanceM,
    };
    report(`BRouter ${r.source.profile}`, navRoute, t.mode);
    console.log("");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
