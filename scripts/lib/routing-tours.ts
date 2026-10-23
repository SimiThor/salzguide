// Gemeinsame Bausteine für scripts/routing-compare.ts und scripts/routing-drive.ts (docs/42):
// veröffentlichte Runden NUR LESEN (Service-Key aus .env.local, nie schreiben) und die
// Kette bauen, aus der das Web seine gespeicherte Linie gerechnet hat.
//
// Die Ausgabe nennt nie Titel, Slugs oder Texte: Runden heissen "Tour 1", "Tour 2", mit
// Fortbewegung und frei/Pro. Das Repo ist öffentlich, und Prüfausgaben landen in PRs.
import { createClient } from "@supabase/supabase-js";
import {
  chainCoords,
  chainKeys,
  cleanRouteGeo,
  cleanRouteVia,
  flattenChain,
  reconcileVia,
  tourRouteHash,
  type ChainNode,
  type ChainStop,
  type LngLat,
  type RoutePoint,
} from "../../src/lib/tour-route.ts";
import { tourModeOf, type TourMode } from "../../src/lib/tour-mode.ts";
import { buildBikeChain, type NavVia } from "../../src/lib/bike-directions.ts";

export type TourForRouting = {
  label: string; // "Tour 1"
  mode: TourMode;
  isPro: boolean;
  chain: ChainNode[];
  points: LngLat[];
  /** Je Kettenpunkt mit Koordinate: Art ("start" | "stop" | "via" | "end"). */
  kinds: ChainNode["kind"][];
  storedGeo: LngLat[] | null;
  /** Ergibt die Kette denselben route_hash wie gespeichert? Dann ist es dieselbe Anfrage. */
  hashMatches: boolean;
  storedDurationMin: number | null;
};

export async function loadPublishedTours(): Promise<TourForRouting[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (--env-file=.env.local).");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("tours")
    .select(
      "id, mode, is_pro, start_lat, start_lng, end_lat, end_lng, route_geo, route_via, route_hash, duration_min, sort_order, " +
        "tour_stops(sort_order, tour_points(id, lat, lng))",
    )
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`Supabase: ${error.message}`);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((t, i) => {
    const pt = (lat: unknown, lng: unknown): RoutePoint | null =>
      typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
    const start = pt(t.start_lat, t.start_lng);
    const end = pt(t.end_lat, t.end_lng);
    const stopRows = ((t.tour_stops as { sort_order: number; tour_points: { id: string; lat: number | null; lng: number | null } | null }[]) ?? [])
      .filter((s) => s.tour_points)
      .sort((a, b) => a.sort_order - b.sort_order);
    const stops: ChainStop[] = stopRows.map((s) => ({
      id: s.tour_points!.id,
      coord: s.tour_points!.lat != null && s.tour_points!.lng != null ? [s.tour_points!.lng, s.tour_points!.lat] : null,
    }));
    const mode = tourModeOf(t.mode);
    // Genau wie snapTourRoute (tour-actions.ts): Wegpunkte an die Kette anpassen, dann flach.
    const via = reconcileVia(cleanRouteVia(t.route_via), chainKeys(start, end, stops.map((s) => s.id))).legs;
    const chain = flattenChain({ start, end, stops, via });
    const placed = chain.filter((n) => n.coord !== null);
    return {
      label: `Tour ${i + 1}`,
      mode,
      isPro: Boolean(t.is_pro),
      chain,
      points: chainCoords(chain),
      kinds: placed.map((n) => n.kind),
      storedGeo: cleanRouteGeo(t.route_geo),
      hashMatches: typeof t.route_hash === "string" && t.route_hash === tourRouteHash({ start, end, stops, mode, via }),
      storedDurationMin: typeof t.duration_min === "number" ? t.duration_min : null,
    };
  });
}

/** "Tour 1 (Rad, Pro)" */
export function tourTitle(t: TourForRouting): string {
  return `${t.label} (${t.mode === "bike" ? "Rad" : "zu Fuss"}, ${t.isPro ? "Pro" : "frei"})`;
}

export function brouterBase(): string {
  return process.env.ROUTING_URL_LOCAL ?? "http://127.0.0.1:17777";
}

/** Die Kette, wie Navigation und Offline-Paket sie bauen: ab Tour-Start (buildBikeChain). */
export function navChain(t: TourForRouting) {
  // Kette wie das Offline-Paket: ab Tour-Start, Stopps, Wegpunkte davor, Ziel.
  const stops: LngLat[] = [];
  const vias: NavVia[] = [];
  let pending: { id: string; coord: LngLat }[] = [];
  let start: LngLat | null = null;
  let end: LngLat | null = null;
  for (const n of t.chain) {
    if (!n.coord) continue;
    if (n.kind === "start") start = n.coord;
    else if (n.kind === "end") {
      vias.push(...pending.map((v) => ({ ...v, before: "end" as const })));
      pending = [];
      end = n.coord;
    } else if (n.kind === "via") pending.push({ id: n.viaId!, coord: n.coord });
    else {
      vias.push(...pending.map((v) => ({ ...v, before: stops.length })));
      pending = [];
      stops.push(n.coord);
    }
  }
  const from = start ?? stops[0];
  return { from, stops, end, vias, chain: buildBikeChain(from, stops, end, vias) };
}
