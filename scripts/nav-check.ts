// Prüft den reinen Entscheidungs-Kern des Rad-Audioguides (bike-nav-core.ts) gegen
// synthetische GPS-Fix-Folgen. Aufruf:
//   npm run nav:check
//
// WARUM ES DIESES SKRIPT GIBT: Priorität 1 der Runde ist zuverlässige Navigation (siehe
// docs/40). Ob der Play-Knopf rechtzeitig kommt, ob eine Neuberechnung feuert und ob der
// Fortschritt stimmt, entscheidet direkt darüber, ob ein Radl mitten in der Fahrt in die
// Irre geführt wird. Das lässt sich nicht "beim Testen am Handy mal kurz schauen", weil
// man dafür wirklich fahren müsste. Es importiert den ECHTEN stepNav() aus src/lib, baut
// also nichts nach.
import {
  stepNav,
  initNavState,
  resetForNewRoute,
  NAV,
  type GeoFix,
  type NavRoute,
  type NavState,
  type SpotPhase,
} from "../src/lib/bike-nav-core.ts";

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, detail: string) => {
  failed++;
  console.log(`  FEHLT ${name}\n        ${detail}`);
};

// Flache Rechnung reicht: Alle Szenarien spielen auf wenigen hundert Metern um Salzburg
// (nur die Meter<->Grad-Umrechnung ist relevant).
const LAT0 = 47.8;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const START_LNG = 13.03;

function alongRoute(d: number): [number, number] {
  return [START_LNG + d / M_PER_DEG_LNG, LAT0];
}
function offsetNorth(p: [number, number], m: number): [number, number] {
  return [p[0], p[1] + m / M_PER_DEG_LAT];
}

// Eine gerade Route mit Spots an frei wählbaren Stellen.
function straightRoute(lengthM: number, spotsAtM: number[] = []): NavRoute {
  const geometry: [number, number][] = [];
  for (let d = 0; d <= lengthM; d += 20) geometry.push(alongRoute(d));
  return { geometry, steps: [], spotAlongM: spotsAtM, totalM: lengthM };
}

function fix(coord: [number, number], atMs: number, opts: Partial<GeoFix> = {}): GeoFix {
  return {
    lng: coord[0],
    lat: coord[1],
    accuracyM: opts.accuracyM ?? 10,
    headingDeg: opts.headingDeg ?? 90,
    speedMps: opts.speedMps ?? 5,
    at: atMs,
  };
}

type RunResult = { states: NavState[]; events: { type: string; index?: number }[] };

function runOn(route: NavRoute, fixes: GeoFix[], startState?: NavState): RunResult {
  let state = startState ?? initNavState(route.spotAlongM.length);
  const states: NavState[] = [];
  const events: { type: string; index?: number }[] = [];
  for (const f of fixes) {
    const r = stepNav(state, f, route);
    state = r.state;
    states.push(state);
    for (const e of r.events) events.push(e as { type: string; index?: number });
  }
  return { states, events };
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  FAHRT-SIMULATOR
//
//  Spielt einen GEFAHRENEN WEG im Sekundentakt ab: tastet ihn nach Geschwindigkeit ab,
//  legt reproduzierbares Rauschen darauf und schickt jeden Fix durch denselben stepNav()
//  wie die App. Bewusst KEIN Math.random(): ein Test, der bei jedem Lauf andere Zahlen
//  sieht, meldet Fehler, die niemand nachstellen kann.
// ═══════════════════════════════════════════════════════════════════════════════════

// Linearer Kongruenzgenerator: gleicher Startwert, gleiche Zahlenfolge, überall. -1..1.
function makeNoise(seed: number): () => number {
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
function samplePath(path: [number, number][], stepM: number): [number, number][] {
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
  route: NavRoute;
  // Der GEFAHRENE Weg. Weicht er von route.geometry ab, ist das eine Falschabbiegung.
  path: [number, number][];
  speedMps?: number;
  dtMs?: number;
  accuracyM?: number;
  noiseM?: number; // seitliches Rauschen (Häuserschlucht). 0 = perfektes GPS.
  seed?: number;
  haltAt?: { index: number; fixes: number }; // Ampel: gleicher Ort, Tempo 0, Zeit läuft
  // Nach diesem Ereignis aufhören. Bildet nach, was die App tut: Meldet der Kern ein
  // "reroute", holt useBikeNavigation eine NEUE Route und resetForNewRoute fängt von vorn
  // an. Fährt der Simulator stattdessen stur gegen die alte Geometrie weiter, meldet er
  // nach Ablauf der Cooldown ein zweites Reroute, das es in der App nie gäbe.
  stopOn?: "reroute" | "finished";
};

function ride(opts: RideOpts): { fixes: GeoFix[] } & RunResult {
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

  let state = initNavState(opts.route.spotAlongM.length);
  const states: NavState[] = [];
  const events: { type: string; index?: number }[] = [];
  const used: GeoFix[] = [];
  for (const f of fixes) {
    const r = stepNav(state, f, opts.route);
    state = r.state;
    states.push(state);
    used.push(f);
    for (const e of r.events) events.push(e as { type: string; index?: number });
    if (opts.stopOn && r.events.some((e) => e.type === opts.stopOn)) break;
  }
  return { fixes: used, states, events };
}

const countOf = (evts: { type: string }[], t: string) => evts.filter((e) => e.type === t).length;

console.log("1. Saubere Fahrt über die ganze Runde");
{
  const route = straightRoute(1000, [200, 600, 980]);
  const { states, events } = ride({ route, path: route.geometry });

  if (countOf(events, "reroute") === 0) ok("keine Neuberechnung auf der sauberen Route");
  else bad("Neuberechnung auf sauberer Route", `${countOf(events, "reroute")} statt 0`);

  if (countOf(events, "finished") === 1) ok("genau ein Ende der Runde");
  else bad("Ende der Runde", `${countOf(events, "finished")} Ereignis(se) statt 1`);

  // Jeder Spot genau einmal angeboten. Der letzte liegt 20 m vor Schluss, er wird also
  // angeboten, aber nicht mehr passiert – das ist richtig so, die Runde endet dort.
  const near = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (near.length === 3 && new Set(near).size === 3) ok("jeder der drei Spots genau einmal angeboten");
  else bad("Spot-Angebote", `${near.length} Ereignis(se): ${JSON.stringify(near)}`);

  const last = states[states.length - 1];
  if (last.spotPhase[0] === "done" && last.spotPhase[1] === "done") {
    ok("die beiden ersten Spots stehen am Ende auf erledigt");
  } else {
    bad("Spot-Phasen am Ende", JSON.stringify(last.spotPhase));
  }
}

console.log("\n2. Der Play-Knopf kommt mit dem richtigen Vorlauf");
{
  // 30 Sekunden bei 18 km/h sind 150 m (docs/40). Die Prüfung misst, bei welchem Abstand
  // das Angebot wirklich feuert – daran hängt, ob der Gast den Daumen rechtzeitig hebt.
  const route = straightRoute(1000, [500]);
  const { states, events } = ride({ route, path: route.geometry });
  const idx = events.findIndex((e) => e.type === "spot-near");
  if (idx < 0) {
    bad("Play-Knopf erscheint nie", "kein spot-near-Ereignis");
  } else {
    // Der Zustand beim Feuern: wie weit war der Spot da noch weg?
    const atFire = states.find((s) => s.spotPhase[0] === "near");
    const ahead = atFire ? 500 - atFire.alongM : NaN;
    if (ahead <= NAV.SPOT_NEAR_M && ahead > NAV.SPOT_NEAR_M - 20) {
      ok(`Angebot bei ${ahead.toFixed(0)} m Vorlauf (Sollwert ${NAV.SPOT_NEAR_M} m)`);
    } else {
      bad("Vorlauf des Play-Knopfs", `${ahead.toFixed(0)} m statt rund ${NAV.SPOT_NEAR_M} m`);
    }
  }
}

console.log("\n3. Kein Play-Knopf, während eine Abbiegung ansteht");
{
  // Sicherheitsregel aus docs/40: Wer gleich abbiegt, bekommt nicht im selben Moment eine
  // Geschichte angeboten. Der Spot darf dadurch aber nicht verloren gehen, er kommt nach
  // der Abbiegung dran.
  const route = straightRoute(1000, [500]);
  route.steps = [{ alongM: 420, instruction: "Rechts abbiegen", type: "turn", modifier: "right" }];
  const { states, events } = ride({ route, path: route.geometry });

  const atFire = states.find((s) => s.spotPhase[0] === "near");
  if (!atFire) {
    bad("Spot geht durch die Sperrzone verloren", "kein spot-near-Ereignis");
  } else if (atFire.alongM > 420) {
    ok(`Angebot erst nach der Abbiegung (bei ${atFire.alongM.toFixed(0)} m)`);
  } else {
    bad("Angebot kommt in der Sperrzone", `bei ${atFire.alongM.toFixed(0)} m, Abbiegung liegt bei 420 m`);
  }
  if (countOf(events, "spot-near") === 1) ok("und nur ein einziges Mal");
  else bad("Angebot feuert mehrfach", `${countOf(events, "spot-near")} statt 1`);
}

console.log("\n4. Ein verpasster Spot blockiert die Runde nicht");
{
  // Der Gast drückt nie Play. Der Spot muss trotzdem irgendwann als erledigt gelten,
  // sonst bliebe er für immer "der nächste" und die Anzeige stünde still.
  const route = straightRoute(1000, [300]);
  const { states, events } = ride({ route, path: route.geometry });
  const passed = events.filter((e) => e.type === "spot-passed");
  if (passed.length === 1 && passed[0].index === 0) ok("der ungehörte Spot wird verbucht");
  else bad("verpasster Spot", `${passed.length} Ereignis(se): ${JSON.stringify(passed)}`);
  const last = states[states.length - 1];
  if (last.nextSpotIndex === -1) ok("danach steht kein Spot mehr offen");
  else bad("Spot bleibt offen", `nextSpotIndex ${last.nextSpotIndex}`);
}

console.log("\n5. Zwei Spots 50 m auseinander werden beide angeboten");
{
  // In der Altstadt der Normalfall (Residenzplatz und Domplatz). Im alten Etappen-Modell
  // hing die Runde hier fest, weil die Ankunft nie scharf wurde.
  const route = straightRoute(1000, [400, 450]);
  const { events } = ride({ route, path: route.geometry });
  const near = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (near.length === 2 && near[0] === 0 && near[1] === 1) ok("beide Spots angeboten, in der richtigen Reihenfolge");
  else bad("Spots 50 m auseinander", `${JSON.stringify(near)} statt [0,1]`);
}

console.log("\n6. Ungenaue Fixe (>60m) werden gar nicht erst bewertet");
{
  const route = straightRoute(1000, [500]);
  const fixes: GeoFix[] = [];
  for (let i = 0; i < 8; i++) {
    fixes.push(fix(offsetNorth(alongRoute(i * 40), 120), 1000 + i * 2000, { accuracyM: 90 }));
  }
  const { states, events } = runOn(route, fixes);
  if (events.length === 0) ok("keine Ereignisse aus ungenauen Fixen");
  else bad("Ereignisse trotz schlechter Genauigkeit", JSON.stringify(events));
  if (states[states.length - 1].alongM === 0) ok("Zustand bleibt beim Ausgangswert");
  else bad("Zustand wurde verändert", `alongM ${states[states.length - 1].alongM}`);
}

console.log("\n7. Selbstkreuzende Runde: der Fortschritt darf nicht springen");
{
  // Die Altstadt-Form: 300 m hinein, wenden, auf einer nur 4 m versetzten Linie zurück.
  // Auf einer GANZEN Runde ist das keine Ausnahme mehr, sondern die Regel: eine Rundtour
  // endet dort, wo sie beginnt.
  const outbound: [number, number][] = [];
  for (let d = 0; d <= 300; d += 20) outbound.push(alongRoute(d));
  const back: [number, number][] = [];
  for (let d = 300; d >= 0; d -= 20) back.push(offsetNorth(alongRoute(d), 4));
  const geometry = [...outbound, ...back];
  const route: NavRoute = { geometry, steps: [], spotAlongM: [], totalM: 600 };

  const { states } = ride({ route, path: geometry, noiseM: 2.5, seed: 7 });
  let worst = 0;
  for (let i = 1; i < states.length; i++) {
    const drop = states[i - 1].alongM - states[i].alongM;
    if (drop > worst) worst = drop;
  }
  if (worst <= 50) ok(`Fortschritt bleibt monoton (grösster Rückschritt ${worst.toFixed(0)} m)`);
  else bad("Fortschritt springt auf der selbstkreuzenden Runde", `Rückschritt von ${worst.toFixed(0)} m`);
}

console.log("\n8. Ein einzelner Ausreisser darf die Fahrt nicht anhalten");
{
  const route = straightRoute(1000);
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
  const { states } = runOn(route, fixes);
  const atOutlier = states[atOutlierIdx - 1];
  const after = states[states.length - 1];
  if (Math.abs(atOutlier.alongM - 300) < 15) ok("der Ausreisser selbst wird verworfen");
  else bad("Ausreisser wurde übernommen", `alongM ${atOutlier.alongM.toFixed(0)} m statt ~300 m`);
  if (Math.abs(after.alongM - 400) < 15) ok("danach läuft die Auswertung sofort weiter");
  else bad("Auswertung bleibt hängen", `alongM ${after.alongM.toFixed(0)} m statt ~400 m`);
}

console.log("\n9. An der roten Ampel darf sich die Karte nicht drehen");
{
  const route = straightRoute(400);
  const { states } = ride({
    route,
    path: route.geometry,
    noiseM: 3,
    seed: 10,
    haltAt: { index: 5, fixes: 12 },
  });
  let swing = 0;
  for (let i = 7; i <= 17 && i < states.length; i++) {
    const d = Math.abs(states[i].bearingDeg - states[i - 1].bearingDeg);
    const wrapped = Math.min(d, 360 - d);
    if (wrapped > swing) swing = wrapped;
  }
  if (swing <= 10) ok(`Richtung bleibt im Stand ruhig (grösster Sprung ${swing.toFixed(1)} Grad)`);
  else bad("Karte dreht sich im Stand", `Sprung von ${swing.toFixed(1)} Grad`);
}

console.log("\n10. Falschabbiegung: genau eine Neuberechnung, und zwar zügig");
{
  const route = straightRoute(600);
  const path: [number, number][] = [];
  for (let d = 0; d <= 300; d += 20) path.push(alongRoute(d));
  for (let n = 10; n <= 120; n += 10) path.push(offsetNorth(alongRoute(300), n));

  const { states, events } = ride({ route, path, noiseM: 1.5, seed: 11, stopOn: "reroute" });
  if (countOf(events, "reroute") === 1) ok("genau eine Neuberechnung nach der Falschabbiegung");
  else bad("Neuberechnung nach Falschabbiegung", `${countOf(events, "reroute")} statt 1`);

  const firstOff = states.findIndex((s) => s.crossTrackM > NAV.OFF_ROUTE_M);
  if (firstOff >= 0 && states.length - firstOff <= 5) {
    ok(`Neuberechnung ${states.length - firstOff} Fixe nach dem Verlassen der Route`);
  } else if (firstOff < 0) {
    bad("Off-Route wurde gar nicht erkannt", "crossTrackM blieb unter der Schwelle");
  } else {
    bad("Neuberechnung kommt zu spät", `erst ${states.length - firstOff} Fixe danach`);
  }
}

console.log("\n11. Nach einer Neuberechnung bleiben gehörte Spots gehört");
{
  // Der wichtigste Unterschied zum alten Etappen-Modell: Ein Umweg darf die halbe Runde
  // nicht noch einmal anbieten. useBikeNavigation fragt die neue Route ohne die
  // erledigten Spots an und übergibt hier die Phasen der übrigen.
  const before: SpotPhase[] = ["done", "done", "near", "open"];
  const kept: SpotPhase[] = ["near", "open"]; // die beiden erledigten fallen weg
  const state = { ...initNavState(4), spotPhase: before, alongM: 800, bearingDeg: 123 };
  const next = resetForNewRoute(state, kept);

  if (next.alongM === 0) ok("der Fortschritt beginnt auf der neuen Route bei null");
  else bad("Fortschritt nicht zurückgesetzt", `alongM ${next.alongM}`);
  if (JSON.stringify(next.spotPhase) === JSON.stringify(kept)) ok("die Phasen der übrigen Spots bleiben");
  else bad("Spot-Phasen verloren", JSON.stringify(next.spotPhase));
  if (next.nextSpotIndex === 0) ok("der angefangene Spot bleibt der nächste");
  else bad("nächster Spot falsch", `${next.nextSpotIndex} statt 0`);
  if (next.bearingDeg === 123) ok("die Fahrtrichtung bleibt (Kamera springt nicht)");
  else bad("Fahrtrichtung zurückgesetzt", `${next.bearingDeg}`);
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exitCode = failed ? 1 : 0;
