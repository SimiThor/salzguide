import type { TourMode } from "./tour-mode";

// Nähe zur Abbiegung als Farbe, nicht nur als Zahl: Der Fahrer liest im Augenwinkel,
// ob gleich etwas passiert, ohne die Ziffern zu entziffern (OsmAnd-Muster). Drei Stufen,
// je Fortbewegung in Metern, aber dieselben SEKUNDEN: "jetzt" sind rund 6 s, "gleich"
// rund 25 s. Am Rad (5 m/s) sind das 30 und 120 m (docs/40), zu Fuss (1,4 m/s) 10 und
// 40 m. Mit den Rad-Zahlen stuende zu Fuss jede Abbiegung anderthalb Minuten lang rot.
//
// Eigenes Modul (ohne React und next-intl), damit ManeuverBanner.tsx und das
// Fixture-Skript (scripts/nav-fixtures.ts) dieselben Zahlen lesen.
export const URGENCY_M: Record<TourMode, { now: number; near: number }> = {
  bike: { now: 30, near: 120 },
  walk: { now: 10, near: 40 },
};

export function urgency(distanceM: number | null, mode: TourMode): "far" | "near" | "now" {
  if (distanceM == null) return "far";
  if (distanceM <= URGENCY_M[mode].now) return "now";
  if (distanceM <= URGENCY_M[mode].near) return "near"; // die Stufe, auf die man reagiert
  return "far";
}
