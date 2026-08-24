// Reine Formatierung für die S-Bike-Navigation. Absichtlich OHNE next-intl: "km"/"m"
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
// gerade in Fahrt ist, sonst eine Stadtrad-Pauschale (~12 km/h) – NIE das statische
// Directions-`duration` der Etappe, das lief seit dem letzten Fetch schon wieder ab.
const FALLBACK_SPEED_MPS = 3.3;

export function estimateEtaMin(remainingM: number, speedMps: number | null): number {
  const v = speedMps != null && speedMps > 1 ? speedMps : FALLBACK_SPEED_MPS;
  return Math.max(1, Math.round(remainingM / v / 60));
}
