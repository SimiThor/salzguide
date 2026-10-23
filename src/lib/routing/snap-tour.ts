import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chainKeys,
  cleanRouteGeo,
  cleanRouteVia,
  MAX_DIRECTIONS_COORDS,
  reconcileVia,
  type ChainStop,
  type RoutePoint,
  type ViaLeg,
} from "../tour-route";
import type { TourMode } from "../tour-mode";
import { buildTourChain, tourDurationMin } from "./chain";
import { runChain } from "./run";
import type { RoutingErrorCode } from "./types";

// Kern von snapTourRoute (tour-actions.ts, "use server"): Die Server-Action prüft nur den
// Admin und reicht hierher durch. Der Kern liegt in einem server-only-Modul, weil jeder
// Export einer "use server"-Datei ein öffentlicher Endpunkt wäre (docs/41, Abschnitt 2).
// Seit docs/42 rechnet er über den eigenen Routendienst (BRouter) statt über Mapbox
// Directions: Mapbox verbietet, die Ergebnisse zu speichern, und tours.route_geo wird
// gespeichert.

export type SnapRouteInput = {
  start: RoutePoint | null;
  end: RoutePoint | null;
  pointIds: string[]; // Stationen in kuratierter Reihenfolge
  // Fortbewegungsart (0064). Sie entscheidet über das Profil UND über die Dauer.
  mode?: TourMode;
  // Wegpunkte ohne Geschichte je Abschnitt (0071), aus dem Formular.
  via?: ViaLeg[];
};

export type SnapRouteResult = {
  ok: boolean;
  routeGeo?: [number, number][];
  routeHash?: string;
  distanceKm?: number;
  durationMin?: number;
  // Die Wegpunkte, die WIRKLICH in die Anfrage gingen (nach reconcileVia). Das Formular
  // uebernimmt sie, damit sein Hash derselbe ist wie der hier gerechnete.
  via?: ViaLeg[];
  // Hinweise für den Admin, etwa "Kehre an Punkt 4: Punkt liegt neben dem Weg". Nie für Gäste.
  warnings?: string[];
  // Pflichthinweis für die Vorschau (ODbL): "© OpenStreetMap-Mitwirkende".
  attribution?: string;
  error?: string;
};

/** Text für den Admin zu einem Fehlercode (docs/42, Abschnitt 6). */
export function adminRoutingError(code: RoutingErrorCode, message?: string): string {
  switch (code) {
    case "config":
      return "Routendienst nicht eingerichtet: ROUTING_URL (und ROUTING_TOKEN) fehlen in Vercel bzw. .env.local.";
    case "auth":
      return "Der Routendienst lehnt das Token ab. Bitte ROUTING_TOKEN prüfen.";
    case "no-route":
      return "Zwischen diesen Punkten gibt es keinen Weg, oder ein Punkt liegt ausserhalb der Wegdaten. Punkte prüfen.";
    case "invalid":
      return message || "Die Punkte sind für die Routenberechnung ungültig.";
    default:
      return "Routendienst gerade nicht erreichbar – bitte nochmal versuchen.";
  }
}

export async function snapTourRouteCore(
  supabase: SupabaseClient,
  input: SnapRouteInput,
): Promise<SnapRouteResult> {
  const pointIds = (input.pointIds ?? []).filter((x) => typeof x === "string" && x);
  if (pointIds.length < 1) return { ok: false, error: "Bitte zuerst Stationen zur Runde hinzufügen." };

  // Koordinaten kommen aus der DB, nicht aus dem Formular: Der Server soll die Runde
  // aus dem laufen, was wirklich gespeichert ist.
  const { data: pts, error: ptsErr } = await supabase.from("tour_points").select("id, lat, lng").in("id", pointIds);
  if (ptsErr) return { ok: false, error: "db" };
  const byId = new Map(
    ((pts ?? []) as { id: string; lat: number | null; lng: number | null }[]).map((p) => [p.id, p]),
  );
  const stops: ChainStop[] = [];
  for (const id of pointIds) {
    const p = byId.get(id);
    if (!p || p.lat == null || p.lng == null)
      return { ok: false, error: "Mindestens eine Station hat noch keinen Punkt auf der Karte." };
    stops.push({ id, coord: [p.lng, p.lat] });
  }

  // Wegpunkte ohne Geschichte (0071): nur an Abschnitten, die es in dieser Kette gibt. Was
  // hier wegfaellt, geht mit der Antwort zurueck, damit das Formular denselben Stand hasht
  // wie der Server. Ohne eigenen Start/Ziel läuft die Runde von der ersten zur letzten
  // Station.
  const via = reconcileVia(cleanRouteVia(input.via), chainKeys(input.start, input.end, pointIds)).legs;
  const mode: TourMode = input.mode === "bike" ? "bike" : "walk";
  const chain = buildTourChain({ start: input.start, end: input.end, stops, via, mode });
  if (chain.points.length < 2) return { ok: false, error: "Für eine Route braucht es mindestens zwei Punkte." };
  if (chain.points.length > MAX_DIRECTIONS_COORDS)
    return {
      ok: false,
      error: `Zu viele Punkte für die Routenberechnung (${chain.points.length}, erlaubt sind ${MAX_DIRECTIONS_COORDS} inkl. Start, Wegpunkten und Ziel).`,
    };

  // EIN Profil je Anfrage (trekking am Rad, hiking-mountain zu Fuss, BROUTER_PROFILE), und
  // alles zwischen Start und Ziel ist ein stiller Wegpunkt: dieselbe Kette, die das
  // Offline-Paket und die Navigation rechnen. Die Vorschau ist damit die Linie, die der
  // Gast fährt.
  let stopNo = 0;
  let viaNo = 0;
  const labels = chain.nodes.map((n) =>
    n.kind === "start" ? "Start" : n.kind === "end" ? "Ziel" : n.kind === "stop" ? `Stopp ${++stopNo}` : `Wegpunkt ${++viaNo}`,
  );
  const r = await runChain({ points: chain.points, mode, labels, purpose: "editor" });
  if (!r.ok) return { ok: false, error: adminRoutingError(r.code, r.message) };
  // Der Testadapter zieht gerade Linien. Aus dem Editor darf er nie in tours.route_geo
  // landen (lokal läuft derselbe Code gegen die echte Datenbank), ausser jemand erlaubt es
  // ausdrücklich. In Produktion nie.
  const prod = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (r.route.source.provider === "local" && (prod || process.env.ROUTING_ALLOW_TEST_ADAPTER !== "1"))
    return { ok: false, error: "Routendienst nicht eingerichtet: ROUTING_URL setzen bzw. lokal BRouter starten." };
  const geo = cleanRouteGeo(r.route.geometry);
  if (!geo) return { ok: false, error: `Der Routendienst hat keine ${mode === "bike" ? "Rad" : "Geh"}-Route geliefert. Punkte prüfen.` };

  return {
    ok: true,
    routeGeo: geo,
    routeHash: chain.routeHash,
    distanceKm: Math.round(r.route.distanceM / 100) / 10,
    durationMin: tourDurationMin(r.route.distanceM, mode, stops.length),
    via,
    warnings: r.route.warnings,
    attribution: r.route.source.attribution,
  };
}
