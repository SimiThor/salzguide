import "server-only";

import { logOps } from "@/lib/ops";
import { dedupePoints } from "./chain";
import { getRoutingProvider } from "./index";
import { RoutingError, type LngLat, type NormalizedRoute, type RoutingErrorCode } from "./types";
import type { TourMode } from "../tour-mode";

// EINE Stelle, über die jeder Server-Aufruf den Routendienst fragt (Runden-Editor, Offline-
// Paket, Umrouten der App). Sie macht drei Dinge, die sonst jeder Aufrufer anders täte:
//
//   1. Fristen: 20 s für Editor und Paket, 8 s beim Umrouten (docs/42, Abschnitt 6).
//   2. Fehler abbilden: RoutingError -> fester Code, nie ein roher Text nach aussen.
//   3. Melden über logOps (Katalog ops-events.ts). KEINE KOORDINATEN: gemeldet werden nur
//      Zweck, Anzahl der Punkte, Dauer und der Fehlercode. Die Meldung ist ein fester Satz je
//      Code, nicht der Text des Dienstes: Der kann Orte oder Dateinamen enthalten.
//
// "Einstellung fehlt" (config_missing) wird NUR gemeldet, wenn eine Funktion den Dienst
// wirklich braucht, nie beim Start oder beim Laden einer Seite.

// editor = Runden-Editor, spot = Spot-Wanderung im Admin, builder = eigene Runde (KI-Builder),
// package = Offline-Paket, reroute = Umrouten in der Navigation.
export type RoutePurpose = "editor" | "spot" | "builder" | "package" | "reroute";

// spot: 25 s je Stück, die Stücke laufen parallel und danach höchstens ein Rückfall-Durchgang
// (routing/snap-spot.ts): zusammen unter der maxDuration 60 der Spot-Seiten. Das Wanderprofil
// braucht auf alpinen Steigen (sac_scale über T3, Strafe 999) für 500 m bis zu 28 s.
const TIMEOUT_MS: Record<RoutePurpose, number> = {
  editor: 20_000,
  spot: 25_000,
  builder: 20_000,
  package: 20_000,
  reroute: 8_000,
};

export type RouteOutcome =
  | { ok: true; route: NormalizedRoute; ms: number }
  // `message` nur bei "invalid": ein fester deutscher Satz aus der Grenzprüfung, ohne
  // Koordinaten, der dem Admin sagen darf, welche Grenze verletzt ist.
  | { ok: false; code: RoutingErrorCode; ms: number; message?: string };

const MESSAGE: Record<RoutingErrorCode, string> = {
  config: "Routendienst nicht eingerichtet",
  auth: "Routendienst lehnt das Token ab",
  timeout: "Routendienst zu langsam",
  unreachable: "Routendienst nicht erreichbar",
  "bad-response": "Routendienst lieferte eine unbrauchbare Antwort",
  "no-route": "Kein Weg zwischen den Punkten",
  invalid: "Ungültige Routenanfrage",
};

export async function runRoute(input: {
  points: LngLat[];
  mode: TourMode;
  labels?: string[];
  purpose: RoutePurpose;
  /** Profil statt des Profils nach mode; nur der Rückfall der Spot-Spur setzt es. */
  profile?: string;
  signal?: AbortSignal;
}): Promise<RouteOutcome> {
  const t0 = Date.now();
  try {
    const provider = getRoutingProvider({ timeoutMs: TIMEOUT_MS[input.purpose] });
    const route = await provider.route({ points: input.points, mode: input.mode, labels: input.labels, profile: input.profile, signal: input.signal });
    return { ok: true, route, ms: Date.now() - t0 };
  } catch (err) {
    // Abbruch durch den Aufrufer ist kein Ausfall des Dienstes.
    if (!(err instanceof RoutingError)) throw err;
    const ms = Date.now() - t0;
    if (err.code === "config") {
      await logOps("config_missing", {
        message: "ROUTING_URL fehlt oder ist ungültig (Routendienst, docs/42)",
        group: "routing",
        detail: { variable: "ROUTING_URL", purpose: input.purpose },
      });
    } else if (err.code === "no-route") {
      // Eine Eingabe, kein Ausfall, aber ein ploetzlicher Anstieg (Wegdaten weg, Profil kaputt,
      // jede Anfrage "kein Weg") soll sichtbar sein. Nur Zahlen, keine Koordinaten.
      await logOps("routing_no_route", {
        message: MESSAGE["no-route"],
        group: input.purpose,
        detail: { purpose: input.purpose, points: input.points.length, ms },
      });
    } else if (err.code !== "invalid") {
      // invalid ist eine Eingabe (zu viele Punkte), kein Ausfall. Den Text des Dienstes nie weiterreichen (Orte, Dateinamen).
      await logOps("routing_failed", {
        message: MESSAGE[err.code],
        group: err.code,
        detail: { code: err.code, purpose: input.purpose, points: input.points.length, ms },
      });
    }
    return { ok: false, code: err.code, ms, ...(err.code === "invalid" ? { message: err.message } : {}) };
  }
}

/**
 * Wie runRoute, aber für eine Kette mit möglichen Doppelpunkten (Start = erster Stopp):
 * Doppelte gehen nicht an den Dienst, und `waypointAlongM` der Antwort kommt zurück auf
 * die Reihenfolge der EINGABE, ein Eintrag je Eingabepunkt.
 */
export async function runChain(input: {
  points: LngLat[];
  mode: TourMode;
  /** Name je Eingabepunkt (Hinweise an den Admin). */
  labels?: string[];
  purpose: RoutePurpose;
  signal?: AbortSignal;
}): Promise<RouteOutcome> {
  const { points, indexOf } = dedupePoints(input.points);
  const labels = input.labels
    ? points.map((_, j) => input.labels![indexOf.indexOf(j)] ?? `Punkt ${j + 1}`)
    : undefined;
  const r = await runRoute({ ...input, points, labels });
  if (!r.ok) return r;
  return {
    ...r,
    route: { ...r.route, waypointAlongM: indexOf.map((j) => r.route.waypointAlongM[j] ?? 0) },
  };
}
