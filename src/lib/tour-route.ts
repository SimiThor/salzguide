// Route einer KURATIERTEN Runde: eine Quelle für die Kette (Start, Stationen, Wegpunkte,
// Ziel), die Aktualitäts-Marke und die Prüfung der Geometrie. Läuft identisch auf Client
// (Formular, Player, Rad-Navigation) und Server (Snapping, Speichern), wie spot-hash.ts
// bei den Übersetzungen. Keine Server-Imports.
//
// Die Linie wird serverseitig bei Mapbox geholt (tour-actions.ts), im Formular gehalten
// und beim Speichern mitgeschickt. Der Hash sagt, AUS WELCHEM STAND sie gerechnet wurde:
// Fortbewegung, Start, Stationen mit ihren Koordinaten, Wegpunkte, Ziel. Weicht er ab,
// zeigt das Formular „Route veraltet". Bis 15.09.2026 fehlten Fortbewegung und
// Koordinaten: Eine auf „Rad" umgestellte Runde behielt ihre Geh-Linie über Treppen ohne
// Warnung, und ein im Punkt-Editor verschobener Punkt liess die Linie still daneben liegen.
//
// WEGPUNKTE OHNE GESCHICHTE (Migration 0071, tours.route_via): Punkte, die nur den Verlauf
// formen, um die Fussgaengerzone herum oder ueber die Uferseite. Sie haben kein Audio und
// erscheinen nirgends als Station. Ein Wegpunkt gehoert zum ABSCHNITT zwischen zwei
// aufeinanderfolgenden Punkten der Kette (`from`/`to`: "start", "end" oder Punkt-ID), nicht
// zu einer festen Position in einer flachen Liste: Wird eine Station umsortiert oder
// entfernt, weiss die Runde noch, wozu jeder Wegpunkt gehoerte (reconcileVia). Die
// Alternative, ein Pool-Punkt ohne Text als Pseudo-Station, bekaeme einen Play-Knopf ohne
// Geschichte (docs/40, bike-directions.ts).
//
// Dieselbe Kette fuer alle: die Vorschau-Linie im Editor, die Mapbox-Anfrage des Servers,
// die Ersatzlinie im Player und die Anfrage der Rad-Navigation (die ab der GPS-Position neu
// rechnet und die Wegpunkte mitnimmt, bike-directions.ts).
import { hashTexts } from "./spot-hash";
import { nearestPointOnRoute, routeCumulativeMeters } from "./geo";
import type { TourMode } from "./tour-mode";

export type RoutePoint = { lat: number; lng: number };
export type LngLat = [number, number];

// Schluessel eines Kettenpunkts: "start", "end" oder die ID eines Pool-Punkts.
export type NodeKey = string;
export const START_KEY = "start";
export const END_KEY = "end";

/** Wegpunkte eines Abschnitts, in Fahrtrichtung von `from` nach `to`. */
export type ViaLeg = { from: NodeKey; to: NodeKey; coords: LngLat[] };

// Mapbox Directions nimmt hoechstens 25 Koordinaten je Anfrage, fuer Geh- und Radprofil.
// EINE Zahl fuer Editor (Zaehlwerk), Server (Anfrage) und Navigation (Origin + Halte +
// Wegpunkte + Ziel): Bis 15.09.2026 stand sie zweimal, und die Navigation kuerzte still.
export const MAX_DIRECTIONS_COORDS = 25;
// Mehr Wegpunkte als Platz zwischen Start und Ziel kann es nicht sinnvoll geben.
const MAX_VIA_TOTAL = MAX_DIRECTIONS_COORDS - 2;
const MAX_VIA_LEGS = 40;
const MAX_KEY_LEN = 64;

// 5 Nachkommastellen ≈ 1 m: genau genug, um ein Verschieben zu erkennen, grob genug, dass
// Fliesskomma-Rauschen keine falsche Warnung ausloest.
const fmt = (c: LngLat | null): string =>
  c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? `${c[1].toFixed(5)},${c[0].toFixed(5)}` : "-";

const toLngLat = (p: RoutePoint | null): LngLat | null =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? [p.lng, p.lat] : null;

function validLngLat(v: unknown): LngLat | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lng, lat] = v as [unknown, unknown];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

/** Kennung eines Wegpunkts aus seiner Lage: stabil ueber Ketten hinweg (Navigation), eindeutig genug. */
export function viaIdOf(c: LngLat): string {
  return `v:${c[0].toFixed(6)},${c[1].toFixed(6)}`;
}

// ── Wegpunkte aus fremder Hand festnageln ──────────────────────────────────────────────
/**
 * `route_via` aus DB oder Formular auf das Format [{from, to, coords}] festnageln. Ein
 * Abschnitt mit irgendeiner kaputten Koordinate faellt ganz weg (wie cleanRouteGeo: lieber
 * kein Wegpunkt als einer quer ueber den Globus). Doppelte Paare: das letzte gewinnt.
 */
export function cleanRouteVia(value: unknown): ViaLeg[] {
  if (!Array.isArray(value)) return [];
  const byPair = new Map<string, ViaLeg>();
  for (const item of value.slice(0, MAX_VIA_LEGS)) {
    if (!item || typeof item !== "object") continue;
    const { from, to, coords } = item as Record<string, unknown>;
    if (typeof from !== "string" || typeof to !== "string" || !from || !to || from === to) continue;
    if (from.length > MAX_KEY_LEN || to.length > MAX_KEY_LEN) continue;
    if (!Array.isArray(coords) || !coords.length) continue;
    const pts: LngLat[] = [];
    let broken = false;
    for (const c of coords) {
      const p = validLngLat(c);
      if (!p) {
        broken = true;
        break;
      }
      pts.push(p);
    }
    if (broken) continue;
    byPair.set(`${from}>${to}`, { from, to, coords: pts.slice(0, MAX_VIA_TOTAL) });
  }
  const out: ViaLeg[] = [];
  let total = 0;
  for (const leg of byPair.values()) {
    const room = MAX_VIA_TOTAL - total;
    if (room <= 0) break;
    const coords = leg.coords.slice(0, room);
    out.push({ from: leg.from, to: leg.to, coords });
    total += coords.length;
  }
  return out;
}

// ── Die Kette ──────────────────────────────────────────────────────────────────────────
/** Die Schluessel der Kette in Reihenfolge: Start (wenn gesetzt), Stationen, Ziel (wenn gesetzt). */
export function chainKeys(start: RoutePoint | null, end: RoutePoint | null, pointIds: string[]): NodeKey[] {
  return [...(start ? [START_KEY] : []), ...pointIds, ...(end ? [END_KEY] : [])];
}

/**
 * Wegpunkte an eine (neue) Kette anpassen. Je Paar (A,B) aufeinanderfolgender Schluessel:
 *   - der Abschnitt (A,B) bleibt;
 *   - (B,A) ueberlebt mit umgekehrter Reihenfolge (Station 3 ueber 2 geschoben);
 *   - ein Pfad A→X…→B, dessen Zwischenknoten alle aus der Kette verschwunden sind, wird
 *     zu (A,B) zusammengeklebt (Station entfernt, Halt in der Navigation erledigt);
 *   - alles andere faellt weg, `dropped` zaehlt die verlorenen Wegpunkte.
 * Idempotent: Ein zweiter Lauf aendert nichts mehr. Ergebnis in Kettenreihenfolge.
 */
export function reconcileVia(legs: ViaLeg[], keys: NodeKey[]): { legs: ViaLeg[]; dropped: number } {
  const keySet = new Set(keys);
  const direct = new Map<string, ViaLeg>();
  const outgoing = new Map<NodeKey, ViaLeg[]>();
  for (const l of legs) {
    direct.set(`${l.from}>${l.to}`, l);
    const list = outgoing.get(l.from);
    if (list) list.push(l);
    else outgoing.set(l.from, [l]);
  }
  const used = new Set<ViaLeg>();
  const out: ViaLeg[] = [];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    const fwd = direct.get(`${a}>${b}`);
    if (fwd) {
      out.push({ from: a, to: b, coords: [...fwd.coords] });
      used.add(fwd);
      continue;
    }
    const rev = direct.get(`${b}>${a}`);
    if (rev) {
      out.push({ from: a, to: b, coords: [...rev.coords].reverse() });
      used.add(rev);
      continue;
    }
    const path = splicePath(a, b, outgoing, keySet);
    if (path) {
      out.push({ from: a, to: b, coords: path.flatMap((l) => l.coords) });
      for (const l of path) used.add(l);
    }
  }
  let dropped = 0;
  for (const l of legs) if (!used.has(l)) dropped += l.coords.length;
  return { legs: out.filter((l) => l.coords.length > 0), dropped };
}

// Vorwaerts von `a` ueber Knoten, die es in der Kette nicht mehr gibt, bis `b`.
function splicePath(
  a: NodeKey,
  b: NodeKey,
  outgoing: Map<NodeKey, ViaLeg[]>,
  keySet: Set<NodeKey>,
): ViaLeg[] | null {
  const visited = new Set<NodeKey>([a]);
  const walk = (node: NodeKey, depth: number): ViaLeg[] | null => {
    if (depth > MAX_VIA_LEGS) return null;
    for (const l of outgoing.get(node) ?? []) {
      if (l.to === b) return [l];
      if (keySet.has(l.to) || visited.has(l.to)) continue;
      visited.add(l.to);
      const rest = walk(l.to, depth + 1);
      if (rest) return [l, ...rest];
    }
    return null;
  };
  return walk(a, 0);
}

export type ChainStop = { id: string; coord: LngLat | null };
export type ChainNode = {
  key: NodeKey;
  kind: "start" | "stop" | "via" | "end";
  /** null nur bei einer Station ohne Punkt auf der Karte. */
  coord: LngLat | null;
  /** Nur bei Wegpunkten: Kennung (viaIdOf) und Index des Abschnitts (0 = nach dem ersten Ankerpunkt). */
  viaId?: string;
  legIndex?: number;
};

/**
 * Die Kette in Reihenfolge, Wegpunkte zwischen ihren Ankerpunkten eingehaengt. Nur
 * Abschnitte, deren Schluessel direkt aufeinanderfolgen, kommen vor (vorher reconcileVia).
 */
export function flattenChain(input: {
  start: RoutePoint | null;
  end: RoutePoint | null;
  stops: ChainStop[];
  via: ViaLeg[];
}): ChainNode[] {
  const anchors: ChainNode[] = [];
  const s = toLngLat(input.start);
  if (s) anchors.push({ key: START_KEY, kind: "start", coord: s });
  for (const st of input.stops) anchors.push({ key: st.id, kind: "stop", coord: st.coord });
  const e = toLngLat(input.end);
  if (e) anchors.push({ key: END_KEY, kind: "end", coord: e });

  const byPair = new Map(input.via.map((l) => [`${l.from}>${l.to}`, l]));
  const out: ChainNode[] = [];
  for (let i = 0; i < anchors.length; i++) {
    if (i > 0) {
      const leg = byPair.get(`${anchors[i - 1].key}>${anchors[i].key}`);
      if (leg)
        for (const c of leg.coords)
          out.push({ key: viaIdOf(c), kind: "via", coord: c, viaId: viaIdOf(c), legIndex: i - 1 });
    }
    out.push(anchors[i]);
  }
  return out;
}

/** Nur die Koordinaten der Kette, ohne Stationen, die noch keinen Punkt auf der Karte haben. */
export function chainCoords(chain: ChainNode[]): LngLat[] {
  return chain.filter((n): n is ChainNode & { coord: LngLat } => n.coord !== null).map((n) => n.coord);
}

/** Zahl der Wegpunkte in einer Abschnittsliste. */
export function countVia(legs: ViaLeg[]): number {
  return legs.reduce((n, l) => n + l.coords.length, 0);
}

// ── Die Aktualitaets-Marke ─────────────────────────────────────────────────────────────
/**
 * Stand, aus dem eine Linie gerechnet wurde: Fortbewegung, dann jeder Kettenpunkt als
 * typisiertes Token in Reihenfolge (Station mit ID UND Koordinate). Client und Server
 * rechnen ihn aus derselben Kette; der Server gibt dazu die Wegpunkte zurueck, die er
 * wirklich verwendet hat, damit ein verworfener Abschnitt nicht „fuer immer veraltet" heisst.
 */
export function tourRouteHash(input: {
  start: RoutePoint | null;
  end: RoutePoint | null;
  stops: ChainStop[];
  mode: TourMode;
  via: ViaLeg[];
}): string {
  const tokens = flattenChain(input).map((n) =>
    n.kind === "stop" ? `p:${n.key}@${fmt(n.coord)}` : `${n.kind[0]}:${fmt(n.coord)}`,
  );
  return hashTexts([`m:${input.mode}`, ...tokens]);
}

// ── Wo ein Tipp auf die Linie hingehoert ───────────────────────────────────────────────
// Ein Ankerpunkt, der weiter als das von der Linie liegt, gehoert nicht zu ihr (Mapbox
// setzt Punkte auf die naechste Strasse, ein paar Meter, nie sechzig).
const NODE_ON_LINE_M = 60;

// Ankerpunkte und Wegpunkte in Kettenreihenfolge auf die Linie legen, jeder erst ab der
// Stelle des vorigen: Auf einer Runde, die sich selbst kreuzt oder ein Stueck doppelt
// faehrt, waere die global naechste Stelle sonst die falsche.
function projectMonotone(line: LngLat[], coords: LngLat[]): number[] | null {
  const out: number[] = [];
  let prev = 0;
  for (const c of coords) {
    const hit = nearestPointOnRoute(line, c, {
      nearAlongM: prev,
      minAlongM: prev,
      backM: 0,
      fwdM: Infinity,
      plausibleM: NODE_ON_LINE_M,
    });
    if (!hit || hit.crossTrackM > NODE_ON_LINE_M || hit.alongM < prev - 1) return null;
    out.push(hit.alongM);
    prev = hit.alongM;
  }
  return out;
}

/**
 * In welchen Abschnitt ein Tipp auf die Karte gehoert und an welche Stelle zwischen den
 * Wegpunkten, die dort schon liegen. Gemessen auf der gesnappten Linie; ohne Linie, bei
 * veralteter Linie oder wenn ein Punkt nicht zu ihr passt, auf der geraden Kette.
 * `legIndex` zaehlt die Abschnitte zwischen den Ankerpunkten MIT Koordinate.
 */
export function legForTap(input: {
  chain: ChainNode[];
  line: LngLat[] | null;
  tap: LngLat;
  stale?: boolean;
}): { legIndex: number; insertAt: number } | null {
  const placed = input.chain.filter((n): n is ChainNode & { coord: LngLat } => n.coord !== null);
  const anchorCount = placed.filter((n) => n.kind !== "via").length;
  if (anchorCount < 2) return null;

  let ref: LngLat[] | null = null;
  let along: number[] | null = null;
  if (input.line && input.line.length >= 2 && !input.stale) {
    const proj = projectMonotone(input.line, placed.map((n) => n.coord));
    if (proj) {
      ref = input.line;
      along = proj;
    }
  }
  if (!ref || !along) {
    ref = placed.map((n) => n.coord);
    along = routeCumulativeMeters(ref);
  }
  const hit = nearestPointOnRoute(ref, input.tap);
  if (!hit) return null;
  const t = hit.alongM;

  // Abschnitt = letzter Ankerpunkt, der vor dem Tipp liegt; Wegpunkte gehoeren zu dem
  // Abschnitt, dessen Ankerpunkt zuletzt vor ihnen stand.
  let legIndex = -1;
  let k = -1;
  const legOf: number[] = [];
  for (let i = 0; i < placed.length; i++) {
    if (placed[i].kind !== "via") {
      k++;
      if (along[i] <= t + 1e-6) legIndex++;
      legOf.push(-1);
    } else legOf.push(k);
  }
  legIndex = Math.max(0, Math.min(anchorCount - 2, legIndex));
  let insertAt = 0;
  for (let i = 0; i < placed.length; i++) if (legOf[i] === legIndex && along[i] <= t) insertAt++;
  return { legIndex, insertAt };
}

// ── Kleine Helfer fuer das Formular ────────────────────────────────────────────────────
export function insertVia(legs: ViaLeg[], from: NodeKey, to: NodeKey, at: number, coord: LngLat): ViaLeg[] {
  const i = legs.findIndex((l) => l.from === from && l.to === to);
  if (i < 0) return [...legs, { from, to, coords: [coord] }];
  const leg = legs[i];
  const pos = Math.max(0, Math.min(leg.coords.length, at));
  const coords = [...leg.coords.slice(0, pos), coord, ...leg.coords.slice(pos)];
  return legs.map((l, idx) => (idx === i ? { ...l, coords } : l));
}

export function moveVia(legs: ViaLeg[], id: string, coord: LngLat): ViaLeg[] {
  let done = false;
  return legs.map((l) => {
    if (done) return l;
    const j = l.coords.findIndex((c) => viaIdOf(c) === id);
    if (j < 0) return l;
    done = true;
    return { ...l, coords: l.coords.map((c, idx) => (idx === j ? coord : c)) };
  });
}

export function removeVia(legs: ViaLeg[], id: string): ViaLeg[] {
  let done = false;
  return legs
    .map((l) => {
      if (done) return l;
      const j = l.coords.findIndex((c) => viaIdOf(c) === id);
      if (j < 0) return l;
      done = true;
      return { ...l, coords: l.coords.filter((_, idx) => idx !== j) };
    })
    .filter((l) => l.coords.length > 0);
}

// ── Geometrie aus fremder Hand ─────────────────────────────────────────────────────────
// Obergrenze gegen Datenmüll in der Zeile: eine Altstadt-Runde hat ein paar hundert
// Stützpunkte, alles darüber ist kein Fussweg mehr.
const MAX_POINTS = 10000;

/**
 * Geometrie aus fremder Hand (Formular-State) auf das Format [lng,lat][] festnageln.
 * Gibt null zurück, wenn irgendetwas nicht stimmt: lieber keine Linie als eine
 * kaputte, die die Karte quer über den Globus zieht.
 */
export function cleanRouteGeo(value: unknown): [number, number][] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_POINTS) return null;
  const out: [number, number][] = [];
  for (const item of value) {
    const p = validLngLat(item);
    if (!p) return null;
    out.push(p);
  }
  return out;
}
