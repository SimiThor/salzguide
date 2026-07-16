"use server";

import { createClient } from "./supabase/server";

// Wanderroute eines veröffentlichten Spots on-demand laden (Explore-Karte).
// Bewusst klein & gezielt: die Startseite lädt NICHT alle Routen vorab, sondern
// nur die eine Route beim Antippen -> sehr performant. Pro-Routen werden NICHT
// ausgeliefert (kein Leak), solange kein Pro-Zugriff besteht.
export async function getSpotRoute(slug: string): Promise<[number, number][] | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("spots")
    .select("route_geojson, is_pro")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!data || data.is_pro) return null;
  const rg = data.route_geojson as
    | { type?: string; coordinates?: [number, number][] }
    | null;
  return rg && rg.type === "LineString" && Array.isArray(rg.coordinates)
    ? rg.coordinates
    : null;
}
