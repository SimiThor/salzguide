import type { RouteStep } from "./routing/types";

// Welcher Satz aus den Sprachdateien (Tours.maneuver.*) zu einem Schritt gehört. BRouter
// kennt keine Strassennamen, deshalb sagt keine Anweisung einen Namen: nur Richtung,
// Kreisverkehr (mit Ausfahrt) und Ziel. Rein und ohne next-intl, damit Prüfskripte es
// ohne Browser aufrufen können; der Aufrufer übersetzt Schlüssel und Werte.
export type ManeuverKey =
  | "left"
  | "right"
  | "slightLeft"
  | "slightRight"
  | "sharpLeft"
  | "sharpRight"
  | "keepLeft"
  | "keepRight"
  | "straight"
  | "uturn"
  | "roundabout"
  | "arrive";

export const MANEUVER_KEYS: readonly ManeuverKey[] = [
  "left",
  "right",
  "slightLeft",
  "slightRight",
  "sharpLeft",
  "sharpRight",
  "keepLeft",
  "keepRight",
  "straight",
  "uturn",
  "roundabout",
  "arrive",
];

export function maneuverKey(step: Pick<RouteStep, "type" | "modifier" | "exit">): { key: ManeuverKey; values?: { exit: number } } {
  if (step.type === "arrive") return { key: "arrive" };
  if (step.type === "roundabout") return { key: "roundabout", values: { exit: step.exit && step.exit > 0 ? step.exit : 1 } };
  const m = step.modifier;
  // Eine Gabel ("halten") ist keine Abbiegung: links bzw. rechts halten.
  if (step.type === "fork" || step.type === "off ramp") {
    if (m === "slight left" || m === "left" || m === "sharp left") return { key: "keepLeft" };
    if (m === "slight right" || m === "right" || m === "sharp right") return { key: "keepRight" };
  }
  switch (m) {
    case "left":
      return { key: "left" };
    case "right":
      return { key: "right" };
    case "slight left":
      return { key: "slightLeft" };
    case "slight right":
      return { key: "slightRight" };
    case "sharp left":
      return { key: "sharpLeft" };
    case "sharp right":
      return { key: "sharpRight" };
    case "uturn":
      return { key: "uturn" };
    default:
      return { key: "straight" };
  }
}
