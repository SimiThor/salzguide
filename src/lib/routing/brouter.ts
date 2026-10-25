import "server-only";

import { haversineMeters, routeCumulativeMeters } from "../geo";
import type { TourMode } from "../tour-mode";
import { finishRoute, MAX_GEOMETRY_POINTS, type RawManeuver } from "./normalize";
import {
  MAX_HOP_M,
  MAX_ROUTE_POINTS,
  MIN_ROUTE_POINTS,
  OSM_ATTRIBUTION,
  RoutingError,
  type LngLat,
  type ManeuverModifier,
  type NormalizedRoute,
  type RouteRequest,
  type RoutingProvider,
} from "./types";

// Routing über unseren eigenen BRouter (MIT) auf dem Geo-Server, den SalzGuide mit
// Kraxelbande teilt (docs/42). Die Adresse kommt nur aus ROUTING_URL, der Zugang nur über
// ROUTING_TOKEN (Bearer, je Projekt eigenes Token im Caddy davor). Nie aus dem Browser
// und nie aus der App: Beide fragen unseren Server.
//
// Die öffentliche Instanz brouter.de ist KEIN Ziel: keine Nutzungsbedingungen, und sie
// protokolliert die angefragten Koordinaten.

/** Profil je Fortbewegung (Begründung und Messung: docs/42, Abschnitt 3). */
export const BROUTER_PROFILE: Record<TourMode, string> = {
  bike: "trekking",
  walk: "hiking-mountain",
};

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8_000_000;

// Befehle der BRouter-Abbiegehinweise (btools.router.VoiceHint, gegengelesen in 1.7.10).
const C = 1;
const TL = 2;
const TSLL = 3;
const TSHL = 4;
const TR = 5;
const TSLR = 6;
const TSHR = 7;
const KL = 8;
const KR = 9;
const TLU = 10;
const TRU = 11;
const OFFR = 12;
const RNDB = 13;
const RNLB = 14;
const TU = 15;
const BL = 16;
const EL = 17;
const ER = 18;
const END = 100;

/** Unter diesem Winkel ist ein "leicht" bei BRouter eine Gabel (halten), keine Abbiegung. */
const FORK_MAX_DEG = 35;
/**
 * "Halten" bei fast geradem Weg ist kein Hinweis: BRouter meldet KL/KR auch mit 0 bis 2
 * Grad, wenn nur seitlich ein Weg abgeht. Gemessen an der Radrunde (23.10.2026): 6 von 16
 * Gabeln unter 15 Grad, Mapbox sagt dort nichts.
 */
const KEEP_STRAIGHT_DEG = 10;
/**
 * Zwei Hinweise so dicht hintereinander sind EINE Stelle: versetzte Kreuzung, Querung über
 * den Zebrastreifen (rechts 87, drei Meter später links 86). Zusammengezählt wird der
 * Winkel; bleibt fast nichts übrig, ist es geradeaus. Kraxelbande fasst unter 12 m zusammen.
 */
const MERGE_M = 15;

function modifierFromAngle(angle: number): ManeuverModifier {
  const a = Math.abs(angle);
  const side = angle < 0 ? "left" : "right";
  if (a < 20) return "straight";
  if (a < 60) return `slight ${side}`;
  if (a < 135) return side;
  if (a < 170) return `sharp ${side}`;
  return "uturn";
}

/**
 * Ein BRouter-Hinweis `[index, befehl, ausfahrt, abstand, winkel]` -> unser Manöver.
 * null = verwerfen (Ende, Off-Route-Marker, Luftlinie). Der Winkel ist bei BRouter
 * negativ für links.
 */
export function maneuverFromHint(cmd: number, angle: number, exit: number): Omit<RawManeuver, "index"> | null {
  switch (cmd) {
    case C:
      return { type: "continue", modifier: "straight", angleDeg: angle };
    case TL:
      return { type: "turn", modifier: "left", angleDeg: angle };
    case TR:
      return { type: "turn", modifier: "right", angleDeg: angle };
    case TSHL:
      return { type: "turn", modifier: "sharp left", angleDeg: angle };
    case TSHR:
      return { type: "turn", modifier: "sharp right", angleDeg: angle };
    case TSLL:
    case TSLR: {
      // BRouter vergibt "leicht" schon ab rund 11 Grad, und zwar nur an echten Gabeln
      // (Kraxelbande, docs/14 M.5). Als "turn" fiele es unter 35 Grad in isMereCurve weg;
      // als "fork" bleibt es und heisst "halten".
      const modifier: ManeuverModifier = cmd === TSLL ? "slight left" : "slight right";
      return { type: Math.abs(angle) < FORK_MAX_DEG ? "fork" : "turn", modifier, angleDeg: angle };
    }
    case KL:
    case KR:
      if (Math.abs(angle) < KEEP_STRAIGHT_DEG) return { type: "continue", modifier: "straight", angleDeg: angle };
      return { type: "fork", modifier: cmd === KL ? "slight left" : "slight right", angleDeg: angle };
    case TLU:
    case TRU:
    case TU:
      // Kehre: am Ende eines Stichwegs echt (Nonnberggasse), sonst ein Wegpunkt neben dem
      // Weg. Angesagt wird sie wie bisher (IMMER_ANSAGEN in nav-steps.ts).
      return { type: "continue", modifier: "uturn", angleDeg: angle || 180 };
    case RNDB:
    case RNLB:
      return { type: "roundabout", modifier: modifierFromAngle(angle), angleDeg: angle, exit: exit || undefined };
    case EL:
    case ER:
      // Die Seite kommt aus dem Befehl, nicht aus dem Vorzeichen des Winkels.
      return { type: "off ramp", modifier: cmd === EL ? "slight left" : "slight right", angleDeg: angle };
    case OFFR:
    case BL:
    case END:
    default:
      return null;
  }
}

/** Dichte Hinweise zu einer Stelle zusammenfassen (MERGE_M). Kehren und Kreisverkehre bleiben einzeln. */
export function mergeClose(maneuvers: RawManeuver[], alongM: number[]): RawManeuver[] {
  const sorted = [...maneuvers].sort((a, b) => a.index - b.index);
  const out: RawManeuver[] = [];
  const single = (m: RawManeuver) => m.modifier === "uturn" || m.type === "roundabout";
  let group: RawManeuver[] = [];
  const flush = () => {
    if (!group.length) return;
    if (group.length === 1) out.push(group[0]);
    else {
      const sum = group.reduce((acc, m) => acc + m.angleDeg, 0);
      const straight = Math.abs(sum) < FORK_MAX_DEG;
      out.push({
        index: group[0].index,
        type: straight ? "continue" : "turn",
        // Zwei Abbiegungen in dieselbe Richtung ergeben nie ein "Wenden": Das ist eine Kehre
        // auf DEMSELBEN Weg, hier aber geht es auf einen anderen (Rampe, Parallelweg).
        modifier: straight ? "straight" : Math.abs(sum) >= 170 ? (sum < 0 ? "sharp left" : "sharp right") : modifierFromAngle(sum),
        angleDeg: Math.max(-179, Math.min(179, sum)),
      });
    }
    group = [];
  };
  for (const m of sorted) {
    if (single(m)) {
      flush();
      out.push(m);
      continue;
    }
    // "geradeaus"-Hinweise (C) verlängern keine Gruppe, sie fallen später ohnehin weg.
    if (m.type === "continue" && m.modifier === "straight") {
      if (!group.length) out.push(m);
      continue;
    }
    if (group.length && alongM[m.index] - alongM[group[0].index] > MERGE_M) flush();
    group.push(m);
  }
  flush();
  return out;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Eine BRouter-GeoJSON-Antwort -> NormalizedRoute. Rein (kein Netz), damit Prüfskripte und
 * Tests sie mit gespeicherten Antworten füttern können. Das Rohformat verlässt diese
 * Funktion nicht.
 */
export function parseBrouterGeojson(payload: unknown, points: LngLat[], profile: string, labels?: string[]): NormalizedRoute {
  const feature = (payload as { features?: { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }[] })
    ?.features?.[0];
  const rawCoords = feature?.geometry?.coordinates;
  if (!Array.isArray(rawCoords) || rawCoords.length < 2)
    throw new RoutingError("no-route", "Zwischen diesen Punkten wurde kein Weg gefunden.");
  if (rawCoords.length > MAX_GEOMETRY_POINTS)
    throw new RoutingError("bad-response", "Die Linie hat mehr Punkte als erlaubt.");

  const rawGeometry: LngLat[] = [];
  // Dritte Koordinate = Höhe in Metern (BRouter schreibt sie aus den SRTM-Daten der rd5-
  // Dateien). Sie wird nur weitergereicht, nie gespeichert; das Höhenprofil der Spots
  // entsteht daraus in routing/snap-spot.ts.
  const rawElevationM: (number | null)[] = [];
  for (const c of rawCoords) {
    const lng = Array.isArray(c) ? num(c[0]) : null;
    const lat = Array.isArray(c) ? num(c[1]) : null;
    if (lng == null || lat == null || lng < -180 || lng > 180 || lat < -90 || lat > 90)
      throw new RoutingError("bad-response", "Die Antwort enthielt eine unbrauchbare Koordinate.");
    rawGeometry.push([lng, lat]);
    rawElevationM.push(Array.isArray(c) && c.length >= 3 ? num(c[2]) : null);
  }

  const props = feature?.properties ?? {};
  const warnings: string[] = [];
  const maneuvers: RawManeuver[] = [];
  const hints = props["voicehints"];
  if (Array.isArray(hints)) {
    for (const h of hints) {
      if (!Array.isArray(h) || h.length < 5) continue;
      const index = num(h[0]);
      const cmd = num(h[1]);
      const exit = num(h[2]) ?? 0;
      const angle = num(h[4]);
      if (index == null || cmd == null || angle == null) continue;
      if (!Number.isInteger(index) || index < 0 || index >= rawGeometry.length) continue;
      if (cmd === BL) warnings.push(`Abschnitt bei Punkt ${index} ist Luftlinie, kein Weg.`);
      const m = maneuverFromHint(cmd, angle, exit);
      if (m) maneuvers.push({ index, ...m });
    }
  } else {
    warnings.push("Der Routendienst hat keine Abbiegehinweise geliefert.");
  }

  return finishRoute({
    rawGeometry,
    maneuvers: mergeClose(maneuvers, routeCumulativeMeters(rawGeometry)),
    points,
    durationS: num(props["total-time"]),
    ascentM: num(props["filtered ascend"]),
    source: {
      provider: "brouter",
      profile,
      engine: typeof props["creator"] === "string" ? props["creator"].slice(0, 40) : null,
      data: "OpenStreetMap (ODbL)",
      attribution: OSM_ATTRIBUTION,
      computedAt: new Date().toISOString(),
    },
    warnings,
    labels,
    rawElevationM,
  });
}

/** Grenzen prüfen, bevor irgendetwas das Haus verlässt. */
export function assertRoutable(points: LngLat[]): void {
  if (points.length < MIN_ROUTE_POINTS)
    throw new RoutingError("invalid", "Für eine Route braucht es mindestens zwei Punkte.");
  if (points.length > MAX_ROUTE_POINTS)
    throw new RoutingError("invalid", `Mehr als ${MAX_ROUTE_POINTS} Punkte sind nicht vorgesehen.`);
  for (let i = 0; i < points.length; i++) {
    const [lng, lat] = points[i];
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90)
      throw new RoutingError("invalid", "Ungültige Koordinate.");
    if (i > 0 && haversineMeters(points[i - 1], points[i]) > MAX_HOP_M)
      throw new RoutingError("invalid", "Zwei Punkte liegen zu weit auseinander.");
  }
}

/**
 * Was ein Fehler von BRouter bedeutet. NUR "kein Weg zwischen den Punkten" und "Punkt ausserhalb
 * der Wegdaten" sind Eingaben (no-route). Fehlende Wegdatei, fehlendes Profil und andere
 * Einstellungsfehler des Servers ("datafile ... not found", "profile ... not found") sind
 * unsere Sache und muessen als Ausfall gemeldet werden (routing_failed), sonst sieht sie
 * niemand: Jede Route wuerde still "kein Weg" sagen.
 */
export function classifyFailure(status: number, why: string): "no-route" | "timeout" | "bad-response" | "unreachable" {
  if (/position not mapped|no track found|no route found/i.test(why)) return "no-route";
  if (/timeout|killed/i.test(why)) return "timeout";
  if (/datafile|profile|lookup|\.brf|\.rd5|segment|not found|unknown|exception/i.test(why)) return "bad-response";
  if (status === 400) return "no-route";
  return status >= 500 ? "unreachable" : "bad-response";
}

export class BrouterProvider implements RoutingProvider {
  readonly name = "brouter" as const;
  private readonly baseUrl: string;
  /** Token des Torwächters (Caddy) vor dem Dienst. Lokal ohne Token. */
  private readonly token: string | undefined;
  private readonly opts: { timeoutMs?: number; profileFor?: (mode: TourMode) => string };

  constructor(
    baseUrl: string,
    token?: string,
    opts: { timeoutMs?: number; profileFor?: (mode: TourMode) => string } = {},
  ) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.opts = opts;
  }

  async route({ points, mode, labels, signal, profile: wanted }: RouteRequest): Promise<NormalizedRoute> {
    assertRoutable(points);
    const profile = wanted ?? this.opts.profileFor?.(mode) ?? BROUTER_PROFILE[mode];

    // Die Adresse kann einen Pfad tragen (".../routing"), deshalb anhängen statt ersetzen.
    const url = new URL(`${this.baseUrl.replace(/\/+$/, "")}/brouter`);
    url.searchParams.set("lonlats", points.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join("|"));
    url.searchParams.set("profile", profile);
    url.searchParams.set("alternativeidx", "0");
    url.searchParams.set("format", "geojson");
    // timode=2: Abbiegehinweise als `voicehints` im GeoJSON.
    url.searchParams.set("timode", "2");

    const deadline = AbortSignal.timeout(this.opts.timeoutMs ?? TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    // Antwort lesen (auch den Rumpf) INNERHALB des Versuchs: Ein Rumpf, der hängt, läuft sonst
    // an der Frist vorbei als rohe Ausnahme heraus.
    let status: number;
    let text: string;
    try {
      const res = await fetch(url, {
        signal: combined,
        cache: "no-store",
        // Kein Folgen von Weiterleitungen: Das Token ginge sonst an einen fremden Ort mit.
        redirect: "error",
        headers: { accept: "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      if (signal?.aborted) throw err; // Abbruch durch den Aufrufer: nicht umdeuten
      if (deadline.aborted) throw new RoutingError("timeout", "Der Routendienst hat zu lange gebraucht.");
      throw new RoutingError("unreachable", "Der Routendienst ist nicht erreichbar.");
    }
    if (status === 401 || status === 403)
      throw new RoutingError("auth", "Der Routendienst hat den Zugang abgelehnt. Token prüfen.");
    // BRouter antwortet mit 400 und einem Satz, wenn kein Weg gefunden wird oder ein Punkt
    // ausserhalb der Wegdaten liegt ("datafile ... not found"). Nur das ist "kein Weg". Jede
    // andere 4xx (404 falscher Pfad, 405, 429) ist ein Fehler bei uns oder am Dienst und wird
    // gemeldet; 5xx nur dann "kein Weg", wenn der Satz es sagt. Der Satz geht ins Log, nie an den Gast.
    if (status < 200 || status >= 300) {
      const why = text.slice(0, 200);
      throw new RoutingError(classifyFailure(status, why), `BRouter ${status}: ${why}`);
    }
    if (text.length > MAX_BYTES) throw new RoutingError("bad-response", "Die Antwort ist zu gross.");
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new RoutingError("bad-response", "Die Antwort war unlesbar.");
    }
    return parseBrouterGeojson(payload, points, profile, labels);
  }
}
