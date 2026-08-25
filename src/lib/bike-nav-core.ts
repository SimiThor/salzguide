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
  // Play-Knopf erscheint: 40 Sekunden Vorlauf bei 18 km/h.
  //
  // Waren 150 m, also 30 Sekunden. Der Grund fuer die Anhebung ist nicht Grosszuegigkeit,
  // sondern MANEUVER_QUIET_M: Liegt eine Abbiegung im Angebotsfenster, bleiben von 150 m
  // nur 10 m nutzbares Fenster uebrig, und der Knopf blitzt kurz auf oder gar nicht. Mit
  // 200 m bleiben 60 m, also gut 12 Sekunden zum Draufdruecken.
  SPOT_NEAR_M: 200,
  SPOT_PASSED_M: 100, // so weit dahinter gilt der Spot als vorbei, auch ungehört
  // Kulanz für einen Spot, der wegen einer Sperrzone noch nie angeboten werden KONNTE.
  // In einer Gasse mit Abbiegungen alle 80 m liegt sein ganzes Fenster in der Sperrzone,
  // er wäre sonst stumm durchgelaufen. So bekommt der Gast die Geschichte wenigstens kurz
  // nach dem Ort noch angeboten, statt gar nicht. Danach ist er wirklich verpasst.
  SPOT_GRACE_M: 250,
  // Kein Play-Knopf, solange eine Abbiegung so nah bevorsteht: Wer gleich abbiegt, soll
  // nicht im selben Moment eine Geschichte angeboten bekommen (Sicherheitsregel docs/40).
  // Der Knopf kommt danach, der Spot geht dadurch nicht verloren.
  MANEUVER_QUIET_M: 140,
  // Wie weit der Fortschritt hinter seinen Höchststand zurückfallen darf. Er begrenzt das
  // Suchfenster nach UNTEN (geo.ts, minAlongM) und ist der Riegel gegen Stichwege: Dort
  // liegen Hin- und Rückweg übereinander, die Suche nimmt bei gleichem Abstand den
  // Hinweg, und ohne Boden wandert das Fenster Fix für Fix weiter zurück. 40 m deckt
  // GPS-Rauschen längs der Fahrtrichtung ab, ohne die Kette zuzulassen.
  BACKTRACK_M: 40,

  // ——— Ende der Runde ———
  FINISH_M: 35, // so nah am Ende gilt die Runde als gefahren
  FINISH_FIXES: 2, // ...aber erst nach so vielen guten Fixen hintereinander
  // Wie nah der Fortschritt VORHER schon am Ende gelegen haben muss. Ein Sprung von der
  // halben Runde auf 20 m Rest ist per Definition kein Zieleinlauf, sondern ein
  // fehlgeschnappter Fix. Auf einer Rundtour liegt das Ende am Start, dort sieht jeder
  // Ausreisser in Startnaehe wie ein Ziel aus.
  FINISH_APPROACH_M: 250,
  // Hysterese: So weit muss man sich wieder entfernen, damit "gefahren" zurueckgenommen
  // wird. Ohne das flackert die Anzeige am Ziel, mit einem klebrigen Wert dagegen ist
  // jeder Fehlalarm ein Totalausfall mitten auf dem Rad.
  FINISH_RELEASE_M: 90,

  // Wie weit der Fortschritt in EINEM Schritt hoechstens springen darf. Gerechnet aus der
  // verstrichenen Zeit, aber gedeckelt: Nach einer langen Ortungsluecke (Safari drosselt
  // bei gesperrtem Bildschirm) wissen wir ohnehin nicht mehr, wo der Gast ist. Dann ist
  // die sichere Antwort, beim alten Stand zu bleiben und die Off-Route-Erkennung eine
  // Neuberechnung ab der echten Position ausloesen zu lassen, statt blind auf einen
  // fernen Ast der Runde zu springen. Genau dort lag der schwerste Fehler: Ein einziger
  // Fix in Startnaehe liess eine Rundtour auf alongM 1579 springen, verbuchte vier Spots
  // auf einen Schlag und meldete "Runde geschafft" nach 200 gefahrenen Metern.
  MAX_JUMP_M: 400,
  JUMP_SLACK_M: 50, // Zugabe auf das Zeitbudget, fuer Rauschen und Snapping

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
  /**
   * Die NAECHSTE Abbiegung, wenn sie weniger als 50 m dahinter liegt (lib/nav-steps.ts).
   * Die Oberflaeche haengt sie als "dann" an die Ansage, damit der Gast nicht "rechts"
   * hoert und zwanzig Meter spaeter ueberrascht vor der naechsten Kreuzung steht.
   * Sie bleibt trotzdem ein eigener Schritt in der Liste, es geht nichts verloren.
   */
  followedBy?: { type: string; modifier?: string };
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
// "pending" = in Reichweite, aber der Play-Knopf wartet noch (Sperrzone vor einer
// Abbiegung). Ohne diesen Zwischenschritt ging der Spot verloren: Der Uebergang zu "near"
// war blockiert, wurde nirgends gemerkt, und der Spot lief stumm von "open" auf "done".
export type SpotPhase = "open" | "pending" | "near" | "done";

export type NavState = {
  alongM: number;
  // Höchststand des Fortschritts. Nur dieser Wert verankert den Boden des Suchfensters;
  // alongM selbst darf kurz zurückfallen (Rauschen), das Fenster nicht.
  maxAlongM: number;
  crossTrackM: number;
  stepIndex: number; // -1 = keine weitere Abbiegung bekannt
  distanceToManeuverM: number | null;
  bearingDeg: number; // geglättete Fahrtrichtung fürs Karten-Bearing
  offRouteStreak: number;
  spotPhase: SpotPhase[];
  nextSpotIndex: number; // nächster noch nicht abgehakter Spot, -1 = keiner mehr
  distanceToNextSpotM: number | null; // entlang der Route, nicht Luftlinie
  remainingM: number; // bis zum Ende der Runde
  finishStreak: number; // so viele gute Fixe hintereinander in Zielnaehe
  finished: boolean;
  lastFixAt: number | null;
  lastFixCoord: [number, number] | null;
  lastRerouteAt: number | null;
};

export function initNavState(spotCount = 0): NavState {
  return {
    alongM: 0,
    maxAlongM: 0,
    crossTrackM: 0,
    stepIndex: -1,
    distanceToManeuverM: null,
    bearingDeg: 0,
    offRouteStreak: 0,
    spotPhase: Array.from({ length: spotCount }, () => "open" as SpotPhase),
    nextSpotIndex: spotCount > 0 ? 0 : -1,
    distanceToNextSpotM: null,
    remainingM: 0,
    finishStreak: 0,
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
  // Fahrtrichtung für die Segment-Wahl (geo.ts). Zwei Quellen, in dieser Reihenfolge:
  //
  //   1. Der Kurs des Geräts, aber nur über der Geh-Schwelle. Im Stand liefert es
  //      entweder nichts oder einen Zufallswert, und ein Zufallswert wäre hier schlimmer
  //      als keiner: Er bestrafte das richtige Segment.
  //   2. Sonst der Kurs über Grund, gerechnet aus den letzten beiden Messpunkten. Der
  //      braucht keinen Kompass, und das ist der Punkt: iOS liefert `heading` in der
  //      Geolocation-API häufig gar nicht. Ohne diesen zweiten Weg griffe die
  //      Stichweg-Absicherung ausgerechnet auf den Geräten nicht, für die sie gebaut ist.
  //
  // NICHT verwendet wird die Richtung der Route an der aktuellen Stelle (rawHeading
  // weiter unten). Die stammt aus dem Segment, das hier erst bestimmt werden soll.
  // 3 m als Untergrenze, nicht 5: Bei 18 km/h und einem Fix je Sekunde liegen die Punkte
  // rund 5 m auseinander, und mit 5 als Schwelle fiel jeder zweite Schritt knapp darunter
  // durch. Unter 3 m ist die Richtung zwischen zwei Punkten nur noch Rauschen.
  const gefahrenM = state.lastFixCoord ? haversineMeters(state.lastFixCoord, here) : 0;
  const kursUeberGrund =
    state.lastFixCoord && gefahrenM >= 3 ? bearingBetween(state.lastFixCoord, here) : undefined;
  const headingForMatch =
    fix.headingDeg != null && (fix.speedMps ?? 0) >= NAV.MOVING_MPS
      ? fix.headingDeg
      : kursUeberGrund;

  const nearest = nearestPointOnRoute(route.geometry, here, {
    nearAlongM: state.alongM,
    // Boden am Höchststand: siehe NAV.BACKTRACK_M und die Begründung in geo.ts.
    minAlongM: state.maxAlongM - NAV.BACKTRACK_M,
    headingDeg: headingForMatch,
  });
  const crossTrackM = nearest?.crossTrackM ?? state.crossTrackM;

  // Stetigkeits-Riegel: Der Fortschritt darf nur so weit springen, wie in der vergangenen
  // Zeit fahrbar war. Ohne ihn reicht EIN Fix, um auf einen ganz anderen Ast der Runde zu
  // rutschen, sobald nearestPointOnRoute auf die globale Suche zurueckfaellt (geo.ts) --
  // und auf einer Rundtour liegt das Ende am Start, das Sprungziel ist also ausgerechnet
  // die Ziellinie. Wird der Sprung verworfen, bleibt der alte Fortschritt stehen und
  // crossTrackM bleibt gross: Die vorhandene Entprellung loest dann nach drei Fixen eine
  // Neuberechnung ab der echten Position aus. Das ist die saubere Selbstheilung.
  const dtS = state.lastFixAt != null ? Math.max(0, (fix.at - state.lastFixAt) / 1000) : 0;
  const maxJumpM =
    state.lastFixAt == null
      ? Infinity // erster Fix der Route: es gibt noch nichts, wovon er springen koennte
      : Math.min(NAV.MAX_JUMP_M, dtS * NAV.MAX_SPEED_MPS + NAV.JUMP_SLACK_M);
  const proposedAlongM = nearest?.alongM ?? state.alongM;
  const alongM =
    Math.abs(proposedAlongM - state.alongM) > maxJumpM ? state.alongM : proposedAlongM;

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
  // Der Play-Knopf wartet, solange gleich eine Abbiegung kommt (Sicherheitsregel docs/40).
  // "arrive" zählt dabei NICHT als Abbiegung: Ankommen ist nichts, in das man einfährt,
  // aber der Schritt steht am Ende jeder Route und deckte damit ihre letzten 140 m zu.
  // Weil bike-directions.ts den letzten Spot per Definition auf die Routenlänge legt,
  // wurde der letzte Spot JEDER Runde nie angeboten.
  const step = stepIndex >= 0 ? route.steps[stepIndex] : null;
  const maneuverClose =
    step != null &&
    step.type !== "arrive" &&
    distanceToManeuverM != null &&
    distanceToManeuverM <= NAV.MANEUVER_QUIET_M;

  // 1. Was hinter uns liegt, ist erledigt, gehört oder nicht.
  for (let i = 0; i < spotPhase.length; i++) {
    const spotAt = route.spotAlongM[i];
    if (spotAt == null) continue;
    // Ein vorgemerkter Spot, der nie angeboten werden konnte, bekommt mehr Zeit.
    const behindLimit = spotPhase[i] === "pending" ? NAV.SPOT_GRACE_M : NAV.SPOT_PASSED_M;
    if (spotPhase[i] !== "done" && spotAt - alongM < -behindLimit) {
      spotPhase[i] = "done";
      events.push({ type: "spot-passed", index: i });
    }
  }

  // 2. Was in Reichweite kommt, wird vorgemerkt. Auch während einer Sperrzone: Der
  //    gemerkte Zustand ist genau das, was vorher fehlte. Vorher blieb der Spot "open",
  //    die Sperrzone hielt bis hinter ihn an, und er lief stumm auf "done".
  for (let i = 0; i < spotPhase.length; i++) {
    const spotAt = route.spotAlongM[i];
    if (spotAt == null) continue;
    // Auch Spots, die schon knapp hinter uns liegen: Wer in der Sperrzone an einem
    // vorbeigefahren ist, soll ihn noch angeboten bekommen (SPOT_GRACE_M oben).
    if (spotPhase[i] === "open" && spotAt - alongM <= NAV.SPOT_NEAR_M) {
      spotPhase[i] = "pending";
    }
  }

  // 3. Angeboten wird HÖCHSTENS EINER je Schritt, und zwar der nächstgelegene (die
  //    Offsets sind aufsteigend, also der erste vorgemerkte). Zwei Angebote in einem
  //    Schritt kann die Oberfläche gar nicht zeigen: Sie hat einen Streifen, das zweite
  //    überschrieb das erste, und der übergangene Spot konnte nie wieder auslösen.
  //    Solange noch ein Angebot offen steht, rückt der nächste nicht nach.
  if (!maneuverClose && !spotPhase.includes("near")) {
    const next = spotPhase.findIndex((p) => p === "pending");
    if (next >= 0) {
      spotPhase[next] = "near";
      events.push({ type: "spot-near", index: next });
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

  // ——— Ende der Runde ————————————————————————————————————————————————————————
  // Frueher stand hier `state.finished || remainingM <= FINISH_M`: ein einziger Fix, fuer
  // immer klebend, und er sperrte zusaetzlich die Neuberechnung. Auf einer Rundtour reichte
  // damit ein Ausreisser in Startnaehe, um die Fahrt nach 200 Metern zu beenden, ohne Weg
  // zurueck. Jetzt drei Bedingungen, und alle drei sind noetig:
  //   ein wirklich sauberer Fix (schlechte werden gar nicht erst gezaehlt),
  //   der Fortschritt lag VORHER schon in Zielnaehe (ein Sprung ist kein Zieleinlauf),
  //   und das ueber mehrere Fixe hintereinander.
  const nearFinish = remainingM <= NAV.FINISH_M;
  const approached = state.remainingM <= NAV.FINISH_M + NAV.FINISH_APPROACH_M || state.finished;
  const finishStreak =
    nearFinish && approached && fix.accuracyM <= NAV.DECIDE_ACCURACY_M ? state.finishStreak + 1 : 0;
  // Reversibel mit Hysterese: Wer sich wieder deutlich entfernt, faehrt weiter. Ohne das
  // waere jeder Fehlalarm endgueltig.
  const finished = state.finished
    ? remainingM <= NAV.FINISH_RELEASE_M
    : finishStreak >= NAV.FINISH_FIXES;

  // Die Neuberechnung haengt BEWUSST nicht mehr an `finished`: Ein falsches "fertig" darf
  // nicht auch noch die einzige Selbstheilung abschalten. Sie ruht nur, wenn der Gast
  // wirklich am Ziel steht, und das heisst hier: nah dran UND kein Spot mehr offen.
  const reallyDone = finished && nextSpotIndex < 0;

  if (fix.accuracyM <= NAV.DECIDE_ACCURACY_M && !reallyDone) {
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
      // Der Höchststand geht nur nach oben. Er verankert den Boden des Suchfensters beim
      // nächsten Fix, damit ein Stichweg das Fenster nicht rückwärts wandern lässt.
      maxAlongM: Math.max(state.maxAlongM, alongM),
      crossTrackM,
      stepIndex,
      distanceToManeuverM,
      bearingDeg,
      offRouteStreak,
      spotPhase,
      nextSpotIndex,
      distanceToNextSpotM,
      remainingM,
      finishStreak,
      finished,
      lastFixAt: fix.at,
      lastFixCoord: here,
      lastRerouteAt,
    },
    events,
  };
}
