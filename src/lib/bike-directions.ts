// Etappen-Routing für die S-Bike-Navigation: von der AKTUELLEN Position zu GENAU EINEM
// Tour-Stopp, mit Manöver-Schritten (steps=true) für die Abbiege-Anzeige. Bewusst je
// Etappe statt der ganzen Runde auf einmal (siehe docs/40): kürzere Schrittlisten,
// bleibt unter dem 25-Koordinaten-Limit der Directions API auch bei langen Touren, und
// eine neue Etappe entsteht ohnehin bei jedem erreichten Stopp und jedem Reroute.
//
// Läuft im BROWSER mit dem öffentlichen, URL-beschränkten Token: der Request trägt
// einen Referer (anders als die serverseitigen Aufrufe in tour-actions.ts/tour-
// generate.ts), und ein Reroute während der Fahrt darf keinen zusätzlichen Server-Hop
// kosten.
//
// PROFIL "cycling" UND "walking", das kürzere gewinnt: In Salzburg-Parsch (Testrunde,
// docs/40) nimmt "cycling" allein wilde Umwege über die Hauptstrasse, weil mehrere
// kurze Verbindungswege nicht als radtauglich getaggt sind – gemessen 1747m statt
// 345m für eine 160m-Luftlinie. Dieselbe Lücke kann jede echte Runde treffen, nicht
// nur diese eine, deshalb hier und nicht nur in der Vorschau-Linie (test-sbike-
// tour.ts) behoben. Bewusste Abwägung: das kann eine Fahrt auf einen nicht als
// radtauglich markierten Fussweg führen (Nutzer-Entscheidung, siehe Konversation).
import { cleanRouteGeo } from "./tour-route";
import { routeCumulativeMeters } from "./geo";
import type { NavLeg, NavStep } from "./bike-nav-core";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export type BikeLegError = "no-token" | "network" | "no-route";

export type BikeLegResult =
  | { ok: true; leg: NavLeg; distanceM: number; durationS: number }
  | { ok: false; error: BikeLegError };

type MapboxStep = {
  distance: number;
  maneuver: { instruction: string; type: string; modifier?: string };
};

type ProfileLeg = { leg: NavLeg; distanceM: number; durationS: number };

async function fetchProfileLeg(
  profile: "cycling" | "walking",
  from: [number, number],
  to: [number, number],
  locale: string,
  signal?: AbortSignal,
): Promise<ProfileLeg | null> {
  const coordStr = `${from[0]},${from[1]};${to[0]},${to[1]}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordStr}` +
    `?steps=true&geometries=geojson&overview=full&language=${encodeURIComponent(locale)}` +
    `&access_token=${TOKEN}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const j = await res.json();
  const route = Array.isArray(j.routes) ? j.routes[0] : null;
  const geometry = cleanRouteGeo(route?.geometry?.coordinates);
  if (j.code !== "Ok" || !route || !geometry) return null;

  // Jedes Step-Objekt trägt das Manöver, mit dem es BEGINNT (Step 0 = "Losfahren",
  // kein Abbiege-Hinweis). alongM eines Manövers = Summe der Distanzen aller Steps
  // DAVOR – der Punkt, an dem man dieses Manöver erreicht.
  const rawSteps = (route.legs?.[0]?.steps ?? []) as MapboxStep[];
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

  return {
    leg: { geometry, steps, stop: to },
    distanceM: typeof route.distance === "number" ? route.distance : cum,
    durationS: typeof route.duration === "number" ? route.duration : 0,
  };
}

// ——— Die ganze Runde in EINER Anfrage ————————————————————————————————————————
// Ablösung für das Etappen-Routing darunter (docs/40). Alle Spots gehen als STILLE
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
  // Bewusst NUR "cycling", nicht zusätzlich "walking" wie beim Etappen-Routing unten
  // (docs/40): Das kürzere von beiden zu nehmen kann den Gast auf eine Treppe oder in
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

    // Schritte wie beim Etappen-Routing: Ein Step trägt das Manöver, mit dem er BEGINNT,
    // seine `distance` ist die Strecke danach. Der erste ist das Losfahren, kein Hinweis.
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

export async function fetchBikeLeg(
  from: [number, number],
  to: [number, number],
  locale: string,
  signal?: AbortSignal,
): Promise<BikeLegResult> {
  if (!TOKEN) return { ok: false, error: "no-token" };
  try {
    const [cycling, walking] = await Promise.all([
      fetchProfileLeg("cycling", from, to, locale, signal),
      fetchProfileLeg("walking", from, to, locale, signal),
    ]);
    const best =
      !cycling && !walking
        ? null
        : !cycling
          ? walking
          : !walking
            ? cycling
            : walking.distanceM < cycling.distanceM
              ? walking
              : cycling;
    if (!best) return { ok: false, error: "no-route" };
    return { ok: true, ...best };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, error: "network" };
  }
}
