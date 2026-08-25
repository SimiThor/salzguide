"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  stepNav,
  initNavState,
  resetForNewRoute,
  type NavState,
  type NavRoute,
  type GeoFix,
  type SpotPhase,
} from "./bike-nav-core";
import { fetchBikeRoute, type BikeRoute, type BikeLegError } from "./bike-directions";
import { useLatestRef } from "./use-latest-ref";

export type BikeNavStatus = "idle" | "loading" | "ready" | "error";

export type UseBikeNavigation = {
  status: BikeNavStatus;
  error: BikeLegError | null;
  route: BikeRoute | null;
  nav: NavState;
  // Welcher Tour-Stopp steckt an welcher Stelle der AKTUELLEN Route? Nach einer
  // Neuberechnung enthält die Route nur noch die offenen Spots, die Positionen
  // verschieben sich also. Diese Liste ist die Brücke zurück auf die Tour.
  spotIds: number[];
  // Der Stopp, für den gerade der Play-Knopf gilt (Index in der Tour), oder null.
  offeredSpotId: number | null;
  // Angebot wegtippen, ohne den Spot als gehört zu markieren.
  dismissOffer: () => void;
  rerouting: boolean;
  finished: boolean;
  // Das Ende der Runde zuruecknehmen. Der Kern entscheidet inzwischen entprellt und
  // plausibel (bike-nav-core), aber kein Verfahren ist unfehlbar: Wer faelschlich am Ziel
  // steht, muss weiterfahren koennen, statt mitten in der Stadt ohne Fuehrung dazustehen.
  clearFinished: () => void;
  retry: () => void;
};

// Eine hängende Anfrage darf den Gast nicht dauerhaft im Ladezustand stehen lassen. 15
// Sekunden sind grosszügig für eine Directions-Antwort und kurz genug, dass ein Radl an
// der Kreuzung nicht ratlos wartet.
const FETCH_TIMEOUT_MS = 15_000;
// Nach einem Fehler von selbst nachfassen: Auf dem Rad ist "tippe hier, um es erneut zu
// versuchen" die falsche Antwort, der Gast hat die Hände am Lenker. Abstände wachsen,
// damit ein längerer Funkloch-Abschnitt nicht zu Dauerfeuer wird.
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];

export function useBikeNavigation(
  // Alle Stopps der Runde in Reihenfolge, als [lng,lat].
  stops: [number, number][],
  fix: GeoFix | null,
  locale: string,
  // Ziel der Runde, falls es nicht der letzte Stopp ist (Migration 0061, tours.end_lat/lng).
  // Bei einer Rundtour ist das der Startpunkt. Ohne ihn endet die Navigation am letzten
  // Stopp, und bei Runde A liegt der 692 m vom Leihrad entfernt.
  end?: [number, number] | null,
): UseBikeNavigation {
  const [route, setRoute] = useState<BikeRoute | null>(null);
  const [spotIds, setSpotIds] = useState<number[]>(() => stops.map((_, i) => i));
  const [status, setStatus] = useState<BikeNavStatus>("idle");
  const [error, setError] = useState<BikeLegError | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [navSnapshot, setNavSnapshot] = useState<NavState>(() => initNavState(stops.length));
  const [offeredSpotId, setOfferedSpotId] = useState<number | null>(null);

  // Kanonischer Zustand in Refs: der Fix-Effekt unten läuft bei JEDEM neuen Fix und darf
  // dabei nie einen veralteten Stand aus einem React-Closure lesen.
  const navRef = useRef<NavState>(navSnapshot);
  const routeRef = useLatestRef(route);
  const spotIdsRef = useLatestRef(spotIds);
  const stopsRef = useLatestRef(stops);
  const localeRef = useLatestRef(locale);
  // Wie locale: Der Zielpunkt aendert sich waehrend einer Fahrt nicht, und als echte
  // Abhaengigkeit von loadRoute wuerde ein bei jedem Render neu erzeugtes Array-Literal
  // aus der Elternkomponente eine Neuberechnung ausloesen.
  const endRef = useLatestRef(end ?? null);
  const fixRef = useLatestRef(fix);

  const reqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; attempt: number }>({
    timer: null,
    attempt: 0,
  });

  // Ref auf loadRoute selbst, damit die Wiederholung unten sich rekursiv aufrufen kann,
  // ohne dass eine der beiden Funktionen vor der anderen deklariert sein müsste.
  const loadRouteRef = useRef<((f: GeoFix, keep: number[], phases: SpotPhase[], reroute: boolean) => void) | null>(null);

  const clearRetry = useCallback(() => {
    if (retryRef.current.timer) clearTimeout(retryRef.current.timer);
    retryRef.current = { timer: null, attempt: 0 };
  }, []);

  // Ereignisse aus einem Rechenschritt anwenden. Bewusst geteilt zwischen dem Schritt beim
  // Laden einer Route und dem bei jedem GPS-Signal: Beim Laden entstehen sehr wohl echte
  // Ereignisse (der erste Spot liegt oft direkt am Start und wird sofort angeboten), und
  // sie zu verwerfen hiess, dass der Play-Knopf nie erschien. Genau das ist im ersten
  // Browser-Test aufgefallen, obwohl der Kern und alle Prüfungen grün waren.
  //
  // `allowReroute` trennt die beiden Fälle: Eine gerade geladene Route darf nicht im
  // selben Atemzug eine neue anfordern, das wäre eine Schleife.
  const applyEvents = useCallback(
    (events: readonly { type: string; index?: number }[], atFix: GeoFix, allowReroute: boolean) => {
      for (const ev of events) {
        if (ev.type === "spot-near" && ev.index != null) {
          setOfferedSpotId(spotIdsRef.current[ev.index] ?? null);
        } else if (ev.type === "spot-passed" && ev.index != null) {
          // Das Angebot verschwindet mit dem Spot, für den es galt. Läuft das Audio noch,
          // bleibt es laufen (der Player lebt in BikeNavScreen, nicht hier).
          const id = spotIdsRef.current[ev.index];
          setOfferedSpotId((cur) => (cur === id ? null : cur));
        } else if (ev.type === "reroute" && allowReroute) {
          const phases = navRef.current.spotPhase;
          const keep = spotIdsRef.current.filter((_, i) => phases[i] !== "done");
          const keptPhases = phases.filter((p) => p !== "done");
          if (keep.length > 0) loadRouteRef.current?.(atFix, keep, keptPhases, true);
        }
      }
    },
    [spotIdsRef],
  );

  // Route holen: beim Start über alle Stopps, nach einer Neuberechnung nur noch über die
  // offenen. `keep` sind die Tour-Indizes, die in die Anfrage gehen.
  const loadRoute = useCallback(
    (originFix: GeoFix, keep: number[], keptPhases: SpotPhase[], isReroute: boolean) => {
      const targets = keep.map((id) => stopsRef.current[id]).filter(Boolean) as [number, number][];
      if (targets.length === 0) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const timeout = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      const myReq = ++reqRef.current;

      if (isReroute) setRerouting(true);
      else setStatus("loading");
      setError(null);

      // Von selbst nachfassen statt auf einen Tipp zu warten: Auf dem Rad hat der Gast
      // die Hände am Lenker. Beim Nachfassen wird der AKTUELLE Fix genommen, nicht der
      // alte – in zwanzig Sekunden ist er weitergefahren, und eine Route ab seiner
      // Position von vorhin würde ihn zurückschicken.
      const retryLater = () => {
        const attempt = retryRef.current.attempt;
        if (attempt >= RETRY_DELAYS_MS.length) return; // danach hilft nur noch der Knopf
        if (retryRef.current.timer) clearTimeout(retryRef.current.timer);
        retryRef.current = {
          attempt: attempt + 1,
          timer: setTimeout(() => {
            // Position UND Spot-Liste frisch nehmen, nicht die von vorhin. In zwanzig
            // Sekunden fährt ein Radl 350 m: Er ist weiter, und er kann inzwischen an
            // einem Spot vorbei sein. Mit den eingefrorenen Werten schickte ihn die neue
            // Route zu einem Stopp zurück, den er schon hinter sich hatte.
            const f = fixRef.current ?? originFix;
            const phases = navRef.current.spotPhase;
            const stillOpen = spotIdsRef.current.filter((_, i) => phases[i] !== "done");
            const openPhases = phases.filter((ph) => ph !== "done");
            loadRouteRef.current?.(
              f,
              stillOpen.length ? stillOpen : keep,
              stillOpen.length ? openPhases : keptPhases,
              isReroute,
            );
          }, RETRY_DELAYS_MS[attempt]),
        };
      };

      void fetchBikeRoute(
        [originFix.lng, originFix.lat],
        targets,
        localeRef.current,
        ac.signal,
        endRef.current,
      )
        .then((r) => {
          clearTimeout(timeout);
          if (myReq !== reqRef.current) return; // veraltete Antwort verwerfen
          setRerouting(false);
          if (!r.ok) {
            setError(r.error);
            setStatus((s) => (s === "ready" ? s : "error"));
            retryLater();
            return;
          }
          clearRetry();
          // Sofort mit dem AUSLÖSENDEN Fix rechnen statt auf den nächsten zu warten:
          // sonst stünden Restdistanz und Fahrtrichtung bis zum nächsten GPS-Signal auf
          // ihren Anfangswerten, und die Anzeige zeigte Unsinn.
          const seededBase = resetForNewRoute(navRef.current, keptPhases);
          const seeded = stepNav(seededBase, originFix, toNavRoute(r.route));
          navRef.current = seeded.state;
          setNavSnapshot(seeded.state);
          setRoute(r.route);
          setSpotIds(keep);
          setStatus("ready");
          // Erst NACH setSpotIds anwenden: applyEvents schlägt den Tour-Index über
          // spotIdsRef nach, und die Ref zeigt in diesem Tick noch auf die alte Liste.
          spotIdsRef.current = keep;
          applyEvents(seeded.events, originFix, false);
        })
        .catch((err: unknown) => {
          clearTimeout(timeout);
          if (myReq !== reqRef.current) return;
          setRerouting(false);
          // Ein Abbruch durch die Zeitüberschreitung sieht aus wie ein Abbruch durch eine
          // neuere Anfrage. Unterschieden wird über reqRef oben: kommen wir hier an, war
          // es die Zeitüberschreitung, und dann gehört nachgefasst.
          if (err instanceof DOMException && err.name === "AbortError" && ac.signal.aborted) {
            setError("network");
            setStatus((s) => (s === "ready" ? s : "error"));
            retryLater();
            return;
          }
          setError("network");
          setStatus((s) => (s === "ready" ? s : "error"));
          retryLater();
        });
    },
    [stopsRef, localeRef, endRef, clearRetry, fixRef, spotIdsRef, applyEvents],
  );

  // Die Ref auf den aktuellen Stand bringen, damit eine Wiederholung nicht eine alte
  // Fassung aufruft.
  useEffect(() => {
    loadRouteRef.current = loadRoute;
  }, [loadRoute]);

  // Erste Route, sobald der erste Fix da ist (vorher gibt es nichts zu routen).
  const startedRef = useRef(false);
  useEffect(() => {
    if (!fix || startedRef.current) return;
    startedRef.current = true;
    const all = stopsRef.current.map((_, i) => i);
    loadRoute(fix, all, all.map(() => "open" as SpotPhase), false);
  }, [fix, loadRoute, stopsRef]);

  // Jeden neuen Fix durch den reinen Kern schicken. Bewusst nur `fix` als Abhängigkeit:
  // alles andere kommt aus Refs, sonst würde jedes setNavSnapshot den Effekt erneut
  // auslösen (derselbe Fix ein zweites Mal ausgewertet).
  useEffect(() => {
    const r = routeRef.current;
    if (!fix || !r) return;
    const result = stepNav(navRef.current, fix, toNavRoute(r));
    navRef.current = result.state;
    setNavSnapshot(result.state);

    applyEvents(result.events, fix, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  // Wegtippen hakt den Spot im Kern ab, statt nur das Angebot zu leeren. Sonst bliebe
  // seine Phase auf "near" stehen, und weil der Kern hoechstens EIN Angebot gleichzeitig
  // offen laesst, koennte danach kein weiterer Spot mehr nachruecken. "done" heisst hier
  // "abgehakt", nicht "gehoert" – gezaehlt wird das Gehoerte getrennt (BikeNavScreen).
  const dismissOffer = useCallback(() => {
    const id = offeredSpotId;
    setOfferedSpotId(null);
    if (id == null) return;
    const pos = spotIdsRef.current.indexOf(id);
    if (pos < 0) return;
    const phases = [...navRef.current.spotPhase];
    phases[pos] = "done";
    navRef.current = { ...navRef.current, spotPhase: phases };
    setNavSnapshot(navRef.current);
  }, [offeredSpotId, spotIdsRef]);

  const clearFinished = useCallback(() => {
    navRef.current = { ...navRef.current, finished: false, finishStreak: 0 };
    setNavSnapshot(navRef.current);
  }, []);

  const retry = useCallback(() => {
    const f = fixRef.current;
    if (!f) return;
    clearRetry();
    const phases = navRef.current.spotPhase;
    const keep = spotIdsRef.current.filter((_, i) => phases[i] !== "done");
    const keptPhases = phases.filter((p) => p !== "done");
    loadRouteRef.current?.(f, keep.length ? keep : spotIdsRef.current, keptPhases, false);
  }, [fixRef, spotIdsRef, loadRouteRef, clearRetry]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (retryRef.current.timer) clearTimeout(retryRef.current.timer);
    },
    [],
  );

  return {
    status,
    error,
    route,
    nav: navSnapshot,
    spotIds,
    offeredSpotId,
    dismissOffer,
    rerouting,
    finished: navSnapshot.finished,
    clearFinished,
    retry,
  };
}

// BikeRoute (was der Abruf liefert) und NavRoute (was der Kern braucht) sind bewusst
// getrennt: Der Kern soll nichts über Mapbox wissen. Die Umrechnung ist eine Zeile.
function toNavRoute(r: BikeRoute): NavRoute {
  return {
    geometry: r.geometry,
    steps: r.steps,
    spotAlongM: r.spotAlongM,
    totalM: r.distanceM,
  };
}
