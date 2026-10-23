// Routing für den Audioguide (Rad und zu Fuss): die GANZE Runde in einer Anfrage, mit den
// Audio-Spots als stillen Wegpunkten (docs/40). Seit docs/42 (23.10.2026) rechnet der
// Server über den eigenen Routendienst (BRouter auf OpenStreetMap-Daten), nicht mehr Mapbox
// Directions: Der Fahrbildschirm im Web, vorher mit eigener Linie von Mapbox, fährt damit
// DIESELBE Linie mit demselben Profil wie die Vorschau im Runden-Editor (snapTourRoute), die
// Tour-Seite und die App. Genau diese Abweichung (Vorschau gleich andere Linie als die
// Fahrt) hat der Code zweimal gekostet.
//
// Der Browser fragt NUR unseren Server (POST /api/tours/[slug]/route, selbe Herkunft). Der
// Server baut die Kette selbst (lib/tour-reroute.ts, mit selectNavVias und buildBikeChain
// aus dieser Datei), kein Token und keine Adresse des Routendienstes verlassen ihn. Die
// Schritte kommen sprachneutral zurück; den Text baut toNavSteps() aus den Sprachdateien
// (Tours.maneuver.*) und schickt sie durch prepareSteps (lib/nav-steps.ts). BRouter kennt
// keine Strassennamen, die Anweisungen sagen deshalb nur "links", "rechts", ... (ohne Namen).
//
// Seit 15.09.2026 fahren die WEGPUNKTE OHNE GESCHICHTE des Admins mit (tours.route_via,
// lib/tour-route.ts): dieselben stillen Zwischenpunkte, die der Editor an den Routendienst
// schickt. Welche Wegpunkte in eine Anfrage gehoeren, entscheidet selectNavVias: nur die
// vor dem Gast, nur die zu einem noch offenen Halt.
import {
  cleanRouteGeo,
  reconcileVia,
  viaIdOf,
  MAX_DIRECTIONS_COORDS,
  START_KEY,
  END_KEY,
  type LngLat,
  type ViaLeg,
} from "./tour-route";
import { haversineMeters } from "./geo";
import type { NavStep } from "./bike-nav-core";
import { toNavSteps, type InstructionFor, type RouteStep } from "./routing/types";

// no-token: Routendienst nicht eingerichtet oder Token abgelehnt (docs/42 Abschnitt 6);
// too-far: die Position liegt zu weit von der Runde; no-route: zwischen den Punkten kein Weg;
// network: Dienst oder Netz nicht erreichbar (die Navigation fasst von selbst nach).
export type BikeLegError = "no-token" | "too-far" | "network" | "no-route";

// ——— Die ganze Runde in EINER Anfrage ————————————————————————————————————————
// Alle Spots gehen als STILLE
// Wegpunkte mit: `waypoints=0;<letzter>` sagt Mapbox, dass nur Start und Ziel echte
// Zwischenhalte sind, alles dazwischen wird durchfahren. Die Antwort hat deshalb genau
// ein Leg mit durchgehender Geometrie und einer Schrittliste über die ganze Runde, plus
// je stillem Wegpunkt einen `via_waypoints`-Eintrag mit seiner Stelle auf der Linie.
//
// Genau daran hängen drei Dinge, die mit Etappen grundsätzlich nicht gehen: die Route
// vor dem Gast farbig und hinter ihm ausgegraut, ein exakter Audio-Vorlauf, und eine
// Neuberechnung, die nach vorn an den offenen Spots vorbeiführt statt zurück.
export type BikeRoute = {
  geometry: [number, number][];
  // Abbiegungen über die GANZE Runde, alongM ab Start.
  steps: NavStep[];
  // Je Spot (in der Reihenfolge von `spots`) seine Strecke ab Start.
  spotAlongM: number[];
  // Je mitgeschicktem Wegpunkt (viaIdOf) seine Strecke ab Start. Damit weiss die naechste
  // Neuberechnung, welche Wegpunkte der Gast schon hinter sich hat.
  viaAlongM: Record<string, number>;
  distanceM: number;
  durationS: number;
};

export type BikeRouteResult = { ok: true; route: BikeRoute } | { ok: false; error: BikeLegError };

// ——— Wegpunkte ohne Geschichte in der Anfrage ————————————————————————————————
/** Ein Wegpunkt fuer eine Anfrage: vor welchem Halt (Position in `spots`) oder vor dem Ziel er liegt. */
export type NavVia = { id: string; coord: LngLat; before: number | "end" };

export type BikeChainKind =
  | { kind: "origin" }
  | { kind: "stop"; pos: number }
  | { kind: "via"; id: string }
  | { kind: "end" };

/**
 * Die Koordinatenfolge einer Anfrage samt Tabelle, was an jeder Stelle steht. Ueber die
 * Tabelle werden die `via_waypoints` der Antwort zurueck auf Halte und Wegpunkte gelesen;
 * bis 15.09.2026 galt dafuer "Spot i ist Koordinate i + 1", und das stimmt mit Wegpunkten
 * dazwischen nicht mehr.
 */
export function buildBikeChain(
  from: LngLat,
  spots: LngLat[],
  end: LngLat | null,
  vias: NavVia[],
): { coords: LngLat[]; kinds: BikeChainKind[] } {
  const coords: LngLat[] = [from];
  const kinds: BikeChainKind[] = [{ kind: "origin" }];
  spots.forEach((s, pos) => {
    for (const v of vias)
      if (v.before === pos) {
        coords.push(v.coord);
        kinds.push({ kind: "via", id: v.id });
      }
    coords.push(s);
    kinds.push({ kind: "stop", pos });
  });
  for (const v of vias)
    if (v.before === "end") {
      coords.push(v.coord);
      kinds.push({ kind: "via", id: v.id });
    }
  if (end) {
    coords.push(end);
    kinds.push({ kind: "end" });
  }
  return { coords, kinds };
}

/**
 * Wegpunkte (tours.route_via) auf die Halte DIESES Bildschirms umgeschluesselt: Die
 * Abschnitte kennen Punkt-IDs (spotSlug), die Navigation kennt Halte nur als Index in der
 * Liste der Halte MIT Koordinaten. Erst an die Kette dieser Halte anpassen (ein Abschnitt
 * an einer Station ohne Punkt wird dabei zusammengeklebt, so wie die Navigation die Station
 * ohnehin nicht anfaehrt), dann umschluesseln. Eine Quelle fuer den Fahrbildschirm im Web
 * und das Umrouten der App (lib/tour-reroute.ts).
 */
export function navViasForStops(legs: ViaLeg[], stopIds: string[], hasEnd: boolean): ViaLeg[] {
  if (!legs.length) return [];
  const keys = [START_KEY, ...stopIds, ...(hasEnd ? [END_KEY] : [])];
  const idx = new Map(stopIds.map((id, i) => [id, String(i)]));
  const rekey = (k: string) => (k === START_KEY || k === END_KEY ? k : (idx.get(k) ?? k));
  return reconcileVia(legs, keys).legs.map((l) => ({ from: rekey(l.from), to: rekey(l.to), coords: l.coords }));
}

// Ein Wegpunkt so knapp vor dem Gast ist keine Kehrtwende wert.
const REROUTE_BEHIND_M = 30;

/**
 * Welche Wegpunkte in DIESE Anfrage gehoeren. `legs` sind die Abschnitte der Runde mit
 * Tour-Indizes als Schluessel ("start", "0", "1", …, "end"); `keep` die Tour-Indizes der
 * Halte, die noch angefahren werden, in Reihenfolge.
 *
 *   - Abschnitte werden gegen ["start", ...keep, "end"] angepasst: ueber erledigte oder per
 *     X uebersprungene Halte hinweg zusammengeklebt, alles andere faellt weg.
 *   - Nur im ERSTEN Abschnitt (ab "start") faellt ein Wegpunkt weg, wenn der Gast dem
 *     Zielhalt schon naeher ist als der Wegpunkt: Er laege hinter ihm (Wiedereinstieg
 *     mitten in der Runde). Spaetere Abschnitte liegen immer vor dem Gast. Die Regel auf
 *     alle Abschnitte anzuwenden nahm jeder Rundtour beim Start die Wegpunkte des letzten
 *     Abschnitts, weil dort Start = Ziel ist.
 *   - Bei einer Neuberechnung faellt zusaetzlich weg, was laut der letzten Route schon
 *     hinter dem Gast liegt (viaAlongM).
 *   - Deckel: Origin + Halte + Ziel + Wegpunkte hoechstens MAX_DIRECTIONS_COORDS. Darueber
 *     fallen die Wegpunkte der hintersten Abschnitte weg, nie ein Halt, nie das Ziel.
 */
export function selectNavVias(input: {
  legs: ViaLeg[];
  keep: number[];
  stopCoords: LngLat[];
  end: LngLat | null;
  origin: LngLat;
  isReroute: boolean;
  alongM?: number;
  viaAlongM?: Record<string, number>;
}): NavVia[] {
  if (!input.legs.length || !input.keep.length) return [];
  const keys = [START_KEY, ...input.keep.map(String), ...(input.end ? [END_KEY] : [])];
  const { legs } = reconcileVia(input.legs, keys);
  const posOf = new Map(input.keep.map((tourIdx, pos) => [String(tourIdx), pos]));
  const coordOf = (k: string): LngLat | null =>
    k === END_KEY ? input.end : (input.stopCoords[Number(k)] ?? null);

  let out: NavVia[] = [];
  for (const leg of legs) {
    const before = leg.to === END_KEY ? "end" : posOf.get(leg.to);
    if (before === undefined) continue;
    const dest = coordOf(leg.to);
    for (const c of leg.coords) {
      const id = viaIdOf(c);
      if (leg.from === START_KEY && dest && haversineMeters(input.origin, dest) < haversineMeters(c, dest))
        continue;
      if (input.isReroute && input.alongM != null) {
        const a = input.viaAlongM?.[id];
        if (a != null && a <= input.alongM + REROUTE_BEHIND_M) continue;
      }
      out.push({ id, coord: c, before });
    }
  }
  const fixed = 1 + input.keep.length + (input.end ? 1 : 0);
  while (fixed + out.length > MAX_DIRECTIONS_COORDS && out.length) {
    const last = out[out.length - 1].before;
    out = out.filter((v) => v.before !== last);
  }
  return out;
}

/** Was der Server fuers Umrouten braucht (POST /api/tours/[slug]/route). */
export type FetchBikeRouteInput = {
  slug: string;
  from: LngLat;
  /** Indizes in der Liste der Halte MIT Koordinate (so zaehlt der Fahrbildschirm), die noch angefahren werden. */
  keep: number[];
  locale: string;
  /** Fortschritt auf der alten Linie, nur bei einer Neuberechnung (selectNavVias laesst Wegpunkte dahinter weg). */
  alongM?: number;
  /** viaAlongM der alten Route. */
  viaAlongM?: Record<string, number>;
  signal?: AbortSignal;
  /** Text einer Anweisung aus den Sprachdateien (Tours.maneuver.*). */
  instructionFor: InstructionFor;
};

export async function fetchBikeRoute(input: FetchBikeRouteInput): Promise<BikeRouteResult> {
  if (input.keep.length === 0) return { ok: false, error: "no-route" };
  try {
    const res = await fetch(`/api/tours/${encodeURIComponent(input.slug)}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: input.signal,
      body: JSON.stringify({
        from: input.from,
        keep: input.keep,
        locale: input.locale,
        ...(input.alongM != null ? { alongM: input.alongM } : {}),
        ...(input.viaAlongM ? { viaAlongM: input.viaAlongM } : {}),
      }),
    });
    // Feste Codes aus der Route: too_far, no_token, no_route (422/400/404: kein Weg oder
    // unbrauchbare Anfrage); alles andere (429, 5xx) ist ein Netz- bzw. Dienstproblem: Die
    // Navigation haelt die alte Linie und fasst nach.
    if (!res.ok) {
      const code = (await res.json().catch(() => null))?.error;
      if (code === "too_far") return { ok: false, error: "too-far" };
      if (code === "no_token") return { ok: false, error: "no-token" };
      if (res.status === 422 || res.status === 400 || res.status === 404) return { ok: false, error: "no-route" };
      return { ok: false, error: "network" };
    }
    const j = await res.json();
    const r = j?.route;
    const geometry = cleanRouteGeo(r?.geometry);
    if (!geometry || !Array.isArray(r?.steps) || !Array.isArray(r?.stopAlongM)) return { ok: false, error: "no-route" };
    const distanceM = typeof r.distanceM === "number" ? r.distanceM : 0;
    return {
      ok: true,
      route: {
        geometry,
        // Bögen raus, dicht beieinanderliegende Abbiegungen aneinanderhängen (prepareSteps).
        steps: toNavSteps(r.steps as RouteStep[], input.instructionFor),
        // Der letzte Halt ohne Ziel liegt am Routenende: Der Server liefert dann dessen Laenge.
        spotAlongM: (r.stopAlongM as (number | null)[]).map((m) => (typeof m === "number" ? m : distanceM)),
        viaAlongM: (r.viaAlongM ?? {}) as Record<string, number>,
        distanceM,
        durationS: typeof r.durationMin === "number" ? r.durationMin * 60 : 0,
      },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, error: "network" };
  }
}
