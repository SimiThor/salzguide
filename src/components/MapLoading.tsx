"use client";

import type mapboxgl from "mapbox-gl";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ladeschirm für ALLE Karten der Seite (docs/02 §8).
 *
 * Das Problem: Eine Mapbox-Karte ist erst da, wenn JS geladen, der Style geholt und
 * die ersten Kacheln gezeichnet sind. Bis dahin sah man eine leere Fläche und dachte,
 * die Seite sei kaputt — die Karte poppte dann ohne Vorwarnung hinein.
 *
 * Die Lösung ist dieselbe wie bei den Bildern: eine Platzhalter-Fläche mit Schimmer,
 * dazu ein Balken, der den echten Ladefortschritt der Karte zeigt. Der Schirm liegt
 * ÜBER der Karte und blendet weg, sobald das erste fertige Kartenbild steht.
 *
 * Benutzung (identisch in jeder Karte):
 *
 *   const { bindMap, loading } = useMapLoading();
 *   // im Effekt, direkt nach `new mapboxgl.Map(...)`:
 *   const unbind = bindMap(map);
 *   // im Aufräumen des Effekts:
 *   return () => { unbind(); map.remove(); };
 *   // im Markup, als letztes Kind eines `relative isolate`-Elements:
 *   <MapLoadingScreen {...loading} />
 */

// Wie voll ist der Balken, wenn ein Meilenstein erreicht ist? Mapbox meldet keinen
// Prozentwert, es meldet Ereignisse. Die drei Stufen sind Erfahrungswerte und bewusst
// nicht linear: Der Style kommt schnell, die Kacheln brauchen am längsten.
const FLOOR_START = 0.06; // Karte angelegt
const FLOOR_STYLE = 0.42; // Style geladen
const FLOOR_SOURCE = 0.68; // erste Datenquelle vollständig

// Zwischen den Meilensteinen kriecht der Balken weiter, sonst sähe er hängengeblieben
// aus. Er nähert sich der Obergrenze immer langsamer an und erreicht sie nie — das
// Ende gehört dem echten Ereignis, nicht der Uhr.
const CAP = 0.94;
const TAU_MS = 1400;

// Kürzeste Standzeit. Ohne sie blitzt der Schirm bei warmem Cache nur auf, was
// unruhiger wirkt als gar kein Schirm (gleiche Idee wie in GalleryImage).
const MIN_VISIBLE_MS = 400;

// Ausblenden. Muss zur Klasse `duration-500` unten passen.
const FADE_MS = 500;

// Sicherheitsnetz: Bliebe `idle` je aus (tote Kacheln, kein Netz, WebGL-Zicken), läge
// der Schirm für immer über der Karte. Lieber die halbe Karte zeigen als gar keine.
const SAFETY_MS = 3000;

export type MapLoadingState = {
  /** Karte ist fertig — der Schirm blendet gerade weg. */
  done: boolean;
  /** Ausblenden vorbei — der Schirm ist aus dem DOM. */
  gone: boolean;
  /** Füllung des Balkens; wird pro Frame direkt am DOM gesetzt, nicht über React. */
  barRef: React.RefObject<HTMLDivElement | null>;
};

export function useMapLoading() {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);
  // Timer über das Aufräumen der Komponente hinweg einsammeln: `bindMap` läuft im
  // Karten-Effekt, die letzten beiden Timer laufen aber noch, wenn der schon vorbei ist.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const bindMap = useCallback((map: mapboxgl.Map) => {
    const t0 = performance.now();
    let floor = FLOOR_START;
    let floorAt = t0;
    let shown = 0;
    let raf = 0;
    let finished = false;
    // Timer NUR dieser Karte. Wird die Karte abgebaut, während das Ausblenden schon
    // läuft, dürfen die beiden Nachzügler nicht mehr feuern — sonst räumte eine tote
    // Karte den Schirm einer neu aufgebauten weg.
    const own: ReturnType<typeof setTimeout>[] = [];

    const paint = (v: number) => {
      const bar = barRef.current;
      if (bar) bar.style.transform = `scaleX(${v})`;
    };

    // Ein Frame: aktuellen Sockel nehmen und von dort aus Richtung CAP kriechen.
    // `Math.max` hält den Balken monoton — er darf nie zurückspringen.
    const tick = (now: number) => {
      const crept = floor + (CAP - floor) * (1 - Math.exp(-(now - floorAt) / TAU_MS));
      shown = Math.max(shown, crept);
      paint(shown);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Meilenstein erreicht: Sockel anheben und die Kriechkurve dort neu ansetzen.
    // Sockel = max(Stufe, bereits gezeigt), sonst spränge der Balken zurück.
    const reach = (next: number) => {
      if (finished || next <= floor) return;
      floor = Math.max(next, shown);
      floorAt = performance.now();
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      paint(1);
      const rest = Math.max(0, MIN_VISIBLE_MS - (performance.now() - t0));
      const later = (fn: () => void, ms: number) => {
        const id = setTimeout(fn, ms);
        own.push(id);
        timers.current.push(id);
      };
      later(() => {
        setDone(true);
        later(() => setGone(true), FADE_MS);
      }, rest);
    };

    const onStyle = () => {
      if (map.isStyleLoaded()) reach(FLOOR_STYLE);
    };
    const onSource = (e: mapboxgl.MapSourceDataEvent) => {
      if (e.isSourceLoaded) reach(FLOOR_SOURCE);
    };
    // `idle` statt `load`: load feuert, sobald der Style steht, die erste Kachel aber
    // noch fehlen kann — man blendete auf Grau auf. idle heißt, das Bild ist fertig.
    map.on("styledata", onStyle);
    map.on("sourcedata", onSource);
    map.once("idle", finish);
    const safety = setTimeout(finish, SAFETY_MS);
    own.push(safety);
    timers.current.push(safety);

    return () => {
      cancelAnimationFrame(raf);
      own.forEach(clearTimeout);
      map.off("styledata", onStyle);
      map.off("sourcedata", onSource);
      map.off("idle", finish);
    };
  }, []);

  return { bindMap, loading: { done, gone, barRef } as MapLoadingState };
}

/**
 * Der Schirm selbst. Gehört als LETZTES Kind in ein Element mit `relative isolate`,
 * das die Karte enthält.
 *
 * Warum `isolate`: Mapbox gibt seinen Bedien-Buttons z-index 10 und der
 * Scroll-Schutzfläche 20 (siehe globals.css). Der Schirm braucht also mehr, sonst
 * lägen Buttons darüber. `isolate` sperrt dieses z-30 in den Karten-Kasten ein — die
 * Oberfläche daneben (Schließen-Knopf, Sheets, Kopfzeile) bleibt oben.
 *
 * Warum `pointer-events-none`: Der Schirm darf unter keinen Umständen Eingaben
 * schlucken, auch nicht wenn er wegen eines Fehlers länger liegen bliebe.
 */
export function MapLoadingScreen({ done, gone, barRef }: MapLoadingState) {
  if (gone) return null;
  return (
    <div
      aria-hidden
      className={`sg-map-loading pointer-events-none absolute inset-0 z-30 flex items-center justify-center motion-safe:transition-opacity motion-safe:duration-500 motion-safe:ease-out ${
        done ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="sg-map-shimmer absolute inset-0" />
      <div className="relative h-[3px] w-[104px] overflow-hidden rounded-full bg-black/10">
        <div ref={barRef} className="sg-map-bar h-full w-full rounded-full bg-accent" />
      </div>
    </div>
  );
}
