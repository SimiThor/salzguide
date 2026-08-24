// Reine Entscheidungslogik der S-Bike-Navigation: aus dem aktuellen Zustand + einem
// neuen GPS-Fix + der aktuellen Etappe (current position -> nächster Tour-Stopp) wird
// der NEUE Zustand plus 0..n Ereignisse ("angekommen", "neu routen"). Keine Mapbox, kein
// DOM, kein `Date.now()` (Zeit kommt als `at` im Fix rein) -> mit `npm run nav:check`
// ohne Browser prüfbar, und die einzige Stelle, die weiss, WANN neu geroutet oder eine
// Ankunft gemeldet wird. Die Kamera/Karte (NavMap.tsx) und der Leg-Fetch
// (useBikeNavigation.ts) reagieren nur auf das, was hier rauskommt.

import { bearingBetween, nearestPointOnRoute, haversineMeters, unwrapDegrees } from "./geo";

// Schwellwerte an einem Ort, mit Begründung – wer daran dreht, sieht sofort, wogegen.
export const NAV = {
  ARRIVE_M: 35, // Ankunft am Stopp
  ARM_M: 60, // "scharf" wird ein Stopp erst, wenn man einmal so weit weg war (siehe unten)
  // ...ODER wenn man so weit GEFAHREN ist. Ohne diesen zweiten Weg hängt die Tour an
  // jeder Etappe, die kürzer als ARM_M ist, und in der Altstadt ist das der Normalfall
  // (Residenzplatz und Domplatz liegen rund 50 m auseinander): Der Gast ist dort nie
  // 60 m vom Ziel entfernt, wird also nie scharf, und die Ankunft bleibt für immer aus.
  // 25 m ist bewusst klein, aber deutlich mehr als GPS-Rauschen im Stand. Damit bleibt
  // der Fall "steht schon am Stopp und drückt Start" weiter ohne Ankunft (nav-check
  // Prüfung 6), denn wer steht, legt keine Strecke zurück.
  ARM_MOVED_M: 25,
  ARRIVE_FIXES: 2, // so viele GUTE Fixe hintereinander innerhalb ARRIVE_M
  OFF_ROUTE_M: 40, // Radweg neben der Fahrbahn + normale Häuserschlucht-Ungenauigkeit
  OFF_ROUTE_FIXES: 3,
  MAX_ACCURACY_M: 60, // schlechtere Fixe werden gar nicht erst bewertet
  DECIDE_ACCURACY_M: 35, // Ankunft/Off-Route brauchen einen noch saubereren Fix als das
  MAX_SPEED_MPS: 20, // ~72 km/h – schnellere "Sprünge" sind ein GPS-Ausreisser, kein Tempo
  REROUTE_COOLDOWN_MS: 10_000, // keine zwei Neuberechnungen in derselben Häuserschlucht
  MOVING_MPS: 1.5, // erst ab hier ist coords.heading verlässlich (Kompass sonst)
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
  alongM: number; // Distanz ab Etappen-Start bis zu dieser Abbiegung
  instruction: string;
  type: string;
  modifier?: string;
};

// Eine Etappe = die Route von der aktuellen Position zu GENAU EINEM Tour-Stopp (siehe
// bike-directions.ts). `stop` ist bewusst getrennt vom Ende der `geometry`: Ankunft wird
// gegen die echte Stopp-Koordinate gemessen, nicht gegen das Ende der zuletzt geholten
// Linie (die kann durch Snapping leicht danebenliegen).
export type NavLeg = {
  geometry: [number, number][];
  steps: NavStep[];
  stop: [number, number];
};

export type NavState = {
  alongM: number;
  crossTrackM: number;
  stepIndex: number; // -1 = keine weitere Abbiegung bekannt
  distanceToManeuverM: number | null;
  distanceToStopM: number;
  bearingDeg: number; // geglättete Fahrtrichtung fürs Karten-Bearing
  offRouteStreak: number;
  arriveStreak: number;
  armed: boolean; // war der Nutzer schon einmal >= ARM_M vom Stopp entfernt (oder ARM_MOVED_M gefahren)?
  // Fortschritt beim ERSTEN Fix dieser Etappe. Daraus wird "wie weit ist er seither
  // gekommen" – nicht aus alongM allein, denn das ist auf einer Etappe, die am Ende der
  // Route beginnt, von Anfang an gross.
  startAlongM: number | null;
  arrived: boolean; // hat DIESE Etappe schon eine Ankunft gemeldet?
  lastFixAt: number | null;
  lastFixCoord: [number, number] | null;
  lastRerouteAt: number | null;
};

export function initNavState(): NavState {
  return {
    alongM: 0,
    crossTrackM: 0,
    stepIndex: -1,
    distanceToManeuverM: null,
    distanceToStopM: Infinity,
    bearingDeg: 0,
    offRouteStreak: 0,
    arriveStreak: 0,
    armed: false,
    startAlongM: null,
    arrived: false,
    lastFixAt: null,
    lastFixCoord: null,
    lastRerouteAt: null,
  };
}

// Beim Wechsel auf eine neue Etappe (nach Ankunft ODER nach einem Reroute): die
// Fahrtrichtung bleibt (Kamera soll nicht ruckartig neu ausrichten), alles Etappen-
// bezogene beginnt neu. lastRerouteAt bleibt stehen – die Cooldown zählt global, nicht
// je Etappe, sonst könnte eine neue Etappe sofort wieder umgeroutet werden.
export function resetForNewLeg(state: NavState): NavState {
  return {
    ...initNavState(),
    bearingDeg: state.bearingDeg,
    lastRerouteAt: state.lastRerouteAt,
  };
}

export type NavEvent = { type: "arrived" } | { type: "reroute" };

export function stepNav(
  state: NavState,
  fix: GeoFix,
  leg: NavLeg,
): { state: NavState; events: NavEvent[] } {
  // Zu ungenauer Fix: gar nicht erst bewerten. Die UI darf den Punkt trotzdem anzeigen
  // (das macht sie mit dem rohen fix, nicht mit diesem Zustand) – hier geht es nur um
  // Entscheidungen (Ankunft/Reroute/Fortschritt), die ein schlechter Fix sonst verfälscht.
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
  // springt der Fortschritt dann um die halbe Etappe (Begründung in geo.ts, Beleg in
  // scripts/nav-check.ts Prüfung 7). Beim ersten Fix einer Etappe ist alongM 0, das
  // Fenster liegt also am Anfang der Route, wo der Gast auch steht.
  const nearest = nearestPointOnRoute(leg.geometry, here, { nearAlongM: state.alongM });
  const alongM = nearest?.alongM ?? state.alongM;
  const crossTrackM = nearest?.crossTrackM ?? state.crossTrackM;
  const distanceToStopM = haversineMeters(here, leg.stop);

  // Nächste noch bevorstehende Abbiegung: das erste Step, dessen Punkt noch vor uns liegt.
  let stepIndex = -1;
  let distanceToManeuverM: number | null = null;
  for (let i = 0; i < leg.steps.length; i++) {
    if (leg.steps[i].alongM > alongM) {
      stepIndex = i;
      distanceToManeuverM = leg.steps[i].alongM - alongM;
      break;
    }
  }

  // Fahrtrichtung: über der Geh-Schwelle der echte Kompass/Kurs des Geräts, sonst (im
  // Stand, an der Ampel) die Richtung der Route an der aktuellen Stelle – sonst würde die
  // Karte im Stillstand nach dem letzten Zufalls-Heading zappeln.
  const segA = nearest ? leg.geometry[nearest.segIndex] : null;
  const segB = nearest ? leg.geometry[Math.min(nearest.segIndex + 1, leg.geometry.length - 1)] : null;
  const routeBearing = segA && segB ? bearingBetween(segA, segB) : state.bearingDeg;
  const rawHeading =
    fix.speedMps != null && fix.speedMps > NAV.MOVING_MPS && fix.headingDeg != null
      ? fix.headingDeg
      : routeBearing;
  const targetBearing = unwrapDegrees(state.bearingDeg, rawHeading);
  const bearingDeg =
    (((state.bearingDeg + NAV.HEADING_EMA * (targetBearing - state.bearingDeg)) % 360) + 360) % 360;

  // Erster Fix der Etappe: Startpunkt merken. Danach ist movedM die seither zurückgelegte
  // Strecke ENTLANG DER ROUTE, nicht die Luftlinie – wer im Kreis fährt, kommt trotzdem voran.
  const startAlongM = state.startAlongM ?? alongM;
  const movedM = alongM - startAlongM;
  const armed = state.armed || distanceToStopM >= NAV.ARM_M || movedM >= NAV.ARM_MOVED_M;

  const events: NavEvent[] = [];
  let offRouteStreak = state.offRouteStreak;
  let arriveStreak = state.arriveStreak;
  let arrived = state.arrived;
  let lastRerouteAt = state.lastRerouteAt;

  // Ankunft/Off-Route nur mit einem wirklich guten Fix entscheiden – sonst würde ein
  // Fix mit 50m Genauigkeit (unter MAX_ACCURACY_M, aber grenzwertig) beides auslösen
  // können, nur weil er zufällig in die falsche Richtung streut.
  if (fix.accuracyM <= NAV.DECIDE_ACCURACY_M) {
    if (!arrived) {
      arriveStreak = distanceToStopM <= NAV.ARRIVE_M ? arriveStreak + 1 : 0;
      if (armed && arriveStreak >= NAV.ARRIVE_FIXES) {
        arrived = true;
        events.push({ type: "arrived" });
      }
    }

    if (!arrived) {
      offRouteStreak = crossTrackM > NAV.OFF_ROUTE_M ? offRouteStreak + 1 : 0;
      const cooldownOk = lastRerouteAt == null || fix.at - lastRerouteAt >= NAV.REROUTE_COOLDOWN_MS;
      if (offRouteStreak >= NAV.OFF_ROUTE_FIXES && cooldownOk) {
        offRouteStreak = 0;
        lastRerouteAt = fix.at;
        events.push({ type: "reroute" });
      }
    }
  }

  return {
    state: {
      alongM,
      crossTrackM,
      stepIndex,
      distanceToManeuverM,
      distanceToStopM,
      bearingDeg,
      offRouteStreak,
      arriveStreak,
      armed,
      startAlongM,
      arrived,
      lastFixAt: fix.at,
      lastFixCoord: here,
      lastRerouteAt,
    },
    events,
  };
}
