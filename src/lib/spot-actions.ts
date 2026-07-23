"use server";

import { createServiceClient } from "./supabase/service";
import { viewerCanSeePro } from "./spots";

// Wanderroute eines veröffentlichten Spots on-demand laden (Explore-Karte).
// Bewusst klein & gezielt: die Startseite lädt NICHT alle Routen vorab, sondern
// nur die eine Route beim Antippen -> sehr performant.
//
// GATING WIE ÜBERALL: Service-Client lesen, am BETRACHTER entscheiden (viewerCanSeePro),
// nicht pauschal an is_pro. Sonst liefen Bounds und Linie auseinander — die Explore-Liste
// (getExploreData) gibt einem berechtigten Pro-/Admin-Betrachter die route_bbox heraus, also
// fliegt die Kamera auf den richtigen Ausschnitt, während die Linie hier stumm ausblieb.
// Für einen nicht berechtigten Betrachter bleibt die Pro-Route weiterhin aus (kein Leak).
export async function getSpotRoute(slug: string): Promise<[number, number][] | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("spots")
    .select("route_geojson, is_pro")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!data) return null;
  if (data.is_pro && !(await viewerCanSeePro())) return null;
  const rg = data.route_geojson as
    | { type?: string; coordinates?: [number, number][] }
    | null;
  return rg && rg.type === "LineString" && Array.isArray(rg.coordinates)
    ? rg.coordinates
    : null;
}
