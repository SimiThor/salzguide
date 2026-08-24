"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  stepNav,
  initNavState,
  resetForNewLeg,
  type NavState,
  type NavLeg,
  type GeoFix,
} from "./bike-nav-core";
import { fetchBikeLeg, type BikeLegError } from "./bike-directions";
import { useLatestRef } from "./use-latest-ref";

export type BikeNavStatus = "idle" | "loading-leg" | "ready" | "leg-error";

export type UseBikeNavigation = {
  status: BikeNavStatus;
  legError: BikeLegError | null;
  currentStopIndex: number;
  leg: NavLeg | null;
  nav: NavState;
  rerouting: boolean;
  arrivedIndex: number | null;
  // Nach dem Schliessen des Ankunfts-Sheets: eine Etappe weiter.
  advance: () => void;
  // Nach einem Fehler erneut versuchen (gleicher Stopp, aktuelle Position).
  retry: () => void;
};

// Verbindet den reinen Kern (bike-nav-core.ts) mit echten GPS-Fixen und der Directions-
// API: holt bei Bedarf eine neue Etappe (erster Start, Ankunft -> nächster Stopp,
// Reroute-Ereignis) und schickt jeden Fix durch stepNav(). `stops` sind die Tour-Stopps
// in Reihenfolge als [lng,lat] – die Etappen-Ziele.
export function useBikeNavigation(
  stops: [number, number][],
  fix: GeoFix | null,
  locale: string,
): UseBikeNavigation {
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [leg, setLeg] = useState<NavLeg | null>(null);
  const [status, setStatus] = useState<BikeNavStatus>("idle");
  const [legError, setLegError] = useState<BikeLegError | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [navSnapshot, setNavSnapshot] = useState<NavState>(() => initNavState());
  const [arrivedIndex, setArrivedIndex] = useState<number | null>(null);

  // Kanonischer Zustand in Refs: der Fix-Effekt unten läuft bei JEDEM neuen Fix und darf
  // dabei nie einen veralteten Stand aus einem React-Closure lesen (siehe useLatestRef.ts
  // für dieselbe Begründung bei SpotMap). Die State-Variablen oben sind nur fürs Rendern.
  const navRef = useRef<NavState>(navSnapshot);
  const legRef = useLatestRef(leg);
  const stopIndexRef = useLatestRef(currentStopIndex);
  const stopsRef = useLatestRef(stops);
  const localeRef = useLatestRef(locale);
  const fixRef = useLatestRef(fix);

  const reqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // `originFix` ist der VOLLE Fix (nicht nur [lng,lat]): sobald die Etappe da ist, wird
  // sofort ein stepNav()-Durchlauf damit gerechnet (siehe unten) – ohne das blieb
  // distanceToStopM/bearingDeg auf ihren initNavState()-Anfangswerten (u.a. Infinity)
  // stehen, bis zufällig der NÄCHSTE GPS-Fix hereinkam. Der Fix-Effekt weiter unten
  // reagiert nur auf einen GEÄNDERTEN `fix`, nicht auf eine neu geladene Etappe – bei
  // langsamem GPS-Takt (oder im Test ganz ohne Bewegung) zeigte die HUD-Leiste bis
  // dahin "Ankunft in Infinity Min".
  const loadLeg = useCallback(
    (originFix: GeoFix, stopIndex: number, isReroute: boolean) => {
      const target = stopsRef.current[stopIndex];
      if (!target) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const myReq = ++reqRef.current;
      if (isReroute) setRerouting(true);
      else setStatus("loading-leg");
      setLegError(null);
      void fetchBikeLeg([originFix.lng, originFix.lat], target, localeRef.current, ac.signal)
        .then((r) => {
          if (myReq !== reqRef.current) return; // veraltete Antwort verwerfen
          setRerouting(false);
          if (r.ok) {
            // Sofort mit dem AUSLÖSENDEN Fix rechnen statt auf den nächsten zu warten.
            // Ereignisse aus diesem einen Schritt bleiben bewusst unbeachtet:
            // resetForNewLeg setzt armed=false, eine frische Etappe kann also nicht im
            // selben Schritt schon "angekommen" melden (siehe bike-nav-core.ts), und
            // ein Reroute direkt nach dem Laden der Etappe wäre kein sinnvoller
            // Zustand, sondern ein Anzeichen für einen Fehler in der Geometrie.
            const seeded = stepNav(resetForNewLeg(navRef.current), originFix, r.leg);
            navRef.current = seeded.state;
            setNavSnapshot(seeded.state);
            setLeg(r.leg);
            setStatus("ready");
          } else {
            setLegError(r.error);
            setStatus((s) => (s === "ready" ? s : "leg-error"));
          }
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (myReq !== reqRef.current) return;
          setRerouting(false);
          setLegError("network");
          setStatus((s) => (s === "ready" ? s : "leg-error"));
        });
    },
    [stopsRef, localeRef],
  );

  // Erste Etappe, sobald der erste Fix da ist (nicht früher – ohne Startposition gibt
  // es nichts zu routen).
  const startedRef = useRef(false);
  useEffect(() => {
    if (!fix || startedRef.current) return;
    startedRef.current = true;
    loadLeg(fix, 0, false);
  }, [fix, loadLeg]);

  // Jeden neuen Fix durch den reinen Kern schicken. Bewusst nur `fix` als Abhängigkeit:
  // alles andere kommt aus Refs, sonst würde jedes setNavSnapshot den Effekt erneut
  // auslösen (derselbe Fix ein zweites Mal ausgewertet).
  useEffect(() => {
    if (!fix || !legRef.current) return;
    const r = stepNav(navRef.current, fix, legRef.current);
    navRef.current = r.state;
    setNavSnapshot(r.state);
    for (const ev of r.events) {
      if (ev.type === "arrived") setArrivedIndex(stopIndexRef.current);
      else if (ev.type === "reroute") loadLeg(fix, stopIndexRef.current, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  const advance = useCallback(() => {
    const next = stopIndexRef.current + 1;
    setArrivedIndex(null);
    setCurrentStopIndex(next);
    const f = fixRef.current;
    if (f && stopsRef.current[next]) loadLeg(f, next, false);
  }, [loadLeg, stopIndexRef, stopsRef, fixRef]);

  const retry = useCallback(() => {
    const f = fixRef.current;
    if (f) loadLeg(f, stopIndexRef.current, rerouting);
  }, [loadLeg, stopIndexRef, rerouting, fixRef]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    status,
    legError,
    currentStopIndex,
    leg,
    nav: navSnapshot,
    rerouting,
    arrivedIndex,
    advance,
    retry,
  };
}
