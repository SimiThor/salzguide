// Höhenprofil einer Wanderung: Typ und Rechnung, OHNE server-only. Das Formular (Client),
// die Detailseite, der Spot-Leser (spots.ts), der Routing-Kern (routing/snap-spot.ts) und die
// Import-Skripte lesen dieselbe Form. Vorher stand der Typ in der "use server"-Datei
// admin-actions.ts und die Rechnung zweimal (dort und in scripts/wp-import/route-math.ts).
import { ascentDescent, haversineMeters } from "./geo";

/** Kompakt für die minimalistische Anzeige (Migration 0006: spots.elevation_profile). */
export type ElevationProfile = {
  points: { d: number; e: number }[]; // d = km (kumuliert), e = m (Höhe)
  ascent: number; // Aufstieg in m
  descent: number; // Abstieg in m
  min: number; // tiefster Punkt in m
  max: number; // höchster Punkt in m
  distanceKm: number;
};

/** So viele Stützpunkte hat ein gespeichertes Profil höchstens. */
export const PROFILE_POINTS = 100;

/** Gleichmässig auf höchstens n Punkte eindampfen, erster und letzter bleiben. */
export function downsample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/**
 * Linie + Höhe je Punkt -> Profil. Auf- und Abstieg über `ascentDescent` (Zacken unter 3 m
 * werden verschluckt), dieselbe Funktion wie in den Import-Skripten, sonst hat dieselbe
 * Route je nach Weg zwei verschiedene Höhenmeter. `distanceKm` darf der Aufrufer vorgeben
 * (Länge laut Routendienst), sonst ist es die Länge der Linie.
 */
export function buildElevationProfile(
  coords: [number, number][],
  elevationM: number[],
  distanceKm?: number,
): ElevationProfile {
  const pts: { d: number; e: number }[] = [];
  let cum = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) cum += haversineMeters(coords[i - 1], coords[i]);
    pts.push({ d: cum / 1000, e: elevationM[i] });
  }
  const { ascent, descent } = ascentDescent(elevationM);
  return {
    points: downsample(pts, PROFILE_POINTS).map((p) => ({ d: Math.round(p.d * 100) / 100, e: Math.round(p.e) })),
    ascent,
    descent,
    min: Math.round(Math.min(...elevationM)),
    max: Math.round(Math.max(...elevationM)),
    distanceKm: distanceKm ?? cum / 1000,
  };
}
