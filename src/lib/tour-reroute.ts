import "server-only";

import type { AppReroute } from "./app-api-types";
import { buildBikeChain, navViasForStops, selectNavVias, type BikeChainKind } from "./bike-directions";
import { haversineMeters, nearestPointOnRoute } from "./geo";
import { travelMinutes } from "./routing/chain";
import { runChain } from "./routing/run";
import { MAX_ROUTE_POINTS, type LngLat, type RoutingErrorCode } from "./routing/types";
import type { TourDetail } from "./tour-types";

/**
 * Was die Kette einer Runde braucht, und nicht mehr: ohne Titel, Audio und signierte Links.
 * TourDetail passt hinein (App, Paket), das Web laedt nur dies (lib/tour-chain.ts).
 */
export type ChainTour = Pick<TourDetail, "mode" | "start" | "end" | "routeGeo" | "routeVia"> & {
  stops: { spotSlug: string; lat: number | null; lng: number | null }[];
};

// Umrouten für die App (POST /api/app/v1/route, docs/42 Abschnitt 7). Der Server baut die
// Kette selbst, so wie die Navigation im Web es tut (useBikeNavigation.loadRoute): ab der
// Position des Gastes, über die noch offenen Stopps (mit den stillen Wegpunkten davor,
// selectNavVias), bis zum Ziel. Daraus folgt:
//
//   - KEIN freier Routendienst: Die App schickt nur Position und Slug, nie Wegpunkte.
//   - KEIN Leck: Die Koordinaten stammen ausschliesslich aus dem Tour-Detail DIESES
//     Betrachters (getTourDetailFor). Bei Touren sind Stopp-Positionen und Linie öffentliche
//     Teaser (Migration 0029, nur das Audio ist Pro-Ware), ein Gast bekommt also nie eine
//     Stelle, die ihm /tours/{slug} nicht auch zeigt.
//   - NICHTS wird gespeichert und keine Koordinate geloggt (run.ts meldet nur Zahlen).

/** Weiter als das von der Linie der Runde entfernt ist kein Umrouten, sondern Missbrauch oder ein Fehler. */
export const REROUTE_MAX_FROM_LINE_M = 5_000;

export type RerouteInput = {
  from: LngLat;
  keep?: number[];
  alongM?: number;
  viaAlongM?: Record<string, number>;
  /**
   * `keep` zählt die Halte MIT Koordinate (so zählt der Fahrbildschirm im Web), nicht die
   * Einträge von tour.stops (so zählt die App). Ohne Koordinate fällt ein Halt in der Navigation
   * ohnehin weg, beide Zählungen sind gleich, solange alle Stopps einen Punkt haben.
   */
  keepIsGeo?: boolean;
  /** Weiter als das von der Linie der Runde entfernt gilt die Position als fremd (Standard 5 km). */
  maxFromLineM?: number;
};

export type ReroutePlan = {
  points: LngLat[];
  kinds: BikeChainKind[];
  /** Indizes in detail.stops, in Reihenfolge der Kette. */
  keep: number[];
};

// `too-far`: die Position liegt nicht nahe genug an der Runde; `invalid`: alles andere an der Anfrage.
type Planned = { ok: true; plan: ReroutePlan } | { ok: false; reason: "invalid" | "too-far" };

export function planReroute(detail: ChainTour, input: RerouteInput): Planned {
  // Halte mit Koordinate, mit ihrem Index in detail.stops (so zählt die App).
  const geo = detail.stops
    .map((s, i) => ({ id: s.spotSlug, i, c: s.lng != null && s.lat != null ? ([s.lng, s.lat] as LngLat) : null }))
    .filter((g): g is { id: string; i: number; c: LngLat } => g.c !== null);
  if (!geo.length) return { ok: false, reason: "invalid" };

  let keepOrig = input.keep ?? geo.map((g) => g.i);
  if (input.keepIsGeo && input.keep) {
    const mapped = input.keep.map((p) => (Number.isInteger(p) ? geo[p]?.i : undefined));
    if (mapped.some((i) => i === undefined)) return { ok: false, reason: "invalid" };
    keepOrig = mapped as number[];
  }
  const posOf = new Map(geo.map((g, p) => [g.i, p]));
  if (!keepOrig.length || keepOrig.length > MAX_ROUTE_POINTS) return { ok: false, reason: "invalid" };
  let prev = -1;
  for (const i of keepOrig) {
    if (!Number.isInteger(i) || !posOf.has(i) || i <= prev) return { ok: false, reason: "invalid" };
    prev = i;
  }
  const keepGeo = keepOrig.map((i) => posOf.get(i)!);

  const end: LngLat | null = detail.end ? [detail.end.lng, detail.end.lat] : null;

  // Das Gast-Stück muss zur Runde gehören: nahe der Linie (oder, ohne Linie, an einem Halt).
  const line = detail.routeGeo;
  const offM =
    line && line.length >= 2
      ? (nearestPointOnRoute(line, input.from)?.crossTrackM ?? Infinity)
      : Math.min(...geo.map((g) => haversineMeters(input.from, g.c)));
  if (!(offM <= (input.maxFromLineM ?? REROUTE_MAX_FROM_LINE_M))) return { ok: false, reason: "too-far" };

  const legs = navViasForStops(detail.routeVia ?? [], geo.map((g) => g.id), Boolean(end));
  const vias = selectNavVias({
    legs,
    keep: keepGeo,
    stopCoords: geo.map((g) => g.c),
    end,
    origin: input.from,
    isReroute: input.alongM != null,
    alongM: input.alongM,
    viaAlongM: input.viaAlongM,
  });
  const chain = buildBikeChain(input.from, keepGeo.map((p) => geo[p].c), end, vias);
  if (chain.coords.length > MAX_ROUTE_POINTS) return { ok: false, reason: "invalid" };
  return { ok: true, plan: { points: chain.coords, kinds: chain.kinds, keep: keepOrig } };
}

export type RerouteResult =
  | { ok: true; route: AppReroute["route"]; ms: number }
  | { ok: false; code: RoutingErrorCode };

export async function rerouteTour(
  detail: ChainTour,
  plan: ReroutePlan,
  compute: typeof runChain = runChain,
): Promise<RerouteResult> {
  const r = await compute({ points: plan.points, mode: detail.mode, purpose: "reroute" });
  if (!r.ok) return { ok: false, code: r.code };
  const { route } = r;

  // Stellen der Halte und Wegpunkte auf der neuen Linie: waypointAlongM hat einen Eintrag je
  // Kettenpunkt, plan.kinds sagt, was an jeder Stelle steht.
  const stopAlongM: (number | null)[] = plan.keep.map(() => null);
  const viaAlongM: Record<string, number> = {};
  plan.kinds.forEach((k, i) => {
    const a = route.waypointAlongM[i];
    if (a == null) return;
    const m = Math.round(a * 10) / 10;
    if (k.kind === "stop") stopAlongM[k.pos] = m;
    else if (k.kind === "via") viaAlongM[k.id] = m;
  });
  return {
    ok: true,
    ms: r.ms,
    route: {
      v: 1,
      mode: detail.mode,
      profile: route.source.profile,
      lineHash: route.lineHash,
      geometry: route.geometry,
      steps: route.steps,
      keep: plan.keep,
      stopAlongM,
      viaAlongM,
      distanceM: Math.round(route.distanceM),
      durationMin: travelMinutes(route.distanceM, detail.mode),
      attribution: route.source.attribution,
    },
  };
}
