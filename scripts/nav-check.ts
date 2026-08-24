// Prüft den reinen Entscheidungs-Kern der S-Bike-Navigation (bike-nav-core.ts) gegen
// synthetische GPS-Fix-Folgen. Aufruf:
//   npm run nav:check
//
// WARUM ES DIESES SKRIPT GIBT: Priorität 1 der S-Bike-Tour ist zuverlässige Navigation
// (siehe docs/40). Ankunfts- und Reroute-Erkennung entscheiden direkt, ob ein Radl
// mitten in der Fahrt ein Pop-up bekommt oder unnötig neu geroutet wird – das lässt sich
// nicht "beim Testen am Handy mal kurz schauen", weil man dafür wirklich fahren müsste.
// Es importiert den ECHTEN stepNav() aus src/lib, baut also nichts nach.
import {
  stepNav,
  initNavState,
  type GeoFix,
  type NavLeg,
  type NavState,
} from "../src/lib/bike-nav-core.ts";

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, detail: string) => {
  failed++;
  console.log(`  FEHLT ${name}\n        ${detail}`);
};

// Gerade Teststrecke nach Osten bei Breite 47.8° (Salzburg-Breite, für die
// Meter<->Grad-Umrechnung relevant). Reicht für alle Szenarien unten.
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

const ROUTE_LEN_M = 1000;
const route: [number, number][] = [];
for (let d = 0; d <= ROUTE_LEN_M; d += 20) route.push(alongRoute(d));
const stop = route[route.length - 1];
const leg: NavLeg = { geometry: route, steps: [], stop };

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

function run(fixes: GeoFix[]): { finalState: NavState; events: string[] } {
  let state = initNavState();
  const events: string[] = [];
  for (const f of fixes) {
    const r = stepNav(state, f, leg);
    state = r.state;
    events.push(...r.events.map((e) => e.type));
  }
  return { finalState: state, events };
}

console.log("1. Saubere Fahrt entlang der Route: kein Reroute, genau eine Ankunft");
{
  const fixes: GeoFix[] = [];
  let t = 0;
  for (let d = 0; d <= ROUTE_LEN_M; d += 10) {
    t += 2000; // alle 2s ein Fix, ~5 m/s bei 10m Schritt
    fixes.push(fix(alongRoute(d), t));
  }
  const { events } = run(fixes);
  const reroutes = events.filter((e) => e === "reroute").length;
  const arrivals = events.filter((e) => e === "arrived").length;
  if (reroutes === 0) ok("keine Reroute-Events auf der sauberen Route");
  else bad("Reroute auf sauberer Route", `${reroutes} Ereignis(se) statt 0`);
  if (arrivals === 1) ok("genau eine Ankunft am Ende der Route");
  else bad("Ankunft am Ende der Route", `${arrivals} Ereignis(se) statt 1`);
}

// Ein Umweg als GLEITENDE Abdrift von der Route, nicht als Sprung: der Teleport-Filter
// (MAX_SPEED_MPS) würde einen einzelnen 90m-Satz seitwärts sonst als GPS-Ausreisser
// verwerfen – genau wie ein echtes Abbiegen auch nicht in einem Fix passiert. `lateralsM`
// ist das Seitversatz-Profil, `forwardStepM`/`dtMs` steuern das Tempo dazwischen.
function driftFixes(
  startForwardM: number,
  lateralsM: number[],
  forwardStepM: number,
  dtMs: number,
  startAtMs: number,
): { fixes: GeoFix[]; endAtMs: number } {
  const fixes: GeoFix[] = [];
  let t = startAtMs;
  let f = startForwardM;
  for (const lat of lateralsM) {
    f += forwardStepM;
    t += dtMs;
    fixes.push(fix(offsetNorth(alongRoute(f), lat), t));
  }
  return { fixes, endAtMs: t };
}

// Profil, das dreimal hintereinander über OFF_ROUTE_M (40m) steigt: 45/70/90 -> löst beim
// dritten Fix (Index 2) eine Neuberechnung aus. Jeder Schritt bleibt unter MAX_SPEED_MPS
// (Vorwärts 15m + seitlich max. 25m Delta über 2s => ~14,6 m/s).
const DRIFT_OVER_AND_BACK = [20, 45, 70, 90, 90, 90, 90, 60, 30, 0];

console.log("\n2. 90m-Umweg löst genau EINE Neuberechnung aus");
{
  const fixes: GeoFix[] = [];
  let t = 0;
  // Erst ein Stück normal auf der Route (weit weg vom Stopp -> "armed" wird true).
  for (let d = 0; d <= 300; d += 20) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  const drift = driftFixes(300, DRIFT_OVER_AND_BACK, 15, 2000, t);
  fixes.push(...drift.fixes);
  t = drift.endAtMs;
  // Zurück auf die Route bis zum Ziel.
  const backAt = 300 + DRIFT_OVER_AND_BACK.length * 15;
  for (let d = Math.ceil(backAt / 20) * 20; d <= ROUTE_LEN_M; d += 20) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  const { events } = run(fixes);
  const reroutes = events.filter((e) => e === "reroute").length;
  if (reroutes === 1) ok("genau ein Reroute-Event bei einer gleitenden 90m-Abdrift");
  else bad("Reroute beim Umweg", `${reroutes} Ereignis(se) statt 1`);
}

console.log("\n3. Cooldown verhindert eine zweite Neuberechnung direkt nach der ersten");
{
  const fixes: GeoFix[] = [];
  let t = 0;
  for (let d = 0; d <= 300; d += 20) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  // Dasselbe Abdrift-Profil: die ersten drei Werte über 40m (45/70/90) lösen bei Index 2
  // eine Neuberechnung aus. Die Werte 90/90/90 direkt danach erreichen die Schwelle
  // erneut, aber nur 6s nach der ersten Auslösung – innerhalb der 10s-Cooldown, darf
  // also NICHT nochmal feuern.
  const drift = driftFixes(300, DRIFT_OVER_AND_BACK, 15, 2000, t);
  fixes.push(...drift.fixes);
  const { events } = run(fixes);
  const reroutes = events.filter((e) => e === "reroute").length;
  if (reroutes === 1) ok("Cooldown blockiert die zweite Neuberechnung");
  else bad("Cooldown", `${reroutes} Reroute-Ereignis(se) statt 1`);
}

console.log("\n4. Ungenaue Fixe (>60m) werden gar nicht erst bewertet");
{
  // Fixe weit abseits UND direkt am Stopp, aber alle mit schlechter Genauigkeit ->
  // dürfen weder eine Ankunft noch ein Reroute auslösen, und der Zustand bleibt der
  // Ausgangszustand (die Fixe werden komplett verworfen, nicht nur "nicht entschieden").
  const fixes: GeoFix[] = [
    fix(offsetNorth(alongRoute(320), 90), 1000, { accuracyM: 80 }),
    fix(stop, 2000, { accuracyM: 90 }),
    fix(stop, 3000, { accuracyM: 75 }),
  ];
  const before = initNavState();
  const { finalState, events } = run(fixes);
  if (events.length === 0) ok("keine Ereignisse aus ungenauen Fixen");
  else bad("Ungenaue Fixe lösten etwas aus", JSON.stringify(events));
  if (JSON.stringify(finalState) === JSON.stringify(before))
    ok("Zustand bleibt beim Ausgangszustand (Fixe komplett verworfen)");
  else bad("Zustand veränderte sich trotz ungenauer Fixe", JSON.stringify(finalState));
}

console.log("\n5. Ankunft an einem Stopp: genau ein Ereignis, kein Doppel-Feuern");
{
  const fixes: GeoFix[] = [];
  let t = 0;
  // Anfahrt von weit weg (armed=true), dann direkt am Stopp stehen bleiben (mehrere
  // Fixe innerhalb ARRIVE_M -> darf nur EINMAL "arrived" auslösen, nicht bei jedem Fix).
  for (let d = 0; d <= ROUTE_LEN_M; d += 25) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  for (let i = 0; i < 5; i++) {
    t += 2000;
    fixes.push(fix(stop, t)); // steht am Ziel
  }
  const { events } = run(fixes);
  const arrivals = events.filter((e) => e === "arrived").length;
  if (arrivals === 1) ok("genau ein Ankunfts-Ereignis trotz mehrerer Fixe am Stopp");
  else bad("Ankunft feuert mehrfach oder gar nicht", `${arrivals} Ereignis(se) statt 1`);
}

console.log("\n6. Ohne \"armed\" (nie weit weg gewesen) feuert keine Ankunft");
{
  // Startet SOFORT am Stopp, ohne vorher jemals >= ARM_M entfernt gewesen zu sein –
  // genau der Fall "Tour beginnt, während man schon am ersten Stopp steht": keine
  // Navigation ist gelaufen, also soll auch kein Ankunfts-Pop-up ungefragt aufspringen.
  const fixes: GeoFix[] = [];
  for (let i = 0; i < 5; i++) fixes.push(fix(stop, 1000 + i * 2000));
  const { events } = run(fixes);
  const arrivals = events.filter((e) => e === "arrived").length;
  if (arrivals === 0) ok("keine Ankunft ohne vorherige Distanz zum Stopp");
  else bad("Ankunft feuert ohne \"armed\"", `${arrivals} Ereignis(se) statt 0`);
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exitCode = failed ? 1 : 0;
