// Prüft die Regeln der Route einer kuratierten Runde (lib/tour-route.ts) und die Auswahl
// der Wegpunkte für die Rad-Navigation (lib/bike-directions.ts). Aufruf:
//   npm run tour-route:check
//
// WARUM ES DIESE PRÜFUNG GIBT: Seit Migration 0071 formen Wegpunkte ohne Geschichte die
// Linie einer Runde. Ob ein Wegpunkt beim Umsortieren einer Station überlebt, in welchen
// Abschnitt ein Tipp auf die Karte gehört und welche Wegpunkte die Navigation nach einer
// Falschabbiegung noch anfährt, entscheidet darüber, ob ein Gast durch die Fussgängerzone
// geschickt wird, um die der Admin herumgeplant hat. Es importiert die ECHTEN Module aus
// src/lib, baut also nichts nach.
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
  MAX_DIRECTIONS_COORDS,
  type LngLat,
  type ViaLeg,
  type ChainNode,
} from "@/lib/tour-route";
import { buildBikeChain, selectNavVias, alongFromViaWaypoints } from "@/lib/bike-directions";

let failed = 0;
const ok = (name: string, detail = "") => console.log(`  ok    ${name}${detail ? `  (${detail})` : ""}`);
const bad = (name: string, detail: string) => {
  failed++;
  console.log(`  FEHLT ${name}\n        ${detail}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Flache Rechnung um Salzburg: x nach Osten, y nach Norden, in Metern.
const LAT0 = 47.8;
const LNG0 = 13.03;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const P = (x: number, y: number): LngLat => [LNG0 + x / M_PER_DEG_LNG, LAT0 + y / M_PER_DEG_LAT];
const RP = (x: number, y: number) => ({ lng: P(x, y)[0], lat: P(x, y)[1] });
const leg = (from: string, to: string, ...pts: LngLat[]): ViaLeg => ({ from, to, coords: pts });

// ── 1. Die Marke ──────────────────────────────────────────────────────────────────────
console.log("\n1. Die Aktualitäts-Marke reagiert auf alles, was die Linie ändert");
{
  const base = {
    start: RP(0, 0),
    end: RP(0, 0),
    stops: [
      { id: "a", coord: P(0, 300) },
      { id: "b", coord: P(100, 300) },
    ],
    mode: "bike" as const,
    via: [] as ViaLeg[],
  };
  const h = tourRouteHash(base);
  if (h === tourRouteHash(base)) ok("gleicher Stand, gleiche Marke");
  else bad("gleicher Stand", "zwei Marken");
  if (h !== tourRouteHash({ ...base, mode: "walk" })) ok("Fortbewegung zählt");
  else bad("Fortbewegung", "walk und bike gleich");
  const mitVia = { ...base, via: [leg("a", "b", P(50, 320))] };
  if (h !== tourRouteHash(mitVia)) ok("Wegpunkt zählt");
  else bad("Wegpunkt", "ohne und mit gleich");
  if (tourRouteHash(mitVia) !== tourRouteHash({ ...base, via: [leg("a", "b", P(52, 320))] }))
    ok("2 m verschobener Wegpunkt zählt");
  else bad("2 m", "gleich");
  const noisy = {
    ...base,
    stops: base.stops.map((s) => ({ ...s, coord: [s.coord[0] + 1e-8, s.coord[1] - 1e-8] as LngLat })),
  };
  if (h === tourRouteHash(noisy)) ok("Fliesskomma-Rauschen zählt nicht");
  else bad("Rauschen", "1e-8 Grad ergibt eine andere Marke");
  const keys = chainKeys(base.start, base.end, ["a", "b"]);
  const cleaned = reconcileVia(cleanRouteVia(mitVia.via), keys).legs;
  if (tourRouteHash({ ...mitVia, via: cleaned }) === tourRouteHash(mitVia))
    ok("clean + reconcile ändert die Marke sauberer Wegpunkte nicht");
  else bad("clean + reconcile", "Marke driftet zwischen Formular und Server");
  if (h !== tourRouteHash({ ...base, stops: [{ id: "a", coord: P(0, 310) }, base.stops[1]] }))
    ok("verschobene Station zählt");
  else bad("Station verschoben", "gleich");
}

// ── 2. Fremde Daten festnageln ────────────────────────────────────────────────────────
console.log("\n2. cleanRouteVia wirft Müll weg und deckelt");
{
  for (const [name, v] of [
    ["null", null],
    ["undefined", undefined],
    ["leer", []],
    ["String", "x"],
    ["Objekt", {}],
    ["Schlüssel keine Strings", [{ from: 1, to: "b", coords: [[13, 47]] }]],
    ["from = to", [{ from: "a", to: "a", coords: [[13, 47]] }]],
    ["NaN", [{ from: "a", to: "b", coords: [[NaN, 47]] }]],
    ["ausserhalb", [{ from: "a", to: "b", coords: [[13, 97]] }]],
    ["ohne Koordinaten", [{ from: "a", to: "b", coords: [] }]],
  ] as const) {
    const r = cleanRouteVia(v);
    if (r.length === 0) ok(`${name} -> []`);
    else bad(name, JSON.stringify(r));
  }
  const many = cleanRouteVia([{ from: "a", to: "b", coords: Array.from({ length: 30 }, () => [13, 47]) }]);
  if (many[0]?.coords.length === MAX_DIRECTIONS_COORDS - 2) ok("Deckel je Abschnitt", `${many[0]?.coords.length}`);
  else bad("Deckel je Abschnitt", String(many[0]?.coords.length));
  const total = cleanRouteVia([
    { from: "a", to: "b", coords: Array.from({ length: 20 }, () => [13, 47]) },
    { from: "b", to: "c", coords: Array.from({ length: 10 }, () => [13, 47]) },
  ]);
  if (countVia(total) === MAX_DIRECTIONS_COORDS - 2) ok("Deckel gesamt", `${countVia(total)}`);
  else bad("Deckel gesamt", String(countVia(total)));
  const dup = cleanRouteVia([
    { from: "a", to: "b", coords: [[13, 47]] },
    { from: "a", to: "b", coords: [[13.1, 47.1]] },
  ]);
  if (dup.length === 1 && dup[0].coords[0][0] === 13.1) ok("doppeltes Paar: das letzte gewinnt");
  else bad("doppeltes Paar", JSON.stringify(dup));
  const mixed = cleanRouteVia([{ from: "a", to: "b", coords: [[13, 47], "kaputt"] }]);
  if (mixed.length === 0) ok("eine kaputte Koordinate wirft den Abschnitt");
  else bad("kaputte Koordinate", JSON.stringify(mixed));
}

// ── 3. Wegpunkte folgen den Abschnitten ───────────────────────────────────────────────
console.log("\n3. reconcileVia: Umsortieren, Entfernen, Kleben");
{
  const S = "start";
  const E = "end";
  const legs = [
    leg(S, "1", P(1, 1)),
    leg("1", "2", P(2, 2)),
    leg("2", "3", P(3, 3), P(3, 4)),
    leg("3", "4", P(4, 4)),
    leg("4", E, P(5, 5)),
  ];
  const r1 = reconcileVia(legs, [S, "1", "2", "3", "4", E]);
  if (same(r1.legs, legs) && r1.dropped === 0) ok("unveränderte Kette: alles bleibt, in Reihenfolge");
  else bad("unverändert", JSON.stringify(r1));

  const r2 = reconcileVia(legs, [S, "1", "3", "2", "4", E]);
  const want2 = [leg(S, "1", P(1, 1)), leg("3", "2", P(3, 4), P(3, 3)), leg("4", E, P(5, 5))];
  if (same(r2.legs, want2) && r2.dropped === 2) ok("3 über 2: 2→3 überlebt umgekehrt, 1→2 und 3→4 weg", `dropped ${r2.dropped}`);
  else bad("3 über 2", JSON.stringify(r2));

  const r3 = reconcileVia(legs, [S, "1", "3", "4", E]);
  const want3 = [leg(S, "1", P(1, 1)), leg("1", "3", P(2, 2), P(3, 3), P(3, 4)), leg("3", "4", P(4, 4)), leg("4", E, P(5, 5))];
  if (same(r3.legs, want3) && r3.dropped === 0) ok("Station 2 entfernt: 1→2 und 2→3 zu 1→3 geklebt");
  else bad("Station entfernt", JSON.stringify(r3));

  const r4 = reconcileVia(legs, [S, "1", "4", E]);
  if (same(r4.legs[1], leg("1", "4", P(2, 2), P(3, 3), P(3, 4), P(4, 4))) && r4.dropped === 0)
    ok("Stationen 2 und 3 entfernt: dreifach geklebt");
  else bad("zwei entfernt", JSON.stringify(r4));

  const r5 = reconcileVia(legs, ["1", "2", "3", "4", E]);
  if (r5.legs.length === 4 && r5.dropped === 1 && r5.legs[0].from === "1") ok("Start entfernt: start→1 weg");
  else bad("Start entfernt", JSON.stringify(r5));
  const r5b = reconcileVia(legs, ["1", "2", "3", "4"]);
  if (r5b.legs.length === 3 && r5b.dropped === 2) ok("Start und Ziel entfernt: beide Randabschnitte weg");
  else bad("Start und Ziel entfernt", JSON.stringify(r5b));

  const r6 = reconcileVia([leg("x", "y", P(9, 9)), ...legs], [S, "1", "2", "3", "4", E]);
  if (r6.legs.length === 5 && r6.dropped === 1) ok("unbekannte Schlüssel fallen weg");
  else bad("unbekannt", JSON.stringify(r6));

  const twice = reconcileVia(r2.legs, [S, "1", "3", "2", "4", E]);
  if (same(twice.legs, r2.legs) && twice.dropped === 0) ok("idempotent: zweimal = einmal (keine doppelte Umkehr)");
  else bad("idempotent", JSON.stringify(twice));

  // Navigation: nach dem X auf Halt 3 sind 2 und 4 direkt hintereinander.
  const r7 = reconcileVia(legs, [S, "2", "4", E]);
  if (same(r7.legs, [leg(S, "2", P(1, 1), P(2, 2)), leg("2", "4", P(3, 3), P(3, 4), P(4, 4)), leg("4", E, P(5, 5))]))
    ok("übersprungener Halt: Abschnitte darüber geklebt");
  else bad("übersprungen", JSON.stringify(r7));
}

// ── 4. Die Kette ───────────────────────────────────────────────────────────────────────
console.log("\n4. flattenChain hängt Wegpunkte zwischen ihre Anker");
{
  const stops = [
    { id: "a", coord: P(0, 100) },
    { id: "b", coord: P(0, 200) },
    { id: "c", coord: P(0, 300) },
  ];
  const via = [leg("start", "a", P(0, 50)), leg("b", "c", P(0, 250))];
  const chain = flattenChain({ start: RP(0, 0), end: RP(0, 400), stops, via });
  const kinds = chain.map((n) => n.kind).join(",");
  if (kinds === "start,via,stop,stop,via,stop,end") ok("Reihenfolge", kinds);
  else bad("Reihenfolge", kinds);
  const legIdx = chain.filter((n) => n.kind === "via").map((n) => n.legIndex).join(",");
  if (legIdx === "0,2") ok("legIndex der Wegpunkte", legIdx);
  else bad("legIndex", legIdx);
  const ohneStart = flattenChain({ start: null, end: RP(0, 400), stops, via });
  if (ohneStart[0].key === "a" && ohneStart.filter((n) => n.kind === "via").length === 1)
    ok("ohne Start beginnt die Kette an der ersten Station, start→a fällt weg");
  else bad("ohne Start", ohneStart.map((n) => n.kind).join(","));
  const ohneEnde = flattenChain({ start: RP(0, 0), end: null, stops, via });
  if (ohneEnde[ohneEnde.length - 1].key === "c") ok("ohne Ziel endet sie an der letzten Station");
  else bad("ohne Ziel", ohneEnde[ohneEnde.length - 1].key);
  const unplaced = flattenChain({ start: null, end: null, stops: [{ id: "x", coord: null }, ...stops], via: [] });
  if (chainCoords(unplaced).length === 3 && unplaced.length === 4) ok("Station ohne Punkt: in der Kette, nicht in den Koordinaten");
  else bad("ohne Punkt", `${unplaced.length} / ${chainCoords(unplaced).length}`);

  const many = Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, coord: P(i * 10, 0) }));
  const full = chainCoords(flattenChain({ start: RP(-10, 0), end: RP(240, 0), stops: many, via: [] }));
  if (full.length === MAX_DIRECTIONS_COORDS) ok("Start + 23 Stationen + Ziel = 25, passt");
  else bad("25", String(full.length));
  const over = chainCoords(flattenChain({ start: RP(-10, 0), end: RP(240, 0), stops: many, via: [leg("start", "p0", P(-5, 0))] }));
  if (over.length === MAX_DIRECTIONS_COORDS + 1) ok("ein Wegpunkt mehr = 26, der Server meldet es");
  else bad("26", String(over.length));
}

// ── 5. Wo ein Tipp hingehört ──────────────────────────────────────────────────────────
console.log("\n5. legForTap: auf der Linie gemessen, sonst auf der geraden Kette");
{
  // U-förmige Linie: hinauf, hinüber, hinunter, dann nach Osten. Anker: Start unten links,
  // Station A unten in der Mitte (Ende des U), Ziel rechts aussen.
  const line: LngLat[] = [];
  for (let y = 0; y <= 300; y += 10) line.push(P(0, y));
  for (let x = 10; x <= 100; x += 10) line.push(P(x, 300));
  for (let y = 290; y >= 0; y -= 10) line.push(P(100, y));
  for (let x = 110; x <= 200; x += 10) line.push(P(x, 0));
  const mk = (via: ViaLeg[], aY = 0): ChainNode[] =>
    flattenChain({ start: RP(0, 0), end: RP(200, 0), stops: [{ id: "A", coord: P(100, aY) }], via });

  const tap = P(100, 150); // rechter Arm des U, kurz vor Station A
  const onLine = legForTap({ chain: mk([]), line, tap });
  if (onLine?.legIndex === 0) ok("auf der Linie: rechter Arm gehört noch zu Start→A");
  else bad("auf der Linie", JSON.stringify(onLine));
  const stale = legForTap({ chain: mk([]), line, tap, stale: true });
  if (stale?.legIndex === 1) ok("veraltete Linie: gerade Kette sagt A→Ziel (andere Antwort, bewusst)");
  else bad("veraltet", JSON.stringify(stale));
  const noLine = legForTap({ chain: mk([]), line: null, tap });
  if (same(noLine, stale)) ok("ohne Linie wie veraltet");
  else bad("ohne Linie", JSON.stringify(noLine));

  const vias = [leg("start", "A", P(0, 150), P(100, 300))];
  const between = legForTap({ chain: mk(vias), line, tap: P(50, 300) });
  if (between?.legIndex === 0 && between.insertAt === 1) ok("zwischen zwei Wegpunkten: an Stelle 1");
  else bad("zwischen", JSON.stringify(between));
  const betweenStale = legForTap({ chain: mk(vias), line, tap: P(50, 300), stale: true });
  if (betweenStale?.legIndex === 0 && betweenStale.insertAt === 1) ok("dasselbe auf der geraden Kette");
  else bad("zwischen (gerade)", JSON.stringify(betweenStale));
  const after = legForTap({ chain: mk(vias), line, tap: P(100, 100) });
  if (after?.legIndex === 0 && after.insertAt === 2) ok("hinter beiden: ans Ende des Abschnitts");
  else bad("hinter beiden", JSON.stringify(after));

  // Station A 80 m neben der Linie: Die Linie passt nicht mehr, also gerade Kette.
  const off = legForTap({ chain: mk([], -80), line, tap: P(150, 0) });
  const offStale = legForTap({ chain: mk([], -80), line, tap: P(150, 0), stale: true });
  if (off && same(off, offStale)) ok("Anker 80 m neben der Linie: Rückfall auf die gerade Kette", JSON.stringify(off));
  else bad("Rückfall", `${JSON.stringify(off)} vs ${JSON.stringify(offStale)}`);
  if (legForTap({ chain: flattenChain({ start: RP(0, 0), end: null, stops: [], via: [] }), line, tap }) === null)
    ok("ein einzelner Anker: kein Abschnitt");
  else bad("ein Anker", "Abschnitt gefunden");
}

// ── 6. Formular-Helfer ────────────────────────────────────────────────────────────────
console.log("\n6. insertVia / moveVia / removeVia");
{
  const legs = [leg("start", "a", P(1, 1), P(3, 3)), leg("a", "b", P(5, 5))];
  const ins = insertVia(legs, "start", "a", 1, P(2, 2));
  if (same(ins[0].coords, [P(1, 1), P(2, 2), P(3, 3)]) && same(ins[1], legs[1])) ok("einfügen an Stelle 1, anderer Abschnitt unberührt");
  else bad("einfügen", JSON.stringify(ins));
  const neu = insertVia(legs, "b", "end", 0, P(7, 7));
  if (neu.length === 3 && neu[2].from === "b") ok("einfügen in neuen Abschnitt");
  else bad("neuer Abschnitt", JSON.stringify(neu));
  const mv = moveVia(legs, viaIdOf(P(3, 3)), P(4, 4));
  if (same(mv[0].coords, [P(1, 1), P(4, 4)]) && same(mv[1], legs[1])) ok("verschieben ändert nur den einen");
  else bad("verschieben", JSON.stringify(mv));
  const rm = removeVia(legs, viaIdOf(P(5, 5)));
  if (rm.length === 1 && same(rm[0], legs[0])) ok("entfernen räumt den leeren Abschnitt weg");
  else bad("entfernen", JSON.stringify(rm));
  if (viaIdOf(P(1, 1)) === viaIdOf([P(1, 1)[0] + 1e-9, P(1, 1)[1]])) ok("Kennung übersteht Rauschen");
  else bad("Kennung", "1e-9 Grad ergibt eine andere");
}

// ── 7. Navigation ─────────────────────────────────────────────────────────────────────
console.log("\n7. selectNavVias: nur vor dem Gast, nur zu offenen Halten, gedeckelt");
{
  const stopCoords = [P(0, 300), P(100, 300), P(200, 300), P(300, 300)];
  const start = P(0, 0);
  const a = P(0, 150);
  const b = P(50, 320);
  const c = P(150, 320);
  const d = P(250, 320);
  const e = P(300, 150);
  const legs = [leg("start", "0", a), leg("0", "1", b), leg("1", "2", c), leg("2", "3", d), leg("3", "end", e)];
  const ids = (v: { id: string }[]) => v.map((x) => x.id).join(" ");
  const id = (p: LngLat) => viaIdOf(p);

  const n1 = selectNavVias({ legs, keep: [0, 1, 2, 3], stopCoords, end: start, origin: start, isReroute: false });
  if (ids(n1) === [a, b, c, d, e].map(id).join(" ") && same(n1.map((v) => v.before), [0, 1, 2, 3, "end"]))
    ok("frischer Start: alle fünf, in Reihenfolge, vor ihrem Halt");
  else bad("frisch", JSON.stringify(n1));
  const chain1 = buildBikeChain(start, stopCoords, start, n1);
  const kinds1 = chain1.kinds.map((k) => (k.kind === "stop" ? `s${k.pos}` : k.kind === "via" ? "v" : k.kind)).join(",");
  if (kinds1 === "origin,v,s0,v,s1,v,s2,v,s3,v,end" && chain1.coords.length === 11) ok("Koordinatenfolge", kinds1);
  else bad("Koordinatenfolge", kinds1);
  if (n1.some((v) => v.id === id(e))) ok("Rundweg: Wegpunkt des letzten Abschnitts bleibt trotz Start = Ziel");
  else bad("Rundweg", "letzter Abschnitt verloren");

  const n2 = selectNavVias({ legs, keep: [2, 3], stopCoords, end: start, origin: P(120, 300), isReroute: false });
  if (ids(n2) === [c, d, e].map(id).join(" ") && same(n2.map((v) => v.before), [0, 1, "end"]))
    ok("Wiedereinstieg vor Halt 2: a und b liegen hinter dem Gast, c vor ihm");
  else bad("Wiedereinstieg", JSON.stringify(n2));

  const n4 = selectNavVias({
    legs,
    keep: [1, 2, 3],
    stopCoords,
    end: start,
    origin: P(90, 300),
    isReroute: true,
    alongM: 530,
    viaAlongM: { [id(c)]: 550, [id(d)]: 750 },
  });
  if (ids(n4) === [d, e].map(id).join(" ")) ok("Neuberechnung: c liegt 20 m voraus und fällt, d und e bleiben, e ohne bekannten Stand");
  else bad("Neuberechnung", JSON.stringify(n4));

  const n5 = selectNavVias({ legs, keep: [0, 2, 3], stopCoords, end: start, origin: start, isReroute: false });
  if (ids(n5) === [a, b, c, d, e].map(id).join(" ") && same(n5.map((v) => v.before), [0, 1, 1, 2, "end"]))
    ok("Halt 1 per X übersprungen: b und c gehören jetzt beide vor Halt 2");
  else bad("übersprungen", JSON.stringify(n5));

  const n7 = selectNavVias({ legs, keep: [0, 1, 2, 3], stopCoords, end: null, origin: start, isReroute: false });
  if (ids(n7) === [a, b, c, d].map(id).join(" ")) ok("ohne Ziel: der Abschnitt zum Ziel fällt weg");
  else bad("ohne Ziel", JSON.stringify(n7));
  const chain7 = buildBikeChain(start, stopCoords, null, n7);
  if (chain7.kinds[chain7.kinds.length - 1].kind === "stop") ok("ohne Ziel endet die Folge am letzten Halt");
  else bad("ohne Ziel Folge", JSON.stringify(chain7.kinds.at(-1)));

  // Deckel: 22 Halte + Origin + Ziel = 24, Platz für genau einen Wegpunkt.
  const manyStops = Array.from({ length: 22 }, (_, i) => P(i * 10, 300));
  const capLegs = [leg("start", "0", P(0, 150)), leg("21", "end", P(210, 150))];
  const n6 = selectNavVias({ legs: capLegs, keep: manyStops.map((_, i) => i), stopCoords: manyStops, end: start, origin: start, isReroute: false });
  if (n6.length === 1 && n6[0].before === 0) ok("Deckel: der hinterste Abschnitt fällt zuerst");
  else bad("Deckel", JSON.stringify(n6));
  const tenStops = Array.from({ length: 10 }, (_, i) => P(i * 10, 300));
  const twoEach = [leg("start", "0", P(0, 100), P(0, 200)), ...Array.from({ length: 9 }, (_, i) => leg(String(i), String(i + 1), P(i * 10 + 3, 310), P(i * 10 + 6, 310)))];
  const n6b = selectNavVias({ legs: twoEach, keep: tenStops.map((_, i) => i), stopCoords: tenStops, end: start, origin: start, isReroute: false });
  const chain6b = buildBikeChain(start, tenStops, start, n6b);
  if (n6b.length === 12 && chain6b.coords.length === 24 && chain6b.kinds.at(-1)?.kind === "end" && n6b.every((v) => v.before !== "end" && (v.before as number) <= 5))
    ok("Deckel: 20 Wegpunkte auf 10 Halte -> 12 bleiben, Halte und Ziel nie", `${chain6b.coords.length} Koordinaten`);
  else bad("Deckel gross", `${n6b.length} Wegpunkte, ${chain6b.coords.length} Koordinaten`);

  if (selectNavVias({ legs, keep: [], stopCoords, end: start, origin: start, isReroute: false }).length === 0)
    ok("ohne Halte keine Wegpunkte");
  else bad("ohne Halte", "Wegpunkte");
}

// ── 8. Antwort zurücklesen ────────────────────────────────────────────────────────────
console.log("\n8. alongFromViaWaypoints: Halte und Wegpunkte auf unserer Linie");
{
  const start = P(0, 0);
  const stops = [P(0, 300), P(100, 300)];
  const vias = [
    { id: "v1", coord: P(0, 150), before: 0 as const },
    { id: "v2", coord: P(50, 320), before: 1 as const },
  ];
  const chain = buildBikeChain(start, stops, start, vias);
  // origin, v1, s0, v2, s1, end -> stille Punkte 1..4
  const cum = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
  const via = [
    { waypoint_index: 1, geometry_index: 1, distance_from_start: 50 },
    { waypoint_index: 2, geometry_index: 3, distance_from_start: 150 },
    { waypoint_index: 3, geometry_index: 5, distance_from_start: 250 },
    { waypoint_index: 4, geometry_index: 7, distance_from_start: 350 },
  ];
  const r = alongFromViaWaypoints(chain.kinds, via, cum, stops.length);
  if (same(r.spotAlongM, [150, 350]) && r.viaAlongM.v1 === 50 && r.viaAlongM.v2 === 250) ok("gemischte Folge", JSON.stringify(r));
  else bad("gemischt", JSON.stringify(r));

  const plain = buildBikeChain(start, stops, null, []);
  const r2 = alongFromViaWaypoints(plain.kinds, [{ waypoint_index: 1, geometry_index: 4, distance_from_start: 200 }], cum, stops.length);
  if (same(r2.spotAlongM, [200, 500]) && Object.keys(r2.viaAlongM).length === 0)
    ok("ohne Wegpunkte und ohne Ziel: letzter Halt = Routenende (wie bisher)");
  else bad("ohne Wegpunkte", JSON.stringify(r2));
  const r3 = alongFromViaWaypoints(plain.kinds, [{ waypoint_index: 9, geometry_index: 4, distance_from_start: 200 }], cum, stops.length);
  if (same(r3.spotAlongM, [500, 500])) ok("unbekannter waypoint_index wird ignoriert");
  else bad("unbekannter Index", JSON.stringify(r3));
}

console.log(failed ? `\n${failed} Probleme.` : "\nAlles in Ordnung.");
process.exit(failed ? 1 : 0);
