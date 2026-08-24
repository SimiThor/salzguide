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


// ═══════════════════════════════════════════════════════════════════════════════════
//  FAHRT-SIMULATOR
//
//  Die Prüfungen 1 bis 6 oben fahren von Hand gesetzte Fix-Folgen auf EINER geraden
//  Route. Das reicht für die Grundregeln, aber nicht für die Fälle, an denen eine echte
//  Salzburger Runde scheitert: eine Gasse, die zweimal benutzt wird, zwei Stationen
//  50 m auseinander, ein Ausreisser mitten in der Fahrt, eine rote Ampel.
//
//  Der Simulator unten spielt deshalb einen GEFAHRENEN WEG im Sekundentakt ab: Er
//  tastet ihn nach Geschwindigkeit ab, legt reproduzierbares Rauschen darauf und
//  schickt jeden Fix durch denselben stepNav() wie die App. Bewusst KEIN Math.random():
//  ein Test, der bei jedem Lauf andere Zahlen sieht, meldet Fehler, die niemand
//  nachstellen kann.
// ═══════════════════════════════════════════════════════════════════════════════════

// Beliebige Etappe statt der globalen `leg` von oben.
function runOn(l: NavLeg, fixes: GeoFix[]): { states: NavState[]; events: string[] } {
  let state = initNavState();
  const states: NavState[] = [];
  const events: string[] = [];
  for (const f of fixes) {
    const r = stepNav(state, f, l);
    state = r.state;
    states.push(state);
    events.push(...r.events.map((e) => e.type));
  }
  return { states, events };
}

// Linearer Kongruenzgenerator: gleicher Startwert, gleiche Zahlenfolge, auf jedem
// Rechner. Liefert -1..1.
function makeNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

const distM = (a: [number, number], b: [number, number]) =>
  Math.hypot((a[0] - b[0]) * M_PER_DEG_LNG, (a[1] - b[1]) * M_PER_DEG_LAT);

// Einen Weg alle `stepM` Meter abtasten. Der Rückgabewert ist die Punktfolge, die ein
// Radl mit konstantem Tempo tatsächlich durchfährt, nicht die Stützpunkte des Wegs.
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
  leg: NavLeg;
  // Der GEFAHRENE Weg. Weicht er von leg.geometry ab, ist das eine Falschabbiegung.
  path: [number, number][];
  speedMps?: number;
  dtMs?: number;
  accuracyM?: number;
  // Seitliches Rauschen in Metern (Häuserschlucht). 0 = perfektes GPS.
  noiseM?: number;
  seed?: number;
  // Indizes, an denen das Radl steht (Ampel): gleicher Ort, Tempo 0, Zeit läuft weiter.
  haltAt?: { index: number; fixes: number };
  // Nach diesem Ereignis aufhören. Bildet nach, was die App tut: Meldet der Kern ein
  // "reroute", holt useBikeNavigation eine NEUE Etappe und resetForNewLeg fängt von vorn
  // an. Fährt der Simulator stattdessen stur gegen die alte Geometrie weiter, meldet er
  // nach Ablauf der Cooldown ein zweites Reroute, das es in der App nie gäbe.
  stopOn?: "reroute" | "arrived";
};

function ride(opts: RideOpts): { fixes: GeoFix[]; states: NavState[]; events: string[] } {
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
  let state = initNavState();
  const states: NavState[] = [];
  const events: string[] = [];
  for (const f of fixes) {
    const r = stepNav(state, f, opts.leg);
    state = r.state;
    states.push(state);
    events.push(...r.events.map((e) => e.type));
    if (opts.stopOn && r.events.some((e) => e.type === opts.stopOn)) break;
  }
  return { fixes, states, events };
}

console.log("\n7. Selbstkreuzende Runde: der Fortschritt darf nicht springen");
{
  // Die Altstadt-Form: 300 m hinein, wenden, auf einer nur 4 m versetzten Linie zurück.
  // So sieht jede Gasse aus, die eine Runde zweimal benutzt (Getreidegasse hinein und
  // wieder heraus). Ein paar Meter Rauschen entscheiden hier, welches der beiden fast
  // gleich weit entfernten Segmente "das nächste" ist.
  const outbound: [number, number][] = [];
  for (let d = 0; d <= 300; d += 20) outbound.push(alongRoute(d));
  const back: [number, number][] = [];
  for (let d = 300; d >= 0; d -= 20) back.push(offsetNorth(alongRoute(d), 4));
  const geometry = [...outbound, ...back];
  const l: NavLeg = { geometry, steps: [], stop: geometry[geometry.length - 1] };

  const { states } = ride({ leg: l, path: geometry, noiseM: 2.5, seed: 7 });

  // Auf einer Runde, die man vorwärts abfährt, darf der Fortschritt nie deutlich
  // zurückfallen. Kleine Rückschritte sind Rauschen, ein Sprung über 50 m ist der
  // Wechsel auf das falsche Segment.
  let worst = 0;
  for (let i = 1; i < states.length; i++) {
    const drop = states[i - 1].alongM - states[i].alongM;
    if (drop > worst) worst = drop;
  }
  if (worst <= 50) ok(`Fortschritt bleibt monoton (grösster Rückschritt ${worst.toFixed(0)} m)`);
  else bad("Fortschritt springt auf der selbstkreuzenden Runde", `Rückschritt von ${worst.toFixed(0)} m`);
}

console.log("\n8. Zwei Stationen 50 m auseinander: die Ankunft muss trotzdem kommen");
{
  // In der Altstadt der Normalfall (Residenzplatz und Domplatz liegen so). Die Etappe
  // ist kürzer als ARM_M (60 m), der Gast ist also NIE 60 m vom Ziel entfernt. Er ist
  // aber gefahren, und genau das unterscheidet ihn von jemandem, der am Stopp steht
  // (Prüfung 6, die weiterhin gelten muss).
  const geometry: [number, number][] = [];
  for (let d = 0; d <= 50; d += 5) geometry.push(alongRoute(d));
  const l: NavLeg = { geometry, steps: [], stop: geometry[geometry.length - 1] };
  const path = [...geometry, alongRoute(52), alongRoute(53)];

  const { events } = ride({ leg: l, path, speedMps: 4 });
  const arrivals = events.filter((e) => e === "arrived").length;
  if (arrivals === 1) ok("genau eine Ankunft auf der 50-m-Etappe");
  else bad("Ankunft auf kurzer Etappe", `${arrivals} Ereignis(se) statt 1 (die Tour hängt hier)`);
}

console.log("\n9. Ein einzelner Ausreisser darf die Fahrt nicht anhalten");
{
  // Ein Sprung, den kein Radl fahren kann, wird verworfen. Danach muss die Auswertung
  // sofort weiterlaufen: der Filter merkt sich den LETZTEN GUTEN Fix, nicht den Müll.
  const fixes: GeoFix[] = [];
  let t = 0;
  for (let d = 0; d <= 300; d += 10) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  // Ausreisser: 800 m weiter, im selben 2-Sekunden-Takt.
  t += 2000;
  fixes.push(fix(alongRoute(1100), t));
  const beforeCount = fixes.length;
  for (let d = 310; d <= 400; d += 10) {
    t += 2000;
    fixes.push(fix(alongRoute(d), t));
  }
  const { states } = runOn(leg, fixes);
  const after = states[states.length - 1];
  const atOutlier = states[beforeCount - 1];
  if (Math.abs(atOutlier.alongM - 300) < 15) ok("der Ausreisser selbst wird verworfen");
  else bad("Ausreisser wurde übernommen", `alongM ${atOutlier.alongM.toFixed(0)} m statt ~300 m`);
  if (Math.abs(after.alongM - 400) < 15) ok("nach dem Ausreisser läuft die Auswertung sofort weiter");
  else bad("Auswertung bleibt nach dem Ausreisser hängen", `alongM ${after.alongM.toFixed(0)} m statt ~400 m`);
}

console.log("\n10. An der roten Ampel darf sich die Karte nicht drehen");
{
  // Steht das Radl, liefert das Gerät kein verlässliches heading mehr. Die Richtung muss
  // dann aus der Route kommen, sonst dreht sich die Karte unter dem wartenden Gast weg.
  const geometry: [number, number][] = [];
  for (let d = 0; d <= 400; d += 20) geometry.push(alongRoute(d));
  const l: NavLeg = { geometry, steps: [], stop: geometry[geometry.length - 1] };
  const { states } = ride({
    leg: l,
    path: geometry,
    noiseM: 3,
    seed: 10,
    haltAt: { index: 5, fixes: 12 },
  });
  // Während des Halts (Fix 6 bis 17) darf sich die angezeigte Richtung kaum ändern.
  let swing = 0;
  for (let i = 7; i <= 17 && i < states.length; i++) {
    const d = Math.abs(states[i].bearingDeg - states[i - 1].bearingDeg);
    const wrapped = Math.min(d, 360 - d);
    if (wrapped > swing) swing = wrapped;
  }
  if (swing <= 10) ok(`Richtung bleibt im Stand ruhig (grösster Sprung ${swing.toFixed(1)} Grad)`);
  else bad("Karte dreht sich im Stand", `Sprung von ${swing.toFixed(1)} Grad`);
}

console.log("\n11. Falschabbiegung: genau eine Neuberechnung, und zwar zügig");
{
  // Der Gast biegt an einer Kreuzung falsch ab und fährt 120 m in die Querstrasse. Das
  // muss GENAU EINE Neuberechnung auslösen, nicht drei, und es darf nicht ewig dauern:
  // wer 120 m falsch fährt, hat schon eine Kreuzung zu viel hinter sich.
  const geometry: [number, number][] = [];
  for (let d = 0; d <= 600; d += 20) geometry.push(alongRoute(d));
  const l: NavLeg = { geometry, steps: [], stop: geometry[geometry.length - 1] };

  const path: [number, number][] = [];
  for (let d = 0; d <= 300; d += 20) path.push(alongRoute(d));
  for (let n = 10; n <= 120; n += 10) path.push(offsetNorth(alongRoute(300), n));

  const { states, events } = ride({ leg: l, path, noiseM: 1.5, seed: 11, stopOn: "reroute" });
  const reroutes = events.filter((e) => e === "reroute").length;
  if (reroutes === 1) ok("genau eine Neuberechnung nach der Falschabbiegung");
  else bad("Neuberechnung nach Falschabbiegung", `${reroutes} Ereignis(se) statt 1`);

  const firstOff = states.findIndex((s) => s.crossTrackM > 40);
  const rerouteAt = states.findIndex((s) => s.offRouteStreak === 0 && s.crossTrackM > 40);
  if (firstOff >= 0 && rerouteAt > firstOff && rerouteAt - firstOff <= 4) {
    ok(`Neuberechnung ${rerouteAt - firstOff} Fixe nach dem Verlassen der Route`);
  } else if (firstOff < 0) {
    bad("Off-Route wurde gar nicht erkannt", "crossTrackM blieb unter 40 m");
  } else {
    bad("Neuberechnung kommt zu spät", `erst ${rerouteAt - firstOff} Fixe nach dem Verlassen`);
  }
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exitCode = failed ? 1 : 0;
