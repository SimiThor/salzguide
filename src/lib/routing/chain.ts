// Die Punktfolge einer Runde, wie sie an den Routendienst geht, und die Zeit dazu. Reine
// Funktionen ohne Server-Teil: Editor-Kern, Offline-Paket und Prüfskripte nehmen dieselben.
//
// Zwei Ketten gibt es, und sie sind absichtlich nicht dieselbe:
//   - TOUR-KETTE (Editor, Offline-Paket): ab dem Tour-Start, Stopps, Wegpunkte, Ziel. Genau
//     die Kette, aus der tours.route_hash und tours.route_geo entstehen (flattenChain).
//   - UMROUTE-KETTE (lib/tour-reroute.ts): ab der Position des Gastes, nur offene Stopps.
import { haversineMeters } from "../geo";
import { FALLBACK_SPEED_MPS } from "../nav-format";
import {
  chainCoords,
  flattenChain,
  tourRouteHash,
  type ChainNode,
  type ChainStop,
  type RoutePoint,
  type ViaLeg,
} from "../tour-route";
import type { TourMode } from "../tour-mode";
import type { LngLat } from "./types";

export type TourChain = {
  /** Knoten MIT Koordinate, in Fahrtrichtung. */
  nodes: (ChainNode & { coord: LngLat })[];
  points: LngLat[];
  /** Aktualitäts-Marke, identisch mit tours.route_hash für dieselbe Kette. */
  routeHash: string;
};

export function buildTourChain(input: {
  start: RoutePoint | null;
  end: RoutePoint | null;
  stops: ChainStop[];
  via: ViaLeg[];
  mode: TourMode;
}): TourChain {
  const flat = flattenChain(input);
  const nodes = flat.filter((n): n is ChainNode & { coord: LngLat } => n.coord !== null);
  return { nodes, points: chainCoords(flat), routeHash: tourRouteHash(input) };
}

/**
 * Aufeinanderfolgende gleiche Punkte zusammenfassen (Start = erster Stopp, oder der Gast
 * steht genau auf dem nächsten Halt): Der Dienst soll keine Strecke der Länge null bekommen.
 * `indexOf[i]` sagt, an welcher Stelle der gekürzten Liste der Eingabepunkt i jetzt steht.
 */
export function dedupePoints(points: LngLat[]): { points: LngLat[]; indexOf: number[] } {
  const out: LngLat[] = [];
  const indexOf: number[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || haversineMeters(last, p) > 0.5) out.push(p);
    indexOf.push(out.length - 1);
  }
  return { points: out, indexOf };
}

/** Wo liegen Stopps und Wegpunkte einer Tour-Kette auf der Linie? Eingang: waypointAlongM je Kettenpunkt. */
export function alongForChain(
  nodes: { kind: ChainNode["kind"]; key: string; viaId?: string }[],
  waypointAlongM: number[],
  stopIds: string[],
): { stopAlongM: (number | null)[]; viaAlongM: Record<string, number> } {
  const byStop = new Map<string, number>();
  const viaAlongM: Record<string, number> = {};
  nodes.forEach((n, i) => {
    const a = waypointAlongM[i];
    if (a == null) return;
    if (n.kind === "stop") byStop.set(n.key, Math.round(a * 10) / 10);
    else if (n.kind === "via" && n.viaId) viaAlongM[n.viaId] = Math.round(a * 10) / 10;
  });
  return { stopAlongM: stopIds.map((id) => byStop.get(id) ?? null), viaAlongM };
}

/**
 * Angezeigte Dauer einer Runde in Minuten: Länge durch das Tempo der Navigation
 * (FALLBACK_SPEED_MPS in nav-format.ts, die EINE Tempotabelle: Rad 12, zu Fuss 4,5 km/h) plus
 * ein Zuschlag je Station. Zu Fuss 2 Minuten (Zuhören und Stehenbleiben), am Rad 1 Minute:
 * Die Texte sind rund 55 Sekunden lang, und gehört wird im Fahren. Nicht die Zeit des
 * Routendienstes: BRouter rechnet das Rad mit gut 20 km/h (docs/42, Abschnitt 4).
 */
export const STOP_ALLOWANCE_MIN: Record<TourMode, number> = { bike: 1, walk: 2 };

export function travelMinutes(distanceM: number, mode: TourMode): number {
  return Math.round(distanceM / FALLBACK_SPEED_MPS[mode] / 60);
}

export function tourDurationMin(distanceM: number, mode: TourMode, stopCount: number): number {
  return travelMinutes(distanceM, mode) + stopCount * STOP_ALLOWANCE_MIN[mode];
}
