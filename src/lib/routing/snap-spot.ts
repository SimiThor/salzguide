import "server-only";

import { buildElevationProfile, type ElevationProfile } from "../elevation";
import { haversineMeters, hikingTimeMinutes } from "../geo";
import { runRoute } from "./run";
import { adminRoutingError } from "./snap-tour";
import { MAX_ROUTE_POINTS, type LngLat, type RouteSource, type RoutingErrorCode } from "./types";

// Kern von snapRoute (admin-actions.ts, "use server"): die Wanderlinie eines Spots an echte
// Wege legen. Bis 23.10.2026 fragte die Action openrouteservice (foot-hiking); seit docs/42
// geht sie über denselben Routendienst wie die Runden (BRouter, Profil `hiking-mountain`,
// Abschnitt 3), damit es EIN Routing gibt. Der Kern liegt in einem server-only-Modul, weil
// jeder Export einer "use server"-Datei ein öffentlicher Endpunkt wäre.
//
// Was hier anders ist als bei den Runden: Die Kontrollpunkte sind viele (bis 20 im
// Formular, "Hin & zurück" verdoppelt sie), und sie sind KEINE Halte, nur die Spur, der
// die Linie folgen soll. Der Dienst nimmt je Anfrage höchstens MAX_ROUTE_POINTS (25, eine
// Zahl für alle); längere Spuren werden in Stücke geschnitten, die sich um einen Punkt
// überlappen, und die Stücke hintereinandergehängt. Die Höhe je Punkt bringt der Dienst mit
// (NormalizedRoute.elevationM); daraus entsteht das Profil wie bisher aus den ORS-Höhen.

/** Mehr Kontrollpunkte als das sind keine Spur mehr, sondern eine eingefügte Linie. */
export const MAX_SPOT_WAYPOINTS = 200;

export type SpotLine = {
  geometry: LngLat[];
  /** Höhe je Punkt der Linie, null wenn der Dienst keine liefert. */
  elevationM: number[] | null;
  distanceM: number;
  warnings: string[];
  provider: RouteSource["provider"];
  attribution: string;
  /** Anfragen an den Dienst (1, ausser die Spur war länger als MAX_ROUTE_POINTS). */
  requests: number;
};

export type SpotLineResult =
  | { ok: true; line: SpotLine }
  | { ok: false; code: RoutingErrorCode; message?: string };

/** Stücke zu je `size` Punkten, Überlappung ein Punkt: [0..24], [24..48], ... */
export function chunkWaypoints(points: LngLat[], size = MAX_ROUTE_POINTS): LngLat[][] {
  const out: LngLat[][] = [];
  for (let start = 0; start < points.length - 1; start += size - 1) out.push(points.slice(start, start + size));
  return out;
}

function labelOf(i: number, n: number): string {
  return i === 0 ? "Start" : i === n - 1 ? "Ziel" : `Punkt ${i + 1}`;
}

export async function routeSpotLine(waypoints: LngLat[], compute: typeof runRoute = runRoute): Promise<SpotLineResult> {
  if (!Array.isArray(waypoints) || waypoints.length < 2)
    return { ok: false, code: "invalid", message: "Mindestens 2 Punkte nötig" };
  if (waypoints.length > MAX_SPOT_WAYPOINTS)
    return { ok: false, code: "invalid", message: `Höchstens ${MAX_SPOT_WAYPOINTS} Kontrollpunkte.` };
  for (const p of waypoints) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
      return { ok: false, code: "invalid", message: "Ungültige Koordinate." };
  }

  const geometry: LngLat[] = [];
  const elevation: number[] = [];
  let hasElevation = true;
  let distanceM = 0;
  const warnings: string[] = [];
  let provider: RouteSource["provider"] = "brouter";
  let attribution = "";
  let offset = 0;
  const chunks = chunkWaypoints(waypoints);
  for (const chunk of chunks) {
    const labels = chunk.map((_, k) => labelOf(offset + k, waypoints.length));
    const r = await compute({ points: chunk, mode: "walk", labels, purpose: "spot" });
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    const { route } = r;
    // Nahtstelle: Das Ende des einen Stücks ist der Anfang des nächsten (derselbe Punkt,
    // vom Dienst auf denselben Weg gelegt). Nicht doppelt aufnehmen.
    let from = 0;
    const last = geometry[geometry.length - 1];
    if (last && route.geometry.length && haversineMeters(last, route.geometry[0]) < 0.5) from = 1;
    for (let i = from; i < route.geometry.length; i++) {
      geometry.push(route.geometry[i]);
      if (route.elevationM) elevation.push(route.elevationM[i]);
      else hasElevation = false;
    }
    distanceM += route.distanceM;
    warnings.push(...route.warnings);
    provider = route.source.provider;
    attribution = route.source.attribution;
    offset += chunk.length - 1;
  }
  if (geometry.length < 2) return { ok: false, code: "no-route" };
  return {
    ok: true,
    line: {
      geometry,
      elevationM: hasElevation ? elevation : null,
      distanceM,
      warnings,
      provider,
      attribution,
      requests: chunks.length,
    },
  };
}

/** Rückgabe von snapRoute (admin-actions.ts): Form wie bisher, plus Hinweise und OSM-Zeile. */
export type SpotSnapResult = {
  ok: boolean;
  coords?: [number, number][];
  distanceKm?: number;
  durationMin?: number;
  profile?: ElevationProfile | null;
  /** Hinweise für den Admin ("Punkt 3 liegt 80 m neben der berechneten Linie."). */
  warnings?: string[];
  /** Pflichthinweis für die Vorschau (ODbL): "© OpenStreetMap-Mitwirkende". */
  attribution?: string;
  error?: string;
};

export async function snapSpotRouteCore(
  waypoints: [number, number][],
  compute: typeof runRoute = runRoute,
): Promise<SpotSnapResult> {
  const r = await routeSpotLine(waypoints, compute);
  if (!r.ok) return { ok: false, error: adminRoutingError(r.code, r.message) };
  // Der Testadapter zieht gerade Linien. Aus dem Formular darf er nie in spots.route_geojson
  // landen (lokal läuft derselbe Code gegen die echte Datenbank), ausser jemand erlaubt es
  // ausdrücklich. In Produktion nie. Dieselbe Regel wie snapTourRouteCore.
  const prod = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (r.line.provider === "local" && (prod || process.env.ROUTING_ALLOW_TEST_ADAPTER !== "1"))
    return { ok: false, error: "Routendienst nicht eingerichtet: ROUTING_URL setzen bzw. lokal BRouter starten." };

  const { line } = r;
  const distanceKm = Math.round(line.distanceM) / 1000;
  const profile = line.elevationM ? buildElevationProfile(line.geometry, line.elevationM, distanceKm) : null;
  // Gehzeit SELBST rechnen (SAC, hikingTimeMinutes) statt der Zeit des Dienstes: ehrlich für
  // einen normalen Wanderer, mit echten Höhenmetern (Auf- UND Abstieg). Ohne Höhen bleibt
  // die Horizontalzeit.
  const durationMin = hikingTimeMinutes(distanceKm, profile?.ascent ?? 0, profile?.descent ?? 0);
  return {
    ok: true,
    coords: line.geometry,
    distanceKm,
    durationMin,
    profile,
    warnings: line.warnings,
    attribution: line.attribution,
  };
}
