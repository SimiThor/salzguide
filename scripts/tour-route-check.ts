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
import { viaIdOf, MAX_DIRECTIONS_COORDS, type LngLat, type ViaLeg, type ChainNode } from "@/lib/tour-route";
import type { NavVia, BikeChainKind } from "@/lib/bike-directions";
import {
  out,
  evaluate,
  P,
  leg,
  S2_GARBAGE,
  S3_LEGS,
  S3_START,
  S3_END,
  S6_LEGS,
  S7,
} from "./lib/tour-route-cases.ts";

// Die Aufrufe (welche Funktion, welche Eingaben) stehen in scripts/lib/tour-route-cases.ts
// und werden von scripts/nav-fixtures.ts (Swift-Gleichheit, docs/41 6.1) mitbenutzt. Hier
// stehen nur die ERWARTUNGEN.

let failed = 0;
const ok = (name: string, detail = "") => console.log(`  ok    ${name}${detail ? `  (${detail})` : ""}`);
const bad = (name: string, detail: string) => {
  failed++;
  console.log(`  FEHLT ${name}\n        ${detail}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. Die Marke ──────────────────────────────────────────────────────────────────────
console.log("\n1. Die Aktualitäts-Marke reagiert auf alles, was die Linie ändert");
{
  const h = out<string>("01/hash-base");
  if (h === evaluate("01/hash-base")) ok("gleicher Stand, gleiche Marke");
  else bad("gleicher Stand", "zwei Marken");
  if (h !== out("01/hash-mode-walk")) ok("Fortbewegung zählt");
  else bad("Fortbewegung", "walk und bike gleich");
  if (h !== out("01/hash-with-via")) ok("Wegpunkt zählt");
  else bad("Wegpunkt", "ohne und mit gleich");
  if (out("01/hash-with-via") !== out("01/hash-via-moved-2m"))
    ok("2 m verschobener Wegpunkt zählt");
  else bad("2 m", "gleich");
  if (h === out("01/hash-noisy")) ok("Fliesskomma-Rauschen zählt nicht");
  else bad("Rauschen", "1e-8 Grad ergibt eine andere Marke");
  if (out("01/hash-cleaned-reconciled") === out("01/hash-with-via"))
    ok("clean + reconcile ändert die Marke sauberer Wegpunkte nicht");
  else bad("clean + reconcile", "Marke driftet zwischen Formular und Server");
  if (h !== out("01/hash-station-moved"))
    ok("verschobene Station zählt");
  else bad("Station verschoben", "gleich");
}

// ── 2. Fremde Daten festnageln ────────────────────────────────────────────────────────
console.log("\n2. cleanRouteVia wirft Müll weg und deckelt");
{
  for (const [name, key] of S2_GARBAGE) {
    const r = out<ViaLeg[]>(`02/garbage-${key}`);
    if (r.length === 0) ok(`${name} -> []`);
    else bad(name, JSON.stringify(r));
  }
  const many = out<ViaLeg[]>("02/cap-per-leg");
  if (many[0]?.coords.length === MAX_DIRECTIONS_COORDS - 2) ok("Deckel je Abschnitt", `${many[0]?.coords.length}`);
  else bad("Deckel je Abschnitt", String(many[0]?.coords.length));
  const totalCount = out<number>("02/count-cap-total");
  if (totalCount === MAX_DIRECTIONS_COORDS - 2) ok("Deckel gesamt", `${totalCount}`);
  else bad("Deckel gesamt", String(totalCount));
  const dup = out<ViaLeg[]>("02/duplicate-pair");
  if (dup.length === 1 && dup[0].coords[0][0] === 13.1) ok("doppeltes Paar: das letzte gewinnt");
  else bad("doppeltes Paar", JSON.stringify(dup));
  const mixed = out<ViaLeg[]>("02/broken-coordinate");
  if (mixed.length === 0) ok("eine kaputte Koordinate wirft den Abschnitt");
  else bad("kaputte Koordinate", JSON.stringify(mixed));
}

// ── 3. Wegpunkte folgen den Abschnitten ───────────────────────────────────────────────
console.log("\n3. reconcileVia: Umsortieren, Entfernen, Kleben");
{
  const S = S3_START;
  const E = S3_END;
  const legs = S3_LEGS();
  type Rec = { legs: ViaLeg[]; dropped: number };
  const r1 = out<Rec>("03/unchanged");
  if (same(r1.legs, legs) && r1.dropped === 0) ok("unveränderte Kette: alles bleibt, in Reihenfolge");
  else bad("unverändert", JSON.stringify(r1));

  const r2 = out<Rec>("03/swap-2-3");
  const want2 = [leg(S, "1", P(1, 1)), leg("3", "2", P(3, 4), P(3, 3)), leg("4", E, P(5, 5))];
  if (same(r2.legs, want2) && r2.dropped === 2) ok("3 über 2: 2→3 überlebt umgekehrt, 1→2 und 3→4 weg", `dropped ${r2.dropped}`);
  else bad("3 über 2", JSON.stringify(r2));

  const r3 = out<Rec>("03/remove-2");
  const want3 = [leg(S, "1", P(1, 1)), leg("1", "3", P(2, 2), P(3, 3), P(3, 4)), leg("3", "4", P(4, 4)), leg("4", E, P(5, 5))];
  if (same(r3.legs, want3) && r3.dropped === 0) ok("Station 2 entfernt: 1→2 und 2→3 zu 1→3 geklebt");
  else bad("Station entfernt", JSON.stringify(r3));

  const r4 = out<Rec>("03/remove-2-3");
  if (same(r4.legs[1], leg("1", "4", P(2, 2), P(3, 3), P(3, 4), P(4, 4))) && r4.dropped === 0)
    ok("Stationen 2 und 3 entfernt: dreifach geklebt");
  else bad("zwei entfernt", JSON.stringify(r4));

  const r5 = out<Rec>("03/remove-start");
  if (r5.legs.length === 4 && r5.dropped === 1 && r5.legs[0].from === "1") ok("Start entfernt: start→1 weg");
  else bad("Start entfernt", JSON.stringify(r5));
  const r5b = out<Rec>("03/remove-start-end");
  if (r5b.legs.length === 3 && r5b.dropped === 2) ok("Start und Ziel entfernt: beide Randabschnitte weg");
  else bad("Start und Ziel entfernt", JSON.stringify(r5b));

  const r6 = out<Rec>("03/unknown-keys");
  if (r6.legs.length === 5 && r6.dropped === 1) ok("unbekannte Schlüssel fallen weg");
  else bad("unbekannt", JSON.stringify(r6));

  const twice = out<Rec>("03/idempotent");
  if (same(twice.legs, r2.legs) && twice.dropped === 0) ok("idempotent: zweimal = einmal (keine doppelte Umkehr)");
  else bad("idempotent", JSON.stringify(twice));

  // Navigation: nach dem X auf Halt 3 sind 2 und 4 direkt hintereinander.
  const r7 = out<Rec>("03/skipped-stop");
  if (same(r7.legs, [leg(S, "2", P(1, 1), P(2, 2)), leg("2", "4", P(3, 3), P(3, 4), P(4, 4)), leg("4", E, P(5, 5))]))
    ok("übersprungener Halt: Abschnitte darüber geklebt");
  else bad("übersprungen", JSON.stringify(r7));
}

// ── 4. Die Kette ───────────────────────────────────────────────────────────────────────
console.log("\n4. flattenChain hängt Wegpunkte zwischen ihre Anker");
{
  const chain = out<ChainNode[]>("04/chain");
  const kinds = chain.map((n) => n.kind).join(",");
  if (kinds === "start,via,stop,stop,via,stop,end") ok("Reihenfolge", kinds);
  else bad("Reihenfolge", kinds);
  const legIdx = chain.filter((n) => n.kind === "via").map((n) => n.legIndex).join(",");
  if (legIdx === "0,2") ok("legIndex der Wegpunkte", legIdx);
  else bad("legIndex", legIdx);
  const ohneStart = out<ChainNode[]>("04/chain-no-start");
  if (ohneStart[0].key === "a" && ohneStart.filter((n) => n.kind === "via").length === 1)
    ok("ohne Start beginnt die Kette an der ersten Station, start→a fällt weg");
  else bad("ohne Start", ohneStart.map((n) => n.kind).join(","));
  const ohneEnde = out<ChainNode[]>("04/chain-no-end");
  if (ohneEnde[ohneEnde.length - 1].key === "c") ok("ohne Ziel endet sie an der letzten Station");
  else bad("ohne Ziel", ohneEnde[ohneEnde.length - 1].key);
  const unplaced = out<ChainNode[]>("04/chain-unplaced");
  const unplacedCoords = out<LngLat[]>("04/coords-unplaced");
  if (unplacedCoords.length === 3 && unplaced.length === 4) ok("Station ohne Punkt: in der Kette, nicht in den Koordinaten");
  else bad("ohne Punkt", `${unplaced.length} / ${unplacedCoords.length}`);

  const full = out<LngLat[]>("04/coords-full");
  if (full.length === MAX_DIRECTIONS_COORDS) ok("Start + 23 Stationen + Ziel = 25, passt");
  else bad("25", String(full.length));
  const over = out<LngLat[]>("04/coords-over");
  if (over.length === MAX_DIRECTIONS_COORDS + 1) ok("ein Wegpunkt mehr = 26, der Server meldet es");
  else bad("26", String(over.length));
}

// ── 5. Wo ein Tipp hingehört ──────────────────────────────────────────────────────────
console.log("\n5. legForTap: auf der Linie gemessen, sonst auf der geraden Kette");
{
  // U-förmige Linie: hinauf, hinüber, hinunter, dann nach Osten. Anker: Start unten links,
  // Station A unten in der Mitte (Ende des U), Ziel rechts aussen.
  type Tap = { legIndex: number; insertAt: number } | null;
  const onLine = out<Tap>("05/on-line");
  if (onLine?.legIndex === 0) ok("auf der Linie: rechter Arm gehört noch zu Start→A");
  else bad("auf der Linie", JSON.stringify(onLine));
  const stale = out<Tap>("05/stale");
  if (stale?.legIndex === 1) ok("veraltete Linie: gerade Kette sagt A→Ziel (andere Antwort, bewusst)");
  else bad("veraltet", JSON.stringify(stale));
  const noLine = out<Tap>("05/no-line");
  if (same(noLine, stale)) ok("ohne Linie wie veraltet");
  else bad("ohne Linie", JSON.stringify(noLine));

  const between = out<Tap>("05/between-vias");
  if (between?.legIndex === 0 && between.insertAt === 1) ok("zwischen zwei Wegpunkten: an Stelle 1");
  else bad("zwischen", JSON.stringify(between));
  const betweenStale = out<Tap>("05/between-vias-stale");
  if (betweenStale?.legIndex === 0 && betweenStale.insertAt === 1) ok("dasselbe auf der geraden Kette");
  else bad("zwischen (gerade)", JSON.stringify(betweenStale));
  const after = out<Tap>("05/after-vias");
  if (after?.legIndex === 0 && after.insertAt === 2) ok("hinter beiden: ans Ende des Abschnitts");
  else bad("hinter beiden", JSON.stringify(after));

  // Station A 80 m neben der Linie: Die Linie passt nicht mehr, also gerade Kette.
  const off = out<Tap>("05/anchor-off-line");
  const offStale = out<Tap>("05/anchor-off-line-stale");
  if (off && same(off, offStale)) ok("Anker 80 m neben der Linie: Rückfall auf die gerade Kette", JSON.stringify(off));
  else bad("Rückfall", `${JSON.stringify(off)} vs ${JSON.stringify(offStale)}`);
  if (out<Tap>("05/single-anchor") === null)
    ok("ein einzelner Anker: kein Abschnitt");
  else bad("ein Anker", "Abschnitt gefunden");
}

// ── 6. Formular-Helfer ────────────────────────────────────────────────────────────────
console.log("\n6. insertVia / moveVia / removeVia");
{
  const legs = S6_LEGS();
  const ins = out<ViaLeg[]>("06/insert-at-1");
  if (same(ins[0].coords, [P(1, 1), P(2, 2), P(3, 3)]) && same(ins[1], legs[1])) ok("einfügen an Stelle 1, anderer Abschnitt unberührt");
  else bad("einfügen", JSON.stringify(ins));
  const neu = out<ViaLeg[]>("06/insert-new-leg");
  if (neu.length === 3 && neu[2].from === "b") ok("einfügen in neuen Abschnitt");
  else bad("neuer Abschnitt", JSON.stringify(neu));
  const mv = out<ViaLeg[]>("06/move");
  if (same(mv[0].coords, [P(1, 1), P(4, 4)]) && same(mv[1], legs[1])) ok("verschieben ändert nur den einen");
  else bad("verschieben", JSON.stringify(mv));
  const rm = out<ViaLeg[]>("06/remove");
  if (rm.length === 1 && same(rm[0], legs[0])) ok("entfernen räumt den leeren Abschnitt weg");
  else bad("entfernen", JSON.stringify(rm));
  if (out("06/via-id") === out("06/via-id-noisy")) ok("Kennung übersteht Rauschen");
  else bad("Kennung", "1e-9 Grad ergibt eine andere");
}

// ── 7. Navigation ─────────────────────────────────────────────────────────────────────
console.log("\n7. selectNavVias: nur vor dem Gast, nur zu offenen Halten, gedeckelt");
{
  type Chain = { coords: LngLat[]; kinds: BikeChainKind[] };
  const { a, b, c, d, e } = S7;
  const ids = (v: { id: string }[]) => v.map((x) => x.id).join(" ");
  const id = (p: LngLat) => viaIdOf(p);

  const n1 = out<NavVia[]>("07/fresh-start");
  if (ids(n1) === [a, b, c, d, e].map(id).join(" ") && same(n1.map((v) => v.before), [0, 1, 2, 3, "end"]))
    ok("frischer Start: alle fünf, in Reihenfolge, vor ihrem Halt");
  else bad("frisch", JSON.stringify(n1));
  const chain1 = out<Chain>("07/chain-fresh-start");
  const kinds1 = chain1.kinds.map((k) => (k.kind === "stop" ? `s${k.pos}` : k.kind === "via" ? "v" : k.kind)).join(",");
  if (kinds1 === "origin,v,s0,v,s1,v,s2,v,s3,v,end" && chain1.coords.length === 11) ok("Koordinatenfolge", kinds1);
  else bad("Koordinatenfolge", kinds1);
  if (n1.some((v) => v.id === id(e))) ok("Rundweg: Wegpunkt des letzten Abschnitts bleibt trotz Start = Ziel");
  else bad("Rundweg", "letzter Abschnitt verloren");

  const n2 = out<NavVia[]>("07/reentry-before-stop-2");
  if (ids(n2) === [c, d, e].map(id).join(" ") && same(n2.map((v) => v.before), [0, 1, "end"]))
    ok("Wiedereinstieg vor Halt 2: a und b liegen hinter dem Gast, c vor ihm");
  else bad("Wiedereinstieg", JSON.stringify(n2));

  const n4 = out<NavVia[]>("07/reroute");
  if (ids(n4) === [d, e].map(id).join(" ")) ok("Neuberechnung: c liegt 20 m voraus und fällt, d und e bleiben, e ohne bekannten Stand");
  else bad("Neuberechnung", JSON.stringify(n4));

  const n5 = out<NavVia[]>("07/skipped-stop-1");
  if (ids(n5) === [a, b, c, d, e].map(id).join(" ") && same(n5.map((v) => v.before), [0, 1, 1, 2, "end"]))
    ok("Halt 1 per X übersprungen: b und c gehören jetzt beide vor Halt 2");
  else bad("übersprungen", JSON.stringify(n5));

  const n7 = out<NavVia[]>("07/no-end");
  if (ids(n7) === [a, b, c, d].map(id).join(" ")) ok("ohne Ziel: der Abschnitt zum Ziel fällt weg");
  else bad("ohne Ziel", JSON.stringify(n7));
  const chain7 = out<Chain>("07/chain-no-end");
  if (chain7.kinds[chain7.kinds.length - 1].kind === "stop") ok("ohne Ziel endet die Folge am letzten Halt");
  else bad("ohne Ziel Folge", JSON.stringify(chain7.kinds.at(-1)));

  // Deckel: 22 Halte + Origin + Ziel = 24, Platz für genau einen Wegpunkt.
  const n6 = out<NavVia[]>("07/cap-one-via");
  if (n6.length === 1 && n6[0].before === 0) ok("Deckel: der hinterste Abschnitt fällt zuerst");
  else bad("Deckel", JSON.stringify(n6));
  const n6b = out<NavVia[]>("07/cap-large");
  const chain6b = out<Chain>("07/chain-cap-large");
  if (n6b.length === 12 && chain6b.coords.length === 24 && chain6b.kinds.at(-1)?.kind === "end" && n6b.every((v) => v.before !== "end" && (v.before as number) <= 5))
    ok("Deckel: 20 Wegpunkte auf 10 Halte -> 12 bleiben, Halte und Ziel nie", `${chain6b.coords.length} Koordinaten`);
  else bad("Deckel gross", `${n6b.length} Wegpunkte, ${chain6b.coords.length} Koordinaten`);

  if (out<NavVia[]>("07/no-stops").length === 0)
    ok("ohne Halte keine Wegpunkte");
  else bad("ohne Halte", "Wegpunkte");
}

console.log(failed ? `\n${failed} Probleme.` : "\nAlles in Ordnung.");
process.exit(failed ? 1 : 0);
