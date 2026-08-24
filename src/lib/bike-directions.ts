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
