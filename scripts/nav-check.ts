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
import { turnAngle, isMereCurve, prepareSteps } from "../src/lib/nav-steps.ts";
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


// ═══════════════════════════════════════════════════════════════════════════════════
//  RUNDTOUREN
//
//  Alle Pruefungen oben fahren offene Strecken ab, meist gerade. Eine Rundtour ist aber
//  der Normalfall des Produkts, und sie hat eine Eigenschaft, die alles aendert: Ihr ENDE
//  liegt am ANFANG. Jeder falsche Schnappschuss in Startnaehe sieht deshalb aus wie ein
//  Zieleinlauf, und weil die Linie sich selbst nahe kommt, kann der Fortschritt an vielen
//  Stellen auf den falschen Ast springen.
// ═══════════════════════════════════════════════════════════════════════════════════

// Quadratische Runde, Ende exakt am Start. Kantenlaenge so gewaehlt, dass Hin- und
// Rueckweg der ersten Kante nur `versatzM` auseinanderliegen, wie in einer Gasse.
function loopRoute(kanteM: number, spotsAtM: number[] = []): NavRoute {
  const pts: [number, number][] = [];
  const step = 20;
  for (let d = 0; d <= kanteM; d += step) pts.push(alongRoute(d));
  for (let d = step; d <= kanteM; d += step) pts.push(offsetNorth(alongRoute(kanteM), d));
  for (let d = step; d <= kanteM; d += step) pts.push(offsetNorth(alongRoute(kanteM - d), kanteM));
  for (let d = step; d <= kanteM; d += step) pts.push(offsetNorth(alongRoute(0), kanteM - d));
  return { geometry: pts, steps: [], spotAlongM: spotsAtM, totalM: kanteM * 4 };
}

console.log("\n12. Rundtour: ein Ausreisser in Startnaehe beendet die Runde NICHT");
{
  // Der Gast faehrt 200 m, dann sperrt sich der Bildschirm (Safari drosselt die Ortung,
  // docs/40). Nach drei Minuten kommt ein Fix mit maessiger Genauigkeit 25 m neben dem
  // Startpunkt. Weil dort auch das ENDE der Runde liegt, sah das bisher wie ein
  // Zieleinlauf aus: alongM sprang auf fast die volle Rundenlaenge, alle Spots wurden
  // auf einen Schlag verbucht und "Runde geschafft" stand auf dem Schirm, 200 m nach dem
  // Start und ohne Weg zurueck.
  const route = loopRoute(400, [100, 500, 900, 1300]);
  const fixes: GeoFix[] = [];
  let t = 1000;
  for (let d = 0; d <= 200; d += 10) {
    t += 1000;
    fixes.push(fix(alongRoute(d), t));
  }
  // Ortungsluecke von drei Minuten, dann ein Fix nahe am Start.
  t += 180_000;
  fixes.push(fix(offsetNorth(alongRoute(0), 25), t, { accuracyM: 30 }));

  const { states, events } = runOn(route, fixes);
  const last = states[states.length - 1];
  if (!last.finished) ok("kein Zieleinlauf aus einem Ausreisser in Startnaehe");
  else bad("Runde faelschlich beendet", `remainingM ${last.remainingM.toFixed(0)}, alongM ${last.alongM.toFixed(0)}`);

  const passed = events.filter((e) => e.type === "spot-passed").length;
  if (passed === 0) ok("kein Spot wird dabei faelschlich verbucht");
  else bad("Spot-Lawine durch den Ausreisser", `${passed} spot-passed-Ereignisse`);
}

console.log("\n13. Am Start stehen und seitlich abdriften beendet die Runde NICHT");
{
  // Der Gast schiebt sein Rad ueber den Platz zur Ampel, bevor er losfaehrt. Die Ortung
  // streut dabei bis 50 m. Direkt neben ihm liegt der Rueckweg der Runde, also die
  // Stelle mit dem groessten alongM.
  const route = loopRoute(400, [100, 500, 900, 1300]);
  const fixes: GeoFix[] = [];
  let t = 1000;
  for (let i = 0; i < 8; i++) {
    t += 2000;
    fixes.push(fix(offsetNorth(alongRoute(0), i * 7), t, { accuracyM: 45, speedMps: 0.6 }));
  }
  const { states } = runOn(route, fixes);
  const last = states[states.length - 1];
  if (!last.finished) ok("kein Zieleinlauf vor dem ersten gefahrenen Meter");
  else bad("Runde beendet, bevor sie begann", `alongM ${last.alongM.toFixed(0)} von ${route.totalM}`);
  if (last.spotPhase.every((p) => p !== "done")) ok("alle Spots bleiben offen");
  else bad("Spots verbucht, obwohl nicht gefahren", JSON.stringify(last.spotPhase));
}

console.log("\n14. Falschabbiegung auf der Rundtour springt nicht auf den Rueckweg");
{
  // Die Runde benutzt dieselbe Gasse hin und zurueck (8 m versetzt). Der Gast biegt kurz
  // nach dem Start falsch ab und faehrt 90 m seitlich weg. Der Rueckweg liegt dann naeher
  // an ihm als sein eigener Streckenabschnitt, und genau dorthin sprang der Fortschritt.
  const outbound: [number, number][] = [];
  for (let d = 0; d <= 400; d += 20) outbound.push(alongRoute(d));
  const back: [number, number][] = [];
  for (let d = 400; d >= 0; d -= 20) back.push(offsetNorth(alongRoute(d), 8));
  const geometry = [...outbound, ...back];
  const route: NavRoute = { geometry, steps: [], spotAlongM: [200, 600], totalM: 800 };

  const path: [number, number][] = [];
  for (let d = 0; d <= 25; d += 5) path.push(alongRoute(d));
  for (let n = 10; n <= 90; n += 10) path.push(offsetNorth(alongRoute(25), -n));

  const { states, events } = ride({ route, path, seed: 14, stopOn: "reroute" });
  const last = states[states.length - 1];
  if (!last.finished) ok("kein Zieleinlauf durch die Falschabbiegung");
  else bad("Runde durch Falschabbiegung beendet", `alongM ${last.alongM.toFixed(0)}`);
  if (countOf(events, "spot-passed") === 0) ok("kein Spot wird verbucht, der noch vor dem Gast liegt");
  else bad("Spots faelschlich verbucht", `${countOf(events, "spot-passed")} Ereignis(se)`);
  if (countOf(events, "reroute") === 1) ok("genau eine Neuberechnung");
  else bad("Neuberechnung", `${countOf(events, "reroute")} statt 1`);
}

console.log("\n15. Ein falsches \"fertig\" ist umkehrbar");
{
  // Selbst wenn der Zustand einmal auf fertig faellt, darf er nicht kleben: Wer sich
  // wieder deutlich vom Ziel entfernt, faehrt weiter. Ohne das ist jeder Fehlalarm ein
  // Totalausfall mitten auf dem Rad.
  const route = straightRoute(600, [300]);
  const fixes: GeoFix[] = [];
  let t = 1000;
  for (let d = 0; d <= 600; d += 20) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  // Und dann faehrt der Gast weiter, ueber das Ende hinaus zurueck auf die Route.
  for (let d = 580; d >= 400; d -= 20) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  const { states } = runOn(route, fixes);
  const amEnde = states.find((s) => s.finished);
  const last = states[states.length - 1];
  if (amEnde) ok("am echten Ende wird die Runde als gefahren gemeldet");
  else bad("Ende wird gar nicht erkannt", "kein finished auf der ganzen Fahrt");
  if (!last.finished) ok("und wieder aufgehoben, sobald der Gast weiterfaehrt");
  else bad("fertig klebt", `remainingM ${last.remainingM.toFixed(0)}`);
}


console.log("\n16. Eine Kette von Abbiegungen verschluckt keinen Spot");
{
  // docs/40 sagt zu: "Der Knopf kommt danach, der Spot geht dadurch nicht verloren."
  // Das stimmte nur, solange zwischen zwei Abbiegungen mehr als MANEUVER_QUIET_M lagen.
  // In der Altstadt folgen sie enger, das Fenster des Spots liegt dann durchgehend in
  // einer Sperrzone und er lief stumm von "offen" auf "erledigt".
  const route = straightRoute(1000, [500]);
  route.steps = [300, 400, 500, 600, 700].map((alongM) => ({
    alongM,
    instruction: "Abbiegen",
    type: "turn",
    modifier: "right",
  }));
  const { events } = ride({ route, path: route.geometry });
  if (countOf(events, "spot-near") === 1) ok("der Spot wird trotz Dauer-Sperrzone angeboten");
  else bad("Spot in der Abbiegungs-Kette verschluckt", `${countOf(events, "spot-near")} Angebote statt 1`);
}

console.log("\n17. Der LETZTE Spot einer Runde wird angeboten");
{
  // bike-directions.ts setzt den letzten Spot per Definition auf die Routenlaenge und
  // schiebt einen "arrive"-Step ans Ende. Der deckte damit die letzten 140 m JEDER Route
  // zu: Der letzte Spot wurde nie angeboten. Ankommen ist aber keine Abbiegung, in die
  // man einfaehrt.
  const route = straightRoute(1000, [1000]);
  route.steps = [
    { alongM: 880, instruction: "Rechts abbiegen", type: "turn", modifier: "right" },
    { alongM: 1000, instruction: "Ziel erreicht", type: "arrive" },
  ];
  const { events } = ride({ route, path: route.geometry });
  if (countOf(events, "spot-near") === 1) ok("der letzte Spot wird angeboten");
  else bad("letzter Spot nie angeboten", `${countOf(events, "spot-near")} Angebote statt 1`);
}

console.log("\n18. Zwei Spots im selben Schritt: keiner geht verloren");
{
  // Nach einer Sperrzone oder einer Ortungsluecke koennen zwei Spots im selben
  // Rechenschritt in Reichweite kommen. Die Oberflaeche zeigt nur EIN Angebot, das
  // spaetere ueberschrieb also das naehere, und weil der uebergangene Spot danach auf
  // "near" stand, konnte er nie wieder ausloesen.
  const route = straightRoute(1000, [400, 480]);
  route.steps = [{ alongM: 380, instruction: "Links abbiegen", type: "turn", modifier: "left" }];
  const { states, events } = ride({ route, path: route.geometry });

  const near = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (near.length === 2 && near.includes(0) && near.includes(1)) {
    ok("beide Spots werden angeboten");
  } else {
    bad("ein Spot geht verloren", `Angebote: ${JSON.stringify(near)}`);
  }
  // Und zwar NACHEINANDER, nicht beide im selben Schritt: sonst kann die Oberflaeche
  // gar nicht beide zeigen.
  let maxProSchritt = 0;
  let vorher = 0;
  for (const st of states) {
    const jetzt = st.spotPhase.filter((ph) => ph !== "open").length;
    maxProSchritt = Math.max(maxProSchritt, jetzt - vorher);
    vorher = jetzt;
  }
  if (maxProSchritt <= 1) ok("nie zwei Angebote in einem Schritt");
  else bad("zwei Angebote im selben Schritt", `${maxProSchritt} auf einmal`);
}


console.log("\n19. Stichweg: der Fortschritt laeuft nicht rueckwaerts");
{
  // GEMESSEN AN DER ECHTEN RUNDE A (25.08.2026): Zwei ihrer Spots liegen in Sackgassen,
  // Nonnberggasse und Freisaal. Mapbox faehrt hinein, wendet und kommt auf demselben Weg
  // zurueck ("Nach links umkehren"). Auf dem Rueckweg liegt der Gast physisch auf
  // derselben Linie wie auf dem Hinweg, und die Suche nimmt bei gleichem Abstand das
  // FRUEHER indizierte Segment. Ergebnis: Der Fortschritt zaehlt rueckwaerts, waehrend
  // der Gast vorwaerts faehrt. Gemessen auf der echten Route: bei 3690 gefahrenen Metern
  // meldete der Kern 2127 m, und alle vier Spots dahinter blieben stumm.
  const spur: [number, number][] = [];
  for (let d = 0; d <= 400; d += 20) spur.push(alongRoute(d));           // hin
  for (let d = 20; d <= 100; d += 20) spur.push(offsetNorth(alongRoute(400), d));   // Stich hinauf
  for (let d = 80; d >= 0; d -= 20) spur.push(offsetNorth(alongRoute(400), d));     // und zurueck
  for (let d = 20; d <= 400; d += 20) spur.push(alongRoute(400 + d));    // weiter
  const route: NavRoute = { geometry: spur, steps: [], spotAlongM: [450, 800], totalM: 1000 };

  const { states, events } = ride({ route, path: spur, speedMps: 5 });
  const last = states[states.length - 1];

  // 1. Kommt der Fortschritt ueberhaupt an?
  if (last.alongM >= 900) ok(`Fortschritt erreicht das Ende (${last.alongM.toFixed(0)} m von 1000)`);
  else bad("Fortschritt bleibt im Stichweg haengen", `${last.alongM.toFixed(0)} m von 1000 m`);

  // 2. Laeuft er zwischendurch rueckwaerts? Ein Radl faehrt vorwaerts, der Zaehler auch.
  let groessterRueckschritt = 0;
  for (let i = 1; i < states.length; i++) {
    groessterRueckschritt = Math.max(groessterRueckschritt, states[i - 1].alongM - states[i].alongM);
  }
  if (groessterRueckschritt <= 25) ok("kein nennenswerter Rueckschritt");
  else bad("Fortschritt laeuft rueckwaerts", `bis zu ${groessterRueckschritt.toFixed(0)} m pro Fix zurueck`);

  // 3. Der Spot HINTER dem Stichweg muss angeboten werden.
  const angeboten = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (angeboten.includes(1)) ok("der Spot hinter dem Stichweg wird angeboten");
  else bad("Spot hinter dem Stichweg bleibt stumm", `angeboten wurden: [${angeboten.join(", ")}]`);

  // 4. Dasselbe mit verrauschtem GPS. Die Fahrtrichtung wird aus zwei aufeinander
  //    folgenden Punkten gerechnet, und die liegen bei 18 km/h nur rund 5 m auseinander.
  //    Bei 8 m Rauschen ist der gerechnete Kurs also alles andere als sauber; der
  //    Aufschlag greift trotzdem, weil er erst ab 90 Grad Abweichung zuschlägt.
  const laut = ride({ route, path: spur, speedMps: 5, noiseM: 8, accuracyM: 12, seed: 7 });
  const lautLetzter = laut.states[laut.states.length - 1];
  if (lautLetzter.alongM >= 850) ok(`auch mit Rauschen kommt der Fortschritt an (${lautLetzter.alongM.toFixed(0)} m)`);
  else bad("mit Rauschen bleibt der Fortschritt haengen", `${lautLetzter.alongM.toFixed(0)} m von 1000 m`);

  // 5. Und ohne jede Geraeterichtung: iOS liefert `heading` in der Geolocation-API oft
  //    gar nicht. Dann muss der Kurs ueber Grund einspringen.
  const ohneKurs = ride({ route, path: spur, speedMps: 5 }).fixes.map((f) => ({
    ...f, headingDeg: null, speedMps: null,
  }));
  const blind = runOn(route, ohneKurs);
  const blindLetzter = blind.states[blind.states.length - 1];
  if (blindLetzter.alongM >= 900) ok(`auch ohne Geraeterichtung (${blindLetzter.alongM.toFixed(0)} m)`);
  else bad("ohne Geraeterichtung bleibt der Fortschritt haengen", `${blindLetzter.alongM.toFixed(0)} m von 1000 m`);
}


console.log("\n20. Rundtour mit Ziel: die Runde endet am Start, nicht am letzten Spot");
{
  // Eine Rundtour endet dort, wo sie beginnt. Ohne einen eigenen Ziel-Punkt hoerte die
  // Route am LETZTEN SPOT auf: Bei der echten Runde A ist das Muelln, und das liegt
  // 692 m vom Leihrad entfernt (gemessen gegen Mapbox am 25.08.2026). Der Gast bekaeme
  // "Ziel erreicht", waehrend sein Rad noch sieben Minuten weiter steht.
  //
  // bike-directions.ts haengt den Zielpunkt jetzt hinter die Spots. Fuer den Kern heisst
  // das: Der letzte Spot liegt NICHT mehr am Routenende. Diese Pruefung haelt fest, dass
  // beides trotzdem funktioniert, das Angebot am letzten Spot und der Zieleinlauf danach.
  const route = straightRoute(1600, [400, 800]);
  const { states, events } = ride({ route, path: route.geometry, speedMps: 5 });

  const angeboten = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (angeboten.includes(0) && angeboten.includes(1)) ok("beide Spots werden angeboten");
  else bad("ein Spot bleibt stumm", `angeboten: [${angeboten.join(", ")}]`);

  // Am letzten Spot (800 m) darf noch nichts fertig sein, es fehlen 800 m.
  const beiSpot = states.find((st) => st.alongM >= 800 && st.alongM < 850);
  if (beiSpot && !beiSpot.finished) ok("am letzten Spot ist die Runde noch nicht gefahren");
  else bad("Runde gilt schon am letzten Spot als gefahren", `bei ${beiSpot?.alongM.toFixed(0)} m`);

  // Am echten Ende dagegen schon.
  const letzter = states[states.length - 1];
  if (letzter.finished) ok(`am Ziel gilt sie als gefahren (${letzter.alongM.toFixed(0)} m von 1600)`);
  else bad("Zieleinlauf wird nicht gemeldet", `${letzter.alongM.toFixed(0)} m von 1600 m`);
}


console.log("\n21. Ein Bogen ist keine Abbiegung, zwei dichte gehoeren zusammen");
{
  // Der Winkel war beim ersten Anlauf INVERTIERT: Eine Gerade ergab 180 Grad statt 0, und
  // damit wurde nie etwas verworfen. Genau deshalb steht er hier als eigene Pruefung.
  const faelle: [number, number, number, string][] = [
    [0, 0, 0, "geradeaus"],
    [350, 10, 20, "ueber die 360-Grad-Grenze"],
    [10, 350, 20, "andersherum ueber die Grenze"],
    [0, 90, 90, "rechter Winkel"],
    [0, 180, 180, "Kehre"],
    [90, 120, 30, "flacher Bogen"],
  ];
  let winkelOk = true;
  for (const [a, b, soll, was] of faelle) {
    const ist = turnAngle(a, b);
    if (ist !== soll) { bad(`Winkel falsch (${was})`, `${a}->${b} ergab ${ist}, erwartet ${soll}`); winkelOk = false; }
  }
  if (winkelOk) ok(`Winkel stimmt in allen ${faelle.length} Faellen`);

  // Verworfen wird nur, was flach UND harmlos ist.
  const bogen = { alongM: 100, instruction: "", type: "turn", modifier: "slight right", angleDeg: 20 };
  const knick = { alongM: 100, instruction: "", type: "end of road", modifier: "right", angleDeg: 20 };
  const ohneWinkel = { alongM: 100, instruction: "", type: "turn", modifier: "slight left", angleDeg: null };
  if (isMereCurve(bogen)) ok("flacher Bogen wird verworfen");
  else bad("flacher Bogen bleibt", JSON.stringify(bogen));
  if (!isMereCurve(knick)) ok("Strassenende bleibt, auch flach");
  else bad("Strassenende verworfen", JSON.stringify(knick));
  if (!isMereCurve(ohneWinkel)) ok("ohne Winkel wird nie verworfen");
  else bad("ohne Winkel verworfen", JSON.stringify(ohneWinkel));

  // Buendeln: die zweite bleibt eigener Schritt, haengt aber zusaetzlich an der ersten.
  const roh = [
    { alongM: 0, instruction: "a", type: "turn", modifier: "right", angleDeg: 90 },
    { alongM: 30, instruction: "b", type: "turn", modifier: "left", angleDeg: 90 },
    { alongM: 400, instruction: "c", type: "turn", modifier: "right", angleDeg: 90 },
  ];
  const fertig = prepareSteps(roh);
  if (fertig.length === 3) ok("keine Abbiegung geht beim Buendeln verloren");
  else bad("Abbiegung verschwunden", `${fertig.length} statt 3`);
  if (fertig[0]?.followedBy?.modifier === "left") ok("die zweite haengt an der ersten");
  else bad("Buendel fehlt", JSON.stringify(fertig[0]));
  if (!fertig[1]?.followedBy) ok("die weit entfernte dritte haengt an keiner");
  else bad("faelschlich gebuendelt", JSON.stringify(fertig[1]));
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exitCode = failed ? 1 : 0;
