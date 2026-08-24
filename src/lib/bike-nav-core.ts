// Reine Entscheidungslogik des Rad-Audioguides: aus dem aktuellen Zustand + einem neuen
// GPS-Fix + der GANZEN Runde wird der NEUE Zustand plus 0..n Ereignisse (Play-Knopf für
// einen Spot zeigen, Spot als vorbei verbuchen, neu routen, Runde zu Ende). Keine Mapbox,
// kein DOM, kein `Date.now()` (Zeit kommt als `at` im Fix rein) -> mit `npm run nav:check`
// ohne Browser prüfbar, und die einzige Stelle, die weiss, WANN etwas passiert. Die
// Kamera/Karte (NavMap.tsx) und der Routen-Abruf (useBikeNavigation.ts) reagieren nur auf
// das, was hier rauskommt.
//
// EINE Route statt vieler Etappen (docs/40): Der Fortschritt wird entlang der gesamten
// Linie gemessen, und jeder Spot hat darauf eine feste Stelle (spotAlongM, aus
// bike-directions.ts). Der Abstand bis zum nächsten Spot ist damit eine Subtraktion und
// keine Schätzung, und genau daran hängt der Play-Knopf, der rechtzeitig erscheinen soll.

import { bearingBetween, nearestPointOnRoute, haversineMeters, unwrapDegrees } from "./geo";

// Schwellwerte an einem Ort, mit Begründung – wer daran dreht, sieht sofort, wogegen.
// Alle Distanzen sind aus dem Auslegungstempo von 18 km/h (5 m/s) gerechnet, siehe
// docs/40. Wer das Tempo ändert, zieht sie alle mit.
export const NAV = {
  // ——— Audio-Spots ———
  SPOT_NEAR_M: 150, // Play-Knopf erscheint: 30 Sekunden Vorlauf bei 18 km/h
  SPOT_PASSED_M: 100, // so weit dahinter gilt der Spot als vorbei, auch ungehört
  // Kein Play-Knopf, solange eine Abbiegung so nah bevorsteht: Wer gleich abbiegt, soll
  // nicht im selben Moment eine Geschichte angeboten bekommen (Sicherheitsregel docs/40).
  // Der Knopf kommt danach, der Spot geht dadurch nicht verloren.
  MANEUVER_QUIET_M: 140,

  // ——— Ende der Runde ———
  FINISH_M: 35, // so nah am Ende gilt die Runde als gefahren

  // ——— Off-Route ———
  OFF_ROUTE_M: 40, // Radweg neben der Fahrbahn + normale Häuserschlucht-Ungenauigkeit
  OFF_ROUTE_FIXES: 3,
  REROUTE_COOLDOWN_MS: 10_000, // keine zwei Neuberechnungen in derselben Häuserschlucht

  // ——— Güte der Messung ———
  MAX_ACCURACY_M: 60, // schlechtere Fixe werden gar nicht erst bewertet
  DECIDE_ACCURACY_M: 35, // Off-Route braucht einen noch saubereren Fix als das
  MAX_SPEED_MPS: 20, // ~72 km/h – schnellere "Sprünge" sind ein GPS-Ausreisser, kein Tempo

  // ——— Anzeige ———
  MOVING_MPS: 1.5, // erst ab hier ist coords.heading verlässlich (Route sonst)
  HEADING_EMA: 0.25, // wie träge die angezeigte Fahrtrichtung nachzieht
} as const;

export type GeoFix = {
  lng: number;
  lat: number;
  accuracyM: number;
  headingDeg: number | null;
  speedMps: number | null;
  at: number; // ms, kommt vom Aufrufer (kein Date.now() hier drin)
};

export type NavStep = {
  alongM: number; // Distanz ab Routen-Start bis zu dieser Abbiegung
  instruction: string;
  type: string;
  modifier?: string;
};

// Die ganze Runde in einem Stück (bike-directions.ts, fetchBikeRoute). `spotAlongM` ist
// die Stelle jedes Audio-Spots auf DIESER Linie, gemessen auf derselben Geometrie wie der
// Fortschritt des Gastes – die beiden Zahlen können deshalb nicht auseinanderlaufen.
export type NavRoute = {
  geometry: [number, number][];
  steps: NavStep[];
  spotAlongM: number[];
  totalM: number;
};

// Was mit einem Spot schon passiert ist. Bewusst drei Zustände und keine zwei Booleans:
// "war der Knopf schon da" und "ist er vorbei" gehören zusammen, sonst gibt es den
// vierten, unmöglichen Fall.
export type SpotPhase = "open" | "near" | "done";

export type NavState = {
  alongM: number;
  crossTrackM: number;
  stepIndex: number; // -1 = keine weitere Abbiegung bekannt
  distanceToManeuverM: number | null;
  bearingDeg: number; // geglättete Fahrtrichtung fürs Karten-Bearing
  offRouteStreak: number;
  spotPhase: SpotPhase[];
  nextSpotIndex: number; // nächster noch nicht abgehakter Spot, -1 = keiner mehr
  distanceToNextSpotM: number | null; // entlang der Route, nicht Luftlinie
  remainingM: number; // bis zum Ende der Runde
  finished: boolean;
  lastFixAt: number | null;
  lastFixCoord: [number, number] | null;
  lastRerouteAt: number | null;
};

export function initNavState(spotCount = 0): NavState {
  return {
    alongM: 0,
    crossTrackM: 0,
    stepIndex: -1,
    distanceToManeuverM: null,
    bearingDeg: 0,
    offRouteStreak: 0,
    spotPhase: Array.from({ length: spotCount }, () => "open" as SpotPhase),
    nextSpotIndex: spotCount > 0 ? 0 : -1,
    distanceToNextSpotM: null,
    remainingM: 0,
    finished: false,
    lastFixAt: null,
    lastFixCoord: null,
    lastRerouteAt: null,
  };
}

// Nach einer Neuberechnung: Die Route ist neu, der Fortschritt beginnt wieder bei 0. Was
// der Gast schon gehört oder passiert hat, bleibt aber stehen – sonst würde ein Umweg die
// halbe Runde noch einmal anbieten. Die Fahrtrichtung bleibt ebenfalls (die Kamera soll
// nicht ruckartig neu ausrichten), und lastRerouteAt zählt global weiter, damit nicht
// sofort wieder umgeroutet wird.
//
// `keptPhases` sind die Phasen der Spots, die in der NEUEN Route noch vorkommen, in deren
// Reihenfolge. Wer die neue Route ohne die erledigten Spots anfragt (so macht es
// useBikeNavigation), übergibt hier entsprechend weniger Einträge.
export function resetForNewRoute(state: NavState, keptPhases: SpotPhase[]): NavState {
  const fresh = initNavState(keptPhases.length);
  return {
    ...fresh,
    spotPhase: keptPhases,
    nextSpotIndex: keptPhases.findIndex((p) => p !== "done"),
    bearingDeg: state.bearingDeg,
    lastRerouteAt: state.lastRerouteAt,
  };
}

export type NavEvent =
  | { type: "spot-near"; index: number } // Play-Knopf zeigen
  | { type: "spot-passed"; index: number } // vorbei, auch wenn nie gedrückt wurde
  | { type: "reroute" }
  | { type: "finished" };

export function stepNav(
  state: NavState,
  fix: GeoFix,
  route: NavRoute,
): { state: NavState; events: NavEvent[] } {
  // Zu ungenauer Fix: gar nicht erst bewerten. Die UI darf den Punkt trotzdem anzeigen
  // (das macht sie mit dem rohen fix, nicht mit diesem Zustand) – hier geht es nur um
  // Entscheidungen, die ein schlechter Fix sonst verfälscht.
  if (fix.accuracyM > NAV.MAX_ACCURACY_M) return { state, events: [] };

  // Teleport-Filter: ein GPS-Ausreisser springt oft weiter, als ein Radl in der
  // vergangenen Zeit fahren kann. Der Fix wird verworfen, lastFix bleibt der ALTE gute
  // Wert, damit der nächste echte Fix wieder normal vergleicht.
  if (state.lastFixCoord && state.lastFixAt != null) {
    const dtS = (fix.at - state.lastFixAt) / 1000;
    if (dtS > 0) {
      const impliedMps = haversineMeters(state.lastFixCoord, [fix.lng, fix.lat]) / dtS;
      if (impliedMps > NAV.MAX_SPEED_MPS) return { state, events: [] };
    }
  }

  const here: [number, number] = [fix.lng, fix.lat];
  // Mit Suchfenster um den bisherigen Fortschritt: Ohne das nimmt die Suche global das
  // nächstgelegene Segment, und auf einer Runde, die dieselbe Gasse zweimal benutzt,
  // springt der Fortschritt um die halbe Runde (Begründung in geo.ts, Beleg in
  // scripts/nav-check.ts). Auf einer GANZEN Runde ist das kein Randfall mehr, sondern
  // die Regel: Eine Rundtour endet dort, wo sie beginnt.
  const nearest = nearestPointOnRoute(route.geometry, here, { nearAlongM: state.alongM });
  const alongM = nearest?.alongM ?? state.alongM;
  const crossTrackM = nearest?.crossTrackM ?? state.crossTrackM;

  // Nächste noch bevorstehende Abbiegung: die erste, deren Punkt noch vor uns liegt.
  let stepIndex = -1;
  let distanceToManeuverM: number | null = null;
  for (let i = 0; i < route.steps.length; i++) {
    if (route.steps[i].alongM > alongM) {
      stepIndex = i;
      distanceToManeuverM = route.steps[i].alongM - alongM;
      break;
    }
  }

  // Fahrtrichtung: über der Geh-Schwelle der echte Kurs des Geräts, sonst (im Stand, an
  // der Ampel) die Richtung der Route an der aktuellen Stelle – sonst würde die Karte im
  // Stillstand nach dem letzten Zufalls-Heading zappeln.
  const segA = nearest ? route.geometry[nearest.segIndex] : null;
  const segB = nearest
    ? route.geometry[Math.min(nearest.segIndex + 1, route.geometry.length - 1)]
    : null;
  const routeBearing = segA && segB ? bearingBetween(segA, segB) : state.bearingDeg;
  const rawHeading =
    fix.speedMps != null && fix.speedMps > NAV.MOVING_MPS && fix.headingDeg != null
      ? fix.headingDeg
      : routeBearing;
  const targetBearing = unwrapDegrees(state.bearingDeg, rawHeading);
  const bearingDeg =
    (((state.bearingDeg + NAV.HEADING_EMA * (targetBearing - state.bearingDeg)) % 360) + 360) % 360;

  const events: NavEvent[] = [];
  const spotPhase = [...state.spotPhase];

  // ——— Audio-Spots ——————————————————————————————————————————————————————————
  // Der Play-Knopf wartet, solange gleich eine Abbiegung kommt (MANEUVER_QUIET_M). Der
  // Spot bleibt dabei "open" und wird beim nächsten Fix erneut geprüft; verloren geht er
  // erst, wenn er wirklich hinter uns liegt.
  const maneuverClose =
    distanceToManeuverM != null && distanceToManeuverM <= NAV.MANEUVER_QUIET_M;

  for (let i = 0; i < spotPhase.length; i++) {
    const spotAt = route.spotAlongM[i];
    if (spotAt == null) continue;
    const ahead = spotAt - alongM; // negativ = schon vorbei

    if (spotPhase[i] !== "done" && ahead < -NAV.SPOT_PASSED_M) {
      spotPhase[i] = "done";
      events.push({ type: "spot-passed", index: i });
      continue;
    }
    if (spotPhase[i] === "open" && ahead <= NAV.SPOT_NEAR_M && !maneuverClose) {
      spotPhase[i] = "near";
      events.push({ type: "spot-near", index: i });
    }
  }

  const nextSpotIndex = spotPhase.findIndex((p) => p !== "done");
  const distanceToNextSpotM =
    nextSpotIndex >= 0 && route.spotAlongM[nextSpotIndex] != null
      ? route.spotAlongM[nextSpotIndex] - alongM
      : null;

  // ——— Off-Route ————————————————————————————————————————————————————————————
  // Nur mit einem wirklich guten Fix entscheiden: Ein Fix mit 50 m Genauigkeit liegt unter
  // MAX_ACCURACY_M, streut aber leicht 40 m in die falsche Richtung und würde sonst eine
  // Neuberechnung auslösen, obwohl der Gast auf dem Weg ist.
  let offRouteStreak = state.offRouteStreak;
  let lastRerouteAt = state.lastRerouteAt;
  const remainingM = Math.max(0, route.totalM - alongM);
  const finished = state.finished || remainingM <= NAV.FINISH_M;

  if (fix.accuracyM <= NAV.DECIDE_ACCURACY_M && !finished) {
    offRouteStreak = crossTrackM > NAV.OFF_ROUTE_M ? offRouteStreak + 1 : 0;
    const cooldownOk = lastRerouteAt == null || fix.at - lastRerouteAt >= NAV.REROUTE_COOLDOWN_MS;
    if (offRouteStreak >= NAV.OFF_ROUTE_FIXES && cooldownOk) {
      offRouteStreak = 0;
      lastRerouteAt = fix.at;
      events.push({ type: "reroute" });
    }
  }

  if (finished && !state.finished) events.push({ type: "finished" });

  return {
    state: {
      alongM,
      crossTrackM,
      stepIndex,
      distanceToManeuverM,
      bearingDeg,
      offRouteStreak,
      spotPhase,
      nextSpotIndex,
      distanceToNextSpotM,
      remainingM,
      finished,
      lastFixAt: fix.at,
      lastFixCoord: here,
      lastRerouteAt,
    },
    events,
  };
}
