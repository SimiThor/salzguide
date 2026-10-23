import "server-only";

import { createClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";
import { chainKeys, cleanRouteGeo, cleanRouteVia, reconcileVia } from "./tour-route";
import type { ChainTour } from "./tour-reroute";

// Schlanke Ladefunktionen NUR fuer das Umrouten im Web (POST /api/tours/[slug]/route): Die
// Kette einer Runde (Start, Ziel, Stopps mit Punkt, Linie, Wegpunkte) ohne Titel, Audio und
// signierte Links. getTourDetail rechnet bei jedem Aufruf Dutzende Links aus, und der
// Fahrbildschirm fragt alle 10 bis 20 Sekunden neu.
//
// Dieselben Regeln wie getTourDetailFor (lib/tours.ts) und getUserTourDetail
// (lib/user-tours.ts): nur veroeffentlichte Punkte in veroeffentlichten Gebieten, bei
// kuratierten Runden nur veroeffentlichte (ein Entwurf nur fuer Admins), bei eigenen Runden
// nur der Eigentuemer (RLS). Stopp-Positionen sind bei Touren oeffentliche Teaser (Migration
// 0029), die Stufe des Betrachters spielt fuer die Kette also keine Rolle.

const coordOf = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : null;

export const MY_TOUR_PREFIX = "meine-";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** "meine-<uuid>" -> die ID, sonst null (auch bei kaputter UUID). */
export function myTourIdOf(slug: string): string | null {
  if (!slug.startsWith(MY_TOUR_PREFIX)) return null;
  const id = slug.slice(MY_TOUR_PREFIX.length);
  return UUID.test(id) ? id : null;
}

type PointRow = { id: string; status: string; lat: number | null; lng: number | null; tour_areas: { status?: string } | null };

export async function loadCuratedChain(slug: string, isAdmin: () => Promise<boolean>): Promise<ChainTour | null> {
  const sb = createServiceClient();
  const cols = "id, mode, start_lat, start_lng, end_lat, end_lng, route_geo, route_via";
  const get = async (published: boolean) => {
    let q = sb.from("tours").select(cols).eq("slug", slug);
    if (published) q = q.eq("status", "published");
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data as Record<string, unknown> | null;
  };
  let t = await get(true);
  if (!t && (await isAdmin())) t = await get(false);
  if (!t) return null;

  const { data: rows, error } = await sb
    .from("tour_stops")
    .select("sort_order, tour_points(id, status, lat, lng, tour_areas(status))")
    .eq("tour_id", t.id as string)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const stops = ((rows as unknown as { tour_points: PointRow | null }[] | null) ?? [])
    .map((r) => r.tour_points)
    .filter((p): p is PointRow => p != null && p.status === "published" && p.tour_areas?.status === "published")
    .map((p) => ({ spotSlug: p.id, lat: p.lat, lng: p.lng }));

  const start = coordOf(t.start_lat, t.start_lng);
  const end = coordOf(t.end_lat, t.end_lng);
  return {
    mode: t.mode === "bike" ? "bike" : "walk",
    start,
    end,
    routeGeo: cleanRouteGeo(t.route_geo),
    // An die VEROEFFENTLICHTE Kette angepasst, wie in getTourDetailFor.
    routeVia: reconcileVia(cleanRouteVia(t.route_via), chainKeys(start, end, stops.map((s) => s.spotSlug))).legs,
    stops,
  };
}

/** Eigene Runde (KI-Builder, immer zu Fuss, Rundweg): nur der Eigentuemer, per Cookie-Sitzung und RLS. */
export async function loadMyChain(id: string): Promise<ChainTour | null> {
  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  if (!user) return null;
  const { data: row } = await authed
    .from("user_tours")
    .select("id, point_ids, route_geo, start_lat, start_lng")
    .eq("id", id)
    .maybeSingle();
  if (!row) return null; // nicht vorhanden ODER nicht Eigentuemer (RLS)
  const r = row as unknown as Record<string, unknown>;
  const ordered = ((r.point_ids as string[] | null) ?? []).filter(Boolean);
  if (!ordered.length) return null;

  const { data: pts } = await createServiceClient()
    .from("tour_points")
    .select("id, status, lat, lng, tour_areas(status)")
    .in("id", ordered);
  const byId = new Map<string, PointRow>();
  for (const p of (pts as unknown as PointRow[] | null) ?? []) {
    if (p.status === "published" && p.tour_areas?.status === "published") byId.set(p.id, p);
  }
  // In der gespeicherten Reihenfolge, wie getUserTourDetail.
  const stops = ordered
    .map((pid) => byId.get(pid))
    .filter((p): p is PointRow => p != null)
    .map((p) => ({ spotSlug: p.id, lat: p.lat, lng: p.lng }));
  const start = coordOf(r.start_lat, r.start_lng);
  return {
    mode: "walk",
    start,
    // Das Ziel IST der Start: Der Builder plant ausschliesslich Rundwege.
    end: start,
    routeGeo: cleanRouteGeo(r.route_geo),
    routeVia: [],
    stops,
  };
}
