// Fortbewegungsart einer Runde: walk = bestehende Geh-Tour, bike = S-Bike-Runde mit
// permanenter Abbiege-Navigation. KEINE Datenbank-Spalte (mehr) – reale Touren sind
// heute ausschliesslich "walk" (siehe lib/tours.ts). Die einzige Stelle, die je eine
// Runde als "bike" markiert, ist die fest verdrahtete Testrunde in
// lib/test-sbike-tour.ts. Client-safe (keine Server-Imports).
export type TourMode = "walk" | "bike";

export const TOUR_MODE_EMOJI: Record<TourMode, string> = {
  walk: "🚶",
  bike: "🚲",
};
