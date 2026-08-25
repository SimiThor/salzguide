// Fortbewegungsart einer Runde: walk = bestehende Geh-Tour, bike = S-Bike-Runde mit
// permanenter Abbiege-Navigation. Seit Migration 0064 eine echte Spalte auf `tours`
// (Enum tour_mode, Default 'walk'); davor stand hier hart "walk" und "bike" kam
// ausschliesslich aus der Testrunde in lib/test-sbike-tour.ts.
// Client-safe (keine Server-Imports).
export type TourMode = "walk" | "bike";

export const TOUR_MODE_EMOJI: Record<TourMode, string> = {
  walk: "🚶",
  bike: "🚲",
};

// Den Wert aus der Datenbank absichern. Er kann aus drei Gründen kein TourMode sein:
// die Fallback-Abfrage hat die Spalte weggelassen (Migration 0064 noch nicht gelaufen),
// die Zeile ist älter als die Spalte, oder jemand hat am Enum vorbei geschrieben.
// In allen drei Fällen ist "walk" die richtige Antwort: Eine Runde versehentlich als
// Rad-Runde auszuliefern hiesse, den Fahrbildschirm über eine Geh-Tour zu legen.
export function tourModeOf(v: unknown): TourMode {
  return v === "bike" ? "bike" : "walk";
}
