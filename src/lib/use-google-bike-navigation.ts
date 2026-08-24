"use client";

// ═══ TESTHAKEN – NICHT DAUERHAFT ═══
// 1:1 dasselbe Muster wie use-bike-navigation.ts (Mapbox), nur der Leg-Fetch kommt aus
// google-bike-directions.ts statt bike-directions.ts. Der reine Kern (bike-nav-core.ts:
// Ankunft/Off-Route/Fahrtrichtung) ist UNVERÄNDERT derselbe Import – die Entscheidungslogik
// hängt an keiner Karten-API, nur an GPS-Fixen und einer Etappen-Geometrie.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  stepNav,
  initNavState,
  resetForNewLeg,
  type NavState,
  type NavLeg,
  type GeoFix,
} from "./bike-nav-core";
import { fetchGoogleBikeLeg, type GoogleBikeLegError } from "./google-bike-directions";
import { useLatestRef } from "./use-latest-ref";

export type GoogleBikeNavStatus = "idle" | "loading-leg" | "ready" | "leg-error";

export type UseGoogleBikeNavigation = {
  status: GoogleBikeNavStatus;
  legError: GoogleBikeLegError | null;
  currentStopIndex: number;
  leg: NavLeg | null;
  nav: NavState;
  rerouting: boolean;
  arrivedIndex: number | null;
  advance: () => void;
  retry: () => void;
};

export function useGoogleBikeNavigation(
  stops: [number, number][],
  fix: GeoFix | null,
  apiKey: string,
): UseGoogleBikeNavigation {
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [leg, setLeg] = useState<NavLeg | null>(null);
  const [status, setStatus] = useState<GoogleBikeNavStatus>("idle");
  const [legError, setLegError] = useState<GoogleBikeLegError | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [navSnapshot, setNavSnapshot] = useState<NavState>(() => initNavState());
  const [arrivedIndex, setArrivedIndex] = useState<number | null>(null);

  const navRef = useRef<NavState>(navSnapshot);
  const legRef = useLatestRef(leg);
  const stopIndexRef = useLatestRef(currentStopIndex);
  const stopsRef = useLatestRef(stops);
  const apiKeyRef = useLatestRef(apiKey);
  const fixRef = useLatestRef(fix);

  const reqRef = useRef(0);

  const loadLeg = useCallback(
    (originFix: GeoFix, stopIndex: number, isReroute: boolean) => {
      const target = stopsRef.current[stopIndex];
      if (!target) return;
      const myReq = ++reqRef.current;
      if (isReroute) setRerouting(true);
      else setStatus("loading-leg");
      setLegError(null);
      void fetchGoogleBikeLeg([originFix.lng, originFix.lat], target, apiKeyRef.current).then(
        (r) => {
          if (myReq !== reqRef.current) return; // veraltete Antwort verwerfen
          setRerouting(false);
          if (r.ok) {
            const seeded = stepNav(resetForNewLeg(navRef.current), originFix, r.leg);
            navRef.current = seeded.state;
            setNavSnapshot(seeded.state);
            setLeg(r.leg);
            setStatus("ready");
          } else {
            setLegError(r.error);
            setStatus((s) => (s === "ready" ? s : "leg-error"));
          }
        },
      );
    },
    [stopsRef, apiKeyRef],
  );

  const startedRef = useRef(false);
  useEffect(() => {
    if (!fix || startedRef.current) return;
    startedRef.current = true;
    loadLeg(fix, 0, false);
  }, [fix, loadLeg]);

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
