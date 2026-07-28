"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";

// Auf dem Server gibt es kein Layout, useLayoutEffect warnt dort (gleiche Zeile wie im
// Carousel). Auf dem Client MUSS es der Layout-Effekt sein: Die Position wird VOR dem
// ersten Paint gesetzt, sonst sieht man die Liste kurz oben stehen und dann springen.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Scroll-Gedächtnis für die Desktop-Sidebar und ihre Karussells, das Geschwister von
 * [map-view-memory.ts]: Wer von einer Spot-Seite zurückkommt, findet den Feed genau so
 * vor, wie er ihn verlassen hat — so weit runtergescrollt (vertikal) und jedes Regal so
 * weit durchgeblättert (horizontal) wie vorher.
 *
 * Gleiche Bausteine wie beim Kamera-Gedächtnis, aus denselben Gründen: sessionStorage
 * (pro Tab, überlebt genau die Navigation, neuer Tab startet frisch, nichts geht an den
 * Server) und dieselbe Ablaufzeit, damit sich "die Sitzung" überall gleich anfühlt.
 *
 * NUR AM DESKTOP, ZWEI RIEGEL:
 * Am Handy lebt derselbe Feed im Bottom-Sheet, und dort gehört der Anfang nach oben
 * (Anton-Entscheidung) — außerdem steht der Feed ZWEIMAL im DOM (Sidebar + verstecktes
 * Mobile-Sheet, siehe Explore). Deshalb prüft jede Aktion beides: Desktop-Breakpoint
 * UND sichtbares Layout (clientWidth > 0). Der versteckte Zwilling hat keine Layout-Box
 * und kann so weder eine 0 speichern noch wiederhergestellt werden.
 */
const PREFIX = "sg-scroll:";
const MAX_AGE_MS = 30 * 60 * 1000; // 30 Minuten, wie map-view-memory
const SAVE_DELAY_MS = 200; // Scroll-Events kommen pro Frame; gebündelt reicht völlig

const isDesktop = () =>
  typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;

function readPos(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { pos, at } = v as Record<string, unknown>;
    if (typeof pos !== "number" || !Number.isFinite(pos) || pos < 0) return null;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    if (Date.now() - at > MAX_AGE_MS) return null;
    return pos;
  } catch {
    return null; // sessionStorage nicht verfügbar oder Inhalt unbrauchbar
  }
}

/**
 * Merkt sich die Scroll-Position des Elements in `ref` unter `key` und stellt sie beim
 * nächsten Aufbau wieder her. Ohne `key` vollständig aus (Opt-in wie viewKey an der
 * Karte). `key` muss über die Lebenszeit des Elements stabil sein.
 */
export function useScrollMemory(
  ref: RefObject<HTMLElement | null>,
  key: string | undefined,
  axis: "x" | "y",
) {
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!key || !el) return;

    // Wiederherstellen, nur sichtbar am Desktop. behavior "instant" mit Absicht: Das
    // Karussell trägt scroll-smooth, ein nacktes scrollLeft = x würde also sichtbar
    // hinfahren statt dort zu stehen.
    if (isDesktop() && el.clientWidth > 0) {
      const pos = readPos(key);
      // Der Browser deckelt selbst auf das echte Maximum, falls der Inhalt
      // inzwischen kürzer ist.
      if (pos != null && pos > 0) {
        if (axis === "x") el.scrollTo({ left: pos, behavior: "instant" });
        else el.scrollTo({ top: pos, behavior: "instant" });
      }
    }

    const write = (pos: number) => {
      try {
        sessionStorage.setItem(PREFIX + key, JSON.stringify({ pos, at: Date.now() }));
      } catch {
        // Storage voll oder gesperrt: dann eben kein Gedächtnis.
      }
    };

    // Der letzte Stand, den ein Scroll-Event gemeldet hat; nur daraus wird gespeichert,
    // nie direkt aus dem DOM beim Abbau. Der Grund ist gemessen: Beim Wegnavigieren ist
    // der Inhalt des Containers zum Abbau-Zeitpunkt schon weggeräumt, scrollTop liest
    // sich als 0 — ein Abbau-Speichern aus dem DOM überschrieb so jede gemerkte
    // Position mit 0. Dazu der Überlauf-Riegel unten: Klemmt der Container auf 0, WEIL
    // sein Inhalt gerade verschwindet (Abbau, Saison-Wechsel mit mode="wait"), ist der
    // Überlauf in dem Moment weg — und ein Container ohne Überlauf hat ohnehin nichts,
    // was man sich merken müsste. Echte Nutzer-Scrolls haben ihren Überlauf immer noch.
    // null heißt "nicht gescrollt seit dem Aufbau" -> es gibt nichts Neues zu sichern.
    let last: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      // Nur das sichtbare Desktop-Exemplar zählt (der versteckte Zwilling im
      // Mobile-Sheet hat keine Layout-Box und scrollt nie selbst).
      if (!isDesktop() || el.clientWidth === 0) return;
      const overflow =
        axis === "x"
          ? el.scrollWidth - el.clientWidth
          : el.scrollHeight - el.clientHeight;
      if (overflow < 2) return; // Abbau-Klemmer (oder eh nichts zu scrollen)
      last = axis === "x" ? el.scrollLeft : el.scrollTop;
      if (timer != null) clearTimeout(timer);
      const pos = last;
      timer = setTimeout(() => write(pos), SAVE_DELAY_MS);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer != null) clearTimeout(timer);
      // Die letzten <200ms Bewegung nicht verlieren: den zuletzt GEMELDETEN Stand
      // sichern (siehe oben, nie das DOM befragen).
      if (last != null) write(last);
    };
  }, [key, axis, ref]);
}
