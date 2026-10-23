// Gemeinsame Bausteine für scripts/spot-routes-compare.ts und scripts/spot-routes-rewrite.ts
// (docs/42, Abschnitt 16): Kontrollpunkte aus einer gespeicherten Spot-Linie ableiten.
//
// WARUM NICHT route_waypoints: Die gespeicherten Kontrollpunkte stammen aus dem WP-Import
// (`waypointsFor`), der die FERTIGE Linie auf 4 bis 20 Punkte eindampfte, bei Hin-und-zurück-
// Wegen ohne Rücksicht auf den Wendepunkt. Aus ihnen wird mit jedem Dienst oft nur ein
// Stummel (freisaalweg: 1,04 km gespeichert, 0,41 km aus den Punkten). Die Linie selbst ist
// die Wahrheit, die Anton freigegeben hat: Bei hin&zurück nur der Hinweg (classifyRoute),
// alle KP_SPACING_M ein Punkt, dann verdoppelt; sonst die ganze Linie.
import { classifyRoute, routeCumulativeMeters } from "../../src/lib/geo.ts";
import { downsample } from "../../src/lib/elevation.ts";
import type { LngLat } from "../../src/lib/routing/types.ts";

/** Abstand der abgeleiteten Kontrollpunkte auf der gespeicherten Linie. Gemessen 23.10.2026: bei 250 m verlieren kurze Rundwege ihre Form, bei 150 m liegen 48 von 48 Linien unter 80 m Hausdorff. */
export const KP_SPACING_M = 150;
export const KP_MIN = 6;
export const KP_MAX = 40;

export type SpotShape = "hin&zurück" | "Rundweg" | "Strecke";

export function deriveWaypoints(line: LngLat[]): { points: LngLat[]; shape: SpotShape } {
  const c = classifyRoute(line);
  const shape: SpotShape = c.shape === "out-and-back" ? "hin&zurück" : c.closed ? "Rundweg" : "Strecke";
  const base = c.shape === "out-and-back" ? line.slice(0, c.turnaroundIndex + 1) : line;
  const lenM = routeCumulativeMeters(base).at(-1) ?? 0;
  const k = Math.max(KP_MIN, Math.min(KP_MAX, Math.round(lenM / KP_SPACING_M)));
  const pts = downsample(base, k);
  return { points: c.shape === "out-and-back" ? [...pts, ...pts.slice(0, -1).reverse()] : pts, shape };
}

/** Die Linie eines Spots, wie sie in spots.route_geojson liegt, oder null. */
export function lineOf(routeGeojson: unknown): LngLat[] | null {
  const rg = routeGeojson as { type?: string; coordinates?: unknown } | null;
  if (rg?.type !== "LineString" || !Array.isArray(rg.coordinates) || rg.coordinates.length < 2) return null;
  const ok = rg.coordinates.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  return ok ? (rg.coordinates as LngLat[]).map((p) => [p[0], p[1]]) : null;
}
