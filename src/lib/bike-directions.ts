// Routing für den Rad-Audioguide: die GANZE Runde in einer Anfrage, mit den Audio-Spots
// als stillen Wegpunkten (docs/40). Bis 24.08.2026 stand hier das Gegenteil, ein eigener
// Abruf je Etappe von der aktuellen Position zum nächsten Stopp. Das war als erster Wurf
// richtig, kann aber drei Dinge grundsätzlich nicht: die Route vor dem Gast farbig und
// hinter ihm ausgegraut zeigen (eine Etappe kennt die Runde nicht), einen exakten
// Audio-Vorlauf liefern, und beim Neu-Routen nach vorn an den offenen Spots vorbeiführen.
// Nebenbei kostete es rund 40 statt rund 11 Anfragen je Fahrt.
//
// Läuft im BROWSER mit dem öffentlichen, URL-beschränkten Token: der Request trägt einen
// Referer (anders als serverseitige Aufrufe), und eine Neuberechnung während der Fahrt
// darf keinen zusätzlichen Server-Hop kosten.
import { cleanRouteGeo } from "./tour-route";
import { routeCumulativeMeters } from "./geo";
import type { NavStep } from "./bike-nav-core";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export type BikeLegError = "no-token" | "network" | "no-route";

type MapboxStep = {
  distance: number;
  maneuver: { instruction: string; type: string; modifier?: string };
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
  distanceM: number;
  durationS: number;
};

export type BikeRouteResult = { ok: true; route: BikeRoute } | { ok: false; error: BikeLegError };

// Mapbox nimmt höchstens 25 Koordinaten je Anfrage. Eine davon ist der Start, es bleiben
// 24 Spots. docs/40 deckelt die Runde ohnehin weit darunter.
const MAX_COORDS = 25;

type ViaWaypoint = { waypoint_index: number; geometry_index: number; distance_from_start: number };

export async function fetchBikeRoute(
  from: [number, number],
  spots: [number, number][],
  locale: string,
  signal?: AbortSignal,
): Promise<BikeRouteResult> {
  if (!TOKEN) return { ok: false, error: "no-token" };
  if (spots.length === 0) return { ok: false, error: "no-route" };

  const coords = [from, ...spots].slice(0, MAX_COORDS);
  const last = coords.length - 1;
  const coordStr = coords.map((c) => `${c[0]},${c[1]}`).join(";");
  // Bewusst NUR "cycling". Der Vorgänger fragte zusätzlich "walking" ab und nahm das
  // kürzere von beiden (docs/40); das kann den Gast auf eine Treppe oder in
  // eine Fussgängerzone führen. Wo ein Fussweg die bessere Verbindung ist, gehört er als
  // Schiebestelle markiert, nicht still als Radweg ausgegeben.
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/cycling/${coordStr}` +
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
    const steps: NavStep[] = [];
    for (let i = 0; i < rawSteps.length; i++) {
      if (i > 0) {
        steps.push({
          alongM: cum,
          instruction: rawSteps[i].maneuver.instruction,
          type: rawSteps[i].maneuver.type,
          modifier: rawSteps[i].maneuver.modifier,
        });
      }
      cum += rawSteps[i].distance ?? 0;
    }

    // Spot-Positionen über `geometry_index` statt über `distance_from_start`: Beide
    // liefern dasselbe auf wenige Meter genau (gemessen: höchstens 5,4 m auf 4,7 km),
    // aber der Index zeigt auf UNSERE Linie. Damit wird der Spot-Offset auf derselben
    // Geometrie gemessen wie der Fortschritt des Gastes (nearestPointOnRoute), und die
    // beiden Zahlen können gar nicht auseinanderlaufen.
    const cumGeo = routeCumulativeMeters(geometry);
    const routeLenM = cumGeo[cumGeo.length - 1];
    const via = (mapboxLeg.via_waypoints ?? []) as ViaWaypoint[];
    const byWaypointIndex = new Map<number, ViaWaypoint>();
    for (const v of via) byWaypointIndex.set(v.waypoint_index, v);

    const spotAlongM = spots.map((_, i) => {
      // spots[i] ist coords[i + 1], also waypoint_index i + 1.
      const v = byWaypointIndex.get(i + 1);
      if (!v) return routeLenM; // der letzte Spot IST das Routenende, er hat keinen Eintrag
      const gi = Math.max(0, Math.min(v.geometry_index, cumGeo.length - 1));
      return cumGeo[gi];
    });

    return {
      ok: true,
      route: {
        geometry,
        steps,
        spotAlongM,
        distanceM: typeof route.distance === "number" ? route.distance : cum,
        durationS: typeof route.duration === "number" ? route.duration : 0,
      },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, error: "network" };
  }
}
