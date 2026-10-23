import "server-only";

import { cleanRouteGeo } from "../tour-route";
import { tourDurationMin } from "./chain";
import { orderLoop } from "./order";
import { runChain } from "./run";
import type { LngLat, RoutingErrorCode } from "./types";

// Eigene Runden (KI-Builder, tour-generate.ts): Reihenfolge rechnen WIR (routing/order.ts,
// Luftlinie, exakt), die Linie kommt aus EINER Anfrage an den Routendienst mit dem
// Geh-Profil, ab Start und zurück zum Start (docs/42, Abschnitt 8 Schritt 5). Bis
// 23.10.2026 tat beides Mapbox Optimization, dessen Ergebnis nicht gespeichert werden darf,
// aber in user_tours.route_geo gespeichert wurde.

export type UserLoopRoute = {
  geo: LngLat[];
  distanceM: number;
  /** Angezeigte Dauer: Gehzeit (4,5 km/h) plus 2 Minuten je Stopp (tourDurationMin). */
  durationMin: number;
  warnings: string[];
  attribution: string;
};

export type UserLoopResult = { ok: true; route: UserLoopRoute } | { ok: false; code: RoutingErrorCode };

/** Linie für Stopps in GEGEBENER Reihenfolge (Builder nach orderLoop, Neu-Rechnen gespeicherter Runden). */
export async function routeUserLoop(
  start: LngLat,
  stops: LngLat[],
  compute: typeof runChain = runChain,
): Promise<UserLoopResult> {
  const points: LngLat[] = [start, ...stops, start];
  const labels = points.map((_, i) => (i === 0 ? "Start" : i === points.length - 1 ? "Ziel" : `Stopp ${i}`));
  const r = await compute({ points, mode: "walk", labels, purpose: "builder" });
  if (!r.ok) return { ok: false, code: r.code };
  // Der Testadapter zieht gerade Linien; die dürfen nie als Runde gespeichert werden
  // (dieselbe Regel wie im Runden-Editor). Ohne Linie zeichnet der Client selbst gerade
  // Striche, das Ergebnis sieht gleich aus, aber nichts Erfundenes steht in der Datenbank.
  const prod = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (r.route.source.provider === "local" && (prod || process.env.ROUTING_ALLOW_TEST_ADAPTER !== "1"))
    return { ok: false, code: "config" };
  const geo = cleanRouteGeo(r.route.geometry);
  if (!geo) return { ok: false, code: "no-route" };
  return {
    ok: true,
    route: {
      geo,
      distanceM: Math.round(r.route.distanceM),
      durationMin: tourDurationMin(r.route.distanceM, "walk", stops.length),
      warnings: r.route.warnings,
      attribution: r.route.source.attribution,
    },
  };
}

/** Reihenfolge und Linie für den Builder. `order` sind Indizes in `stops`; `route` null, wenn der Dienst nicht liefert. */
export async function planUserLoop(
  start: LngLat,
  stops: LngLat[],
  compute: typeof runChain = runChain,
): Promise<{ order: number[]; route: UserLoopRoute | null; code?: RoutingErrorCode }> {
  const order = orderLoop(start, stops);
  if (stops.length === 0) return { order, route: null, code: "invalid" };
  const r = await routeUserLoop(start, order.map((i) => stops[i]), compute);
  return r.ok ? { order, route: r.route } : { order, route: null, code: r.code };
}
