// Routing für den Audioguide (Rad und zu Fuss): die GANZE Runde in einer Anfrage, mit den
// Audio-Spots als stillen Wegpunkten (docs/40). Das Profil kommt vom Aufrufer
// (`profile`): "cycling" fuer eine S-Bike-Runde, "walking" fuer eine Geh-Runde. Alles
// andere ist fuer beide gleich. Bis 24.08.2026 stand hier das Gegenteil, ein eigener
// Abruf je Etappe von der aktuellen Position zum nächsten Stopp. Das war als erster Wurf
// richtig, kann aber drei Dinge grundsätzlich nicht: die Route vor dem Gast farbig und
// hinter ihm ausgegraut zeigen (eine Etappe kennt die Runde nicht), einen exakten
// Audio-Vorlauf liefern, und beim Neu-Routen nach vorn an den offenen Spots vorbeiführen.
// Nebenbei kostete es rund 40 statt rund 11 Anfragen je Fahrt.
//
// Seit 15.09.2026 fahren die WEGPUNKTE OHNE GESCHICHTE des Admins mit (tours.route_via,
// lib/tour-route.ts): dieselben stillen Zwischenpunkte, die der Editor an Mapbox schickt.
// Ohne sie routete Mapbox den Gast doch durch die Fussgaengerzone, um die der Admin
// herumgeplant hat. Welche Wegpunkte in eine Anfrage gehoeren, entscheidet selectNavVias:
// nur die vor dem Gast, nur die zu einem noch offenen Halt.
//
// Läuft im BROWSER mit dem öffentlichen, URL-beschränkten Token: der Request trägt einen
// Referer (anders als serverseitige Aufrufe), und eine Neuberechnung während der Fahrt
// darf keinen zusätzlichen Server-Hop kosten.
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
import { haversineMeters, routeCumulativeMeters } from "./geo";
import type { NavStep } from "./bike-nav-core";
import { prepareSteps, turnAngle, type RawStep } from "./nav-steps";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export type BikeLegError = "no-token" | "network" | "no-route";

// Mapbox-Directions-Profil je Fortbewegung (tours.mode, 0064). Dieselbe Zuordnung wie
// im Runden-Editor (tour-actions.ts, snapTourRoute): Der Gast faehrt die Linie, die der
// Admin in der Vorschau gesehen hat.
export type DirectionsProfile = "cycling" | "walking";
export function directionsProfileFor(mode: "walk" | "bike"): DirectionsProfile {
  return mode === "bike" ? "cycling" : "walking";
}

type MapboxStep = {
  distance: number;
  maneuver: {
    instruction: string;
    type: string;
    modifier?: string;
    // Kurs vor und nach der Abbiegung. Daraus wird der Winkel, und der entscheidet, ob es
    // eine Abbiegung ist oder nur ein Bogen (lib/nav-steps.ts). Mapbox liefert die Felder
    // seit jeher mit, gelesen wurden sie bis 25.08.2026 nicht.
    bearing_before?: number;
    bearing_after?: number;
  };
};

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

type ViaWaypoint = { waypoint_index: number; geometry_index: number; distance_from_start: number };

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

/**
 * Stellen der Halte und Wegpunkte auf UNSERER Linie, aus den `via_waypoints` der Antwort.
 * Ein Halt ohne Eintrag ist das Routenende (der letzte Halt, wenn kein Ziel mitgeht).
 */
export function alongFromViaWaypoints(
  kinds: BikeChainKind[],
  via: ViaWaypoint[],
  cumGeo: number[],
  spotCount: number,
): { spotAlongM: number[]; viaAlongM: Record<string, number> } {
  const routeLenM = cumGeo[cumGeo.length - 1] ?? 0;
  const spotAlongM: number[] = new Array(spotCount).fill(routeLenM);
  const viaAlongM: Record<string, number> = {};
  for (const v of via) {
    const k = kinds[v.waypoint_index];
    if (!k) continue;
    const gi = Math.max(0, Math.min(v.geometry_index, cumGeo.length - 1));
    const m = cumGeo[gi];
    if (k.kind === "stop") spotAlongM[k.pos] = m;
    else if (k.kind === "via") viaAlongM[k.id] = m;
  }
  return { spotAlongM, viaAlongM };
}

export async function fetchBikeRoute(
  from: [number, number],
  spots: [number, number][],
  locale: string,
  signal?: AbortSignal,
  // Ziel der Runde, falls es nicht der letzte Spot ist. EINE RUNDTOUR ENDET DORT, WO SIE
  // BEGINNT, und ohne diesen Punkt endete die Navigation am letzten Spot: Bei Runde A ist
  // das Mülln, 692 m vom Hanuschplatz entfernt. Der Gast bekäme "Ziel erreicht", während
  // sein Rad noch sieben Minuten weiter steht.
  //
  // Wichtig ist, dass das Ziel KEIN Audio-Spot ist. Deshalb steht es hier und nicht in
  // `spots`: Alles in `spots` bekommt einen Play-Knopf, und ein Play-Knopf ohne Geschichte
  // ist ein Knopf, der nichts tut.
  end?: [number, number] | null,
  // Wegpunkte ohne Geschichte, schon ausgewaehlt (selectNavVias). Auch sie sind keine Spots.
  vias: NavVia[] = [],
  // "cycling" oder "walking" (directionsProfileFor). Bis 16.09.2026 stand hier fest
  // "cycling", weil es nur die Radrunde gab.
  profile: DirectionsProfile = "cycling",
): Promise<BikeRouteResult> {
  if (!TOKEN) return { ok: false, error: "no-token" };
  if (spots.length === 0) return { ok: false, error: "no-route" };

  const chain = buildBikeChain(from, spots, end ?? null, vias);
  // Der Editor deckelt Start + Halte + Ziel, selectNavVias die Wegpunkte. Hier nur noch
  // der Riegel: lieber ein Fehler als eine still gekuerzte Runde ohne Ziel (so war es bis
  // 15.09.2026, `.slice(0, 25)` nahm als Erstes das Ziel weg).
  if (chain.coords.length > MAX_DIRECTIONS_COORDS) return { ok: false, error: "no-route" };
  const coords = chain.coords;
  const last = coords.length - 1;
  const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(";");
  // EIN Profil je Anfrage, nie das kuerzere von zweien. Der Vorgänger fragte am Rad
  // zusätzlich "walking" ab und nahm das kürzere von beiden (docs/40); das kann den Gast
  // auf eine Treppe oder in eine Fussgängerzone führen. Wo ein Fussweg die bessere
  // Verbindung ist, gehört er als Schiebestelle markiert, nicht still als Radweg
  // ausgegeben. Zu Fuss ist "walking" umgekehrt genau richtig: Treppen und Gassen sind
  // dort der Weg, nicht das Hindernis.
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordStr}` +
    `?steps=true&geometries=geojson&overview=full&waypoints=0;${last}` +
    `&language=${encodeURIComponent(locale)}&access_token=${TOKEN}`;

  try {
    const res = await fetch(url, { signal });
    // 401/403 heisst Token, nicht "keine Route": Der öffentliche pk-Token ist auf unsere
    // Domains beschränkt und schlägt überall fehl, wo kein Referer mitgeht (Prüfskript,
    // Server, fremde Einbettung). Das als "no-route" zu melden schickt jeden, der es
    // sucht, in die falsche Richtung – genau das ist mir beim Prüfen selbst passiert.
    if (res.status === 401 || res.status === 403) return { ok: false, error: "no-token" };
    if (!res.ok) return { ok: false, error: res.status >= 500 ? "network" : "no-route" };
    const j = await res.json();
    const route = Array.isArray(j.routes) ? j.routes[0] : null;
    const geometry = cleanRouteGeo(route?.geometry?.coordinates);
    if (j.code !== "Ok" || !route || !geometry) return { ok: false, error: "no-route" };

    const mapboxLeg = route.legs?.[0];
    if (!mapboxLeg) return { ok: false, error: "no-route" };

    // Ein Step trägt das Manöver, mit dem er BEGINNT, seine `distance` ist die Strecke
    // danach. Der erste ist das Losfahren und damit kein Abbiege-Hinweis.
    const rawSteps = (mapboxLeg.steps ?? []) as MapboxStep[];
    let cum = 0;
    const roh: RawStep[] = [];
    for (let i = 0; i < rawSteps.length; i++) {
      if (i > 0) {
        const m = rawSteps[i].maneuver;
        roh.push({
          alongM: cum,
          instruction: m.instruction,
          type: m.type,
          modifier: m.modifier,
          angleDeg: turnAngle(m.bearing_before, m.bearing_after),
        });
      }
      cum += rawSteps[i].distance ?? 0;
    }
    // Bögen raus, dicht beieinanderliegende Abbiegungen aneinanderhängen. Gemessen an
    // Runde A: aus 54 Schritten werden deutlich weniger Ansagen, ohne dass eine Abbiegung
    // verschwindet (lib/nav-steps.ts erklärt, was verworfen werden darf und was nie).
    const steps: NavStep[] = prepareSteps(roh);

    // Spot-Positionen über `geometry_index` statt über `distance_from_start`: Beide
    // liefern dasselbe auf wenige Meter genau (gemessen: höchstens 5,4 m auf 4,7 km),
    // aber der Index zeigt auf UNSERE Linie. Damit wird der Spot-Offset auf derselben
    // Geometrie gemessen wie der Fortschritt des Gastes (nearestPointOnRoute), und die
    // beiden Zahlen können gar nicht auseinanderlaufen.
    const cumGeo = routeCumulativeMeters(geometry);
    const via = (mapboxLeg.via_waypoints ?? []) as ViaWaypoint[];
    const { spotAlongM, viaAlongM } = alongFromViaWaypoints(chain.kinds, via, cumGeo, spots.length);

    return {
      ok: true,
      route: {
        geometry,
        steps,
        spotAlongM,
        viaAlongM,
        distanceM: typeof route.distance === "number" ? route.distance : cum,
        durationS: typeof route.duration === "number" ? route.duration : 0,
      },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, error: "network" };
  }
}
