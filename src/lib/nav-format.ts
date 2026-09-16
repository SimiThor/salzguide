import type { TourMode } from "./tour-mode";

// Reine Formatierung für die Navigation (Rad und zu Fuss). Absichtlich OHNE next-intl: "km"/"m"
// sind in allen 13 Sprachen dieselbe Abkürzung (dasselbe Muster wie `${distanceKm} km`
// auf der Tourenliste, src/app/[locale]/touren/page.tsx) – nur echte Wörter (Minuten)
// laufen über die bestehenden Tours.*-Keys, nicht hier.
export function formatNavDistanceM(m: number): string {
  if (!Number.isFinite(m)) return "";
  const clamped = Math.max(0, m);
  if (clamped < 1000) {
    // Unter 50m auf 5m genau (fühlbar näher dran, wenn's auf die Abbiegung zugeht),
    // sonst auf 10m – beides grob genug, um nicht wie eine Vermessung zu wirken.
    const step = clamped < 50 ? 5 : 10;
    return `${Math.round(clamped / step) * step} m`;
  }
  return `${(clamped / 1000).toFixed(1)} km`;
}

// Rotation des Abbiege-Pfeils in ManeuverBanner.tsx, aus Mapbox' `modifier`-String.
// 0° = geradeaus (Pfeil zeigt nach oben).
const MODIFIER_DEG: Record<string, number> = {
  "sharp left": -135,
  left: -90,
  "slight left": -45,
  straight: 0,
  "slight right": 45,
  right: 90,
  "sharp right": 135,
  uturn: 180,
};

export function maneuverArrowDeg(modifier: string | undefined): number {
  return modifier ? (MODIFIER_DEG[modifier] ?? 0) : 0;
}

// Grobe Ankunftsschätzung fürs HUD: die echte GPS-Geschwindigkeit, wenn der Nutzer
// gerade in Fahrt ist, sonst eine Pauschale je Fortbewegung – NIE das statische
// Directions-`duration` der Etappe, das lief seit dem letzten Fetch schon wieder ab.
// Stadtrad rund 12 km/h; zu Fuss 4,5 km/h, also etwas unter dem Auslegungstempo von
// 5 km/h (bike-nav-core, WALK_NAV), weil man an einer Runde stehen bleibt und schaut.
const FALLBACK_SPEED_MPS: Record<TourMode, number> = { bike: 3.3, walk: 1.25 };
// Erst ab hier zaehlt die gemessene Geschwindigkeit. Am Rad 1 m/s (unter dem ist es die
// Ampel); zu Fuss 0,5 m/s, denn 1 m/s ist schon fast normales Gehtempo, und mit der
// Rad-Schwelle fiele der Fussgaenger fast immer auf die Pauschale zurueck.
const TRUST_SPEED_MPS: Record<TourMode, number> = { bike: 1, walk: 0.5 };

export function estimateEtaMin(
  remainingM: number,
  speedMps: number | null,
  mode: TourMode = "bike",
): number {
  const v = speedMps != null && speedMps > TRUST_SPEED_MPS[mode] ? speedMps : FALLBACK_SPEED_MPS[mode];
  return Math.max(1, Math.round(remainingM / v / 60));
}
