import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logOps } from "./ops";
import { alongForChain, buildTourChain } from "./routing/chain";
import { lineHashOf } from "./routing/normalize";
import { runChain, type RouteOutcome } from "./routing/run";
import type { LngLat, RouteSource, RouteStep } from "./routing/types";
import type { TourDetail } from "./tour-types";

// Die gespeicherte Navigationsroute einer Runde (Tabelle tour_nav_routes, Migration 0076,
// docs/42). Sie gehört uns (BRouter auf OpenStreetMap-Daten, ODbL) und darf deshalb
// gespeichert werden; Mapbox-Ergebnisse dürften es nie. Geschrieben und gelesen wird nur mit
// dem Service-Key (RLS an, keine Richtlinie): Die App bekommt sie ausschliesslich über das
// Paket (GET /tours/{slug}/package) mit der Sicht des Betrachters.
//
// GERECHNET wird beim ersten Abruf und wieder, wenn sich route_hash ändert. route_hash ist
// tourRouteHash der VERÖFFENTLICHTEN Kette (Fortbewegung, Start, Ziel, Stopps mit ID und
// Koordinate, Wegpunkte), also dieselbe Formel wie tours.route_hash, aber nicht zwingend
// derselbe Wert: tours.route_hash stammt aus dem Formular des Admins (auch mit Entwurfs-
// Stopps), dieser hier nur aus dem, was Gäste sehen. Die wöchentlich frischen Wegdaten ändern eine
// gespeicherte Route NICHT still: Wer sie neu will, ändert die Runde.

/** Die Schritte tragen keinen Text, eine Zeile gilt für alle Sprachen (siehe Migration 0076). */
export const NAV_ROUTE_LANG = "und";

export type StoredNavRoute = {
  routeHash: string;
  profile: string;
  source: RouteSource;
  geometry: LngLat[];
  steps: RouteStep[];
  /** Stellen auf der Linie. stopAlongM: je Stopp in detail.stops (gleiche Reihenfolge). */
  viaAlong: { stopAlongM: (number | null)[]; viaAlongM: Record<string, number> };
  lengthM: number;
};

export interface NavRouteStore {
  get(tourId: string, routeHash: string): Promise<StoredNavRoute | null>;
  /** Legt die Route ab und räumt ältere Fassungen derselben Runde weg. */
  put(tourId: string, route: StoredNavRoute): Promise<void>;
}

const TABLE = "tour_nav_routes";

function isLngLatList(v: unknown): v is LngLat[] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  );
}

/** Store über den Service-Client. Vor Migration 0076 (Tabelle fehlt) ist er leer und schreibt nichts. */
export function supabaseNavRouteStore(sb: SupabaseClient): NavRouteStore {
  let warned = false;
  const missing = async (error: { code?: string; message?: string }) => {
    // 42P01 (Postgres) bzw. PGRST205 (PostgREST): Tabelle gibt es noch nicht. Dann rechnet
    // jeder Abruf neu, bis Anton 0076 einspielt; gemeldet wird einmal je Prozess.
    if (error.code === "42P01" || error.code === "PGRST205") {
      if (!warned) {
        warned = true;
        await logOps("server_error", {
          message: "Tabelle tour_nav_routes fehlt: Migration 0076 einspielen",
          group: "nav-routes-missing",
        });
      }
      return true;
    }
    return false;
  };
  return {
    async get(tourId, routeHash) {
      const { data, error } = await sb
        .from(TABLE)
        .select("route_hash, profile, source, geometry, steps, via_along, length_m")
        .eq("tour_id", tourId)
        .eq("lang", NAV_ROUTE_LANG)
        .eq("route_hash", routeHash)
        .maybeSingle();
      if (error) {
        if (await missing(error)) return null;
        throw error;
      }
      if (!data) return null;
      const r = data as Record<string, unknown>;
      const source = r.source as RouteSource | null;
      const via = r.via_along as StoredNavRoute["viaAlong"] | null;
      // Zeilen des Testadapters gelten nie (sie wurden nie geschrieben; das ist der Riegel
      // gegen eine versehentliche Zeile), kaputte Zeilen auch nicht: neu rechnen.
      if (
        !source ||
        source.provider === "local" ||
        !isLngLatList(r.geometry) ||
        !Array.isArray(r.steps) ||
        !via ||
        !Array.isArray(via.stopAlongM)
      )
        return null;
      return {
        routeHash: r.route_hash as string,
        profile: r.profile as string,
        source,
        geometry: r.geometry,
        steps: r.steps as RouteStep[],
        viaAlong: via,
        lengthM: r.length_m as number,
      };
    },
    async put(tourId, route) {
      const { error } = await sb.from(TABLE).upsert(
        {
          tour_id: tourId,
          lang: NAV_ROUTE_LANG,
          route_hash: route.routeHash,
          profile: route.profile,
          source: route.source,
          geometry: route.geometry,
          steps: route.steps,
          via_along: route.viaAlong,
          length_m: route.lengthM,
        },
        { onConflict: "tour_id,lang,route_hash" },
      );
      if (error) {
        if (await missing(error)) return;
        throw error;
      }
      await sb.from(TABLE).delete().eq("tour_id", tourId).eq("lang", NAV_ROUTE_LANG).neq("route_hash", route.routeHash);
    },
  };
}

export type NavRouteResult =
  | { ok: true; stored: StoredNavRoute; fromCache: boolean; lineHash: string }
  | { ok: false; reason: "no-chain" }
  | { ok: false; reason: "routing"; code: Extract<RouteOutcome, { ok: false }>["code"] };

/**
 * Die Route dieser Runde: aus dem Speicher, wenn route_hash passt, sonst vom Routendienst
 * (ab dem TOUR-START: Start, Stopps, Wegpunkte, Ziel; Profil nach tours.mode) und ablegen.
 *
 * `detail` ist die Sicht des Betrachters, aber die Kette hängt nicht von ihm ab: Stopp-
 * Positionen und Linie der Touren sind öffentliche Teaser (Migration 0029), nur das Audio
 * ist gesperrt. Darum darf die Zeile für alle gleich sein.
 */
export async function getTourNavRoute(args: {
  detail: TourDetail;
  tourId: string;
  store: NavRouteStore;
  compute?: typeof runChain;
}): Promise<NavRouteResult> {
  const { detail, tourId, store } = args;
  const compute = args.compute ?? runChain;
  const chain = buildTourChain({
    start: detail.start ?? null,
    end: detail.end ?? null,
    stops: detail.stops.map((s) => ({
      id: s.spotSlug,
      coord: s.lng != null && s.lat != null ? ([s.lng, s.lat] as LngLat) : null,
    })),
    via: detail.routeVia ?? [],
    mode: detail.mode,
  });
  if (chain.points.length < 2) return { ok: false, reason: "no-chain" };

  const cached = await store.get(tourId, chain.routeHash);
  if (cached) return { ok: true, stored: cached, fromCache: true, lineHash: lineHashOf(cached.geometry) };

  const r = await compute({ points: chain.points, mode: detail.mode, purpose: "package" });
  if (!r.ok) return { ok: false, reason: "routing", code: r.code };

  const { route } = r;
  const stored: StoredNavRoute = {
    routeHash: chain.routeHash,
    profile: route.source.profile,
    source: route.source,
    geometry: route.geometry,
    steps: route.steps,
    viaAlong: alongForChain(
      chain.nodes,
      route.waypointAlongM,
      detail.stops.map((s) => s.spotSlug),
    ),
    lengthM: Math.round(route.distanceM),
  };
  // Der Testadapter (gerade Linien) wird nie abgelegt: Lokal läuft derselbe Code gegen die
  // echte Datenbank, und eine erfundene Linie darf dort nie stehen bleiben.
  if (route.source.provider !== "local") {
    // Das Ablegen ist Zugabe: Scheitert es, bekommt der Gast trotzdem seine Route, und der
    // nächste Abruf rechnet neu.
    try {
      await store.put(tourId, stored);
    } catch (error) {
      await logOps("server_error", { error, group: "nav-routes-put", path: "/api/app/v1/tours/package" });
    }
  }
  return { ok: true, stored, fromCache: false, lineHash: route.lineHash };
}
