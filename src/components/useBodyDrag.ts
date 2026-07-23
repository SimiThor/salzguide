"use client";

import { useCallback, useEffect, useRef } from "react";
import type { DragControls } from "framer-motion";

// Ermöglicht das Ziehen eines Bottom-Sheets vom Sheet-Körper aus (nicht nur am Griff) –
// wie in iOS/Apple Karten. Robuste Koordination:
//  - Horizontale Gesten -> ignorieren (native Karussells scrollen weiter).
//  - Vertikale Gesten bei Peek/Halb -> Sheet ziehen.
//  - Bei VOLL ausgefahrenem Sheet: Inhalt scrollt; nur Runterziehen am oberen Rand
//    (scrollTop 0) zieht das Sheet mit runter – Hochwischen scrollt den Inhalt.
//  - Kurz nach dem Scrollen: gar nicht ziehen. Wischt man den Inhalt schwungvoll nach
//    oben, läuft er mit Schwung bis zum Anfang – ohne diese Sperre übernähme das Sheet
//    den Restschwung genau in dem Moment, in dem scrollTop 0 erreicht, und klappte
//    ungefragt zu. Genau dafür hat auch Vaul einen Timeout (SCROLL_LOCK_TIMEOUT).
//
// DER KERN – warum ein nicht-passiver touchmove-Listener:
// Ist das Sheet ganz aufgezogen, steht `touch-action: auto` – der Browser übernimmt die
// vertikale Geste selbst. Zieht man am obersten Punkt (scrollTop 0) weiter nach unten,
// startet iOS seinen nativen Gummiband-Effekt und bricht dabei die framer-motion-Geste ab:
// Der Inhalt federt zurück, statt dass das Sheet mitgeht. Das einzige, was diesen nativen
// Overscroll zuverlässig stoppt, ist `preventDefault()` auf touchmove. React hängt touchmove
// aber PASSIV ein (Scroll-Performance), dort wird preventDefault ignoriert. Deshalb hängen
// wir den Listener von Hand ans DOM (`{ passive: false }`). Sobald die Geste als Sheet-Zug
// feststeht, unterdrückt preventDefault den nativen Scroll/Bounce, und framer-motion bewegt
// das Sheet – so wie es sich am iPhone gehört.
const SCROLL_LOCK_MS = 100;

// Weg (px), bis die Richtung einer Geste feststeht. Darunter könnte es noch ein Tap sein.
// Dieselbe Schwelle für Pointer und Touch, damit beide immer dieselbe Entscheidung treffen.
// Exportiert, damit jede Stelle der App, die eine Geste einordnet (z. B. das Höhenprofil),
// bei genau demselben Weg entscheidet – das fühlt sich überall gleich an.
export const DIR_THRESHOLD = 8;

type GestureStart = {
  x: number;
  y: number;
  decided: boolean; // Richtung dieser Geste steht fest (bleibt bis zum Loslassen)
  drag: boolean; // ... und sie zieht das Sheet (nicht scrollen/Karussell)
  started: boolean; // framer-motion-Drag schon gestartet
  noDrag: boolean; // Geste begann auf einem Opt-out-Element ([data-sheet-no-drag]) -> nie ziehen
};

// Beginnt die Geste auf einem Element, das eigene Gesten braucht (z.B. das Foto-Canvas mit
// Pan/Zoom), darf das Sheet die Geste NICHT übernehmen. Solche Elemente tragen
// [data-sheet-no-drag]; sonst zöge ein Wisch auf dem Foto das ganze Sheet mit (oder klappte
// es zu). Deckt beide Pfade ab: den React-Pointer UND den nativen touchmove-Listener.
function startsOnNoDrag(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("[data-sheet-no-drag]");
}

export function useBodyDrag(
  dragControls: DragControls,
  bodyRef: React.RefObject<HTMLElement | null>,
  atFull: boolean,
) {
  const start = useRef<GestureStart>({
    x: 0,
    y: 0,
    decided: false,
    drag: false,
    started: false,
    noDrag: false,
  });
  const lastScrollAt = useRef(-Infinity);
  // atFull über einen Ref, damit der einmalig gebundene Listener immer den aktuellen Wert
  // sieht, ohne neu gebunden zu werden. Sync im Effect (nicht im Render), damit der
  // Ref-Schreibzugriff kein Render-Seiteneffekt ist.
  const atFullRef = useRef(atFull);
  useEffect(() => {
    atFullRef.current = atFull;
  }, [atFull]);

  // Einmal pro Geste: Zieht sie das Sheet? Reine Geometrie, damit Pointer- und
  // Touch-Handler garantiert dasselbe entscheiden.
  const shouldDrag = useCallback(
    (dx: number, dy: number): boolean => {
      if (start.current.noDrag) return false; // Geste begann auf einem Opt-out-Element
      if (Math.abs(dx) > Math.abs(dy)) return false; // horizontal -> Karussell/native
      const el = bodyRef.current;
      const full = atFullRef.current;
      if (full && el && el.scrollTop > 0) return false; // Inhalt gescrollt -> scrollen lassen
      if (full && dy < 0) return false; // oben, hochwischen -> Inhalt scrollen
      if (performance.now() - lastScrollAt.current < SCROLL_LOCK_MS) return false; // Restschwung
      return true; // vertikal (Peek/Halb, oder oben runterziehen) -> Sheet ziehen
    },
    [bodyRef],
  );

  // Nicht-passiver touchmove: die EINZIGE Stelle, die iOS' nativen Scroll und sein
  // Gummiband stoppen kann. Steht die Geste als Sheet-Zug fest, unterdrückt preventDefault
  // jeden weiteren Move, damit der Browser den Inhalt nicht darunter wegbouncet. Der Body
  // ist mobil ab dem ersten Render da, also hängt der Listener ab dem Mount.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      const s = start.current;
      const t = e.touches[0];
      if (!t) return;
      // Direkt am Ziel prüfen (bei Touch bleibt e.target das Start-Element der Geste): begann
      // die Geste auf dem Foto-Canvas o.ä., NIE das Sheet ziehen - unabhängig davon, ob der
      // Pointer-Handler oben schon gelaufen ist. Robust auf iOS, wo die Reihenfolge Pointer/
      // Touch abweichen kann.
      if (startsOnNoDrag(e.target)) return;
      if (!s.decided) {
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.abs(dx) < DIR_THRESHOLD && Math.abs(dy) < DIR_THRESHOLD) return;
        s.decided = true;
        s.drag = shouldDrag(dx, dy);
      }
      if (s.drag && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, [bodyRef, shouldDrag]);

  return {
    onScroll: () => {
      lastScrollAt.current = performance.now();
    },
    onPointerDown: (e: React.PointerEvent) => {
      start.current = {
        x: e.clientX,
        y: e.clientY,
        decided: false,
        drag: false,
        started: false,
        // Zielelement der Geste merken: der native touchmove-Listener liest denselben Ref
        // und weiß so, dass er auf Opt-out-Elementen (Foto-Canvas) nicht ziehen darf.
        noDrag: startsOnNoDrag(e.target),
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      // Gestartet auf einem Opt-out-Element (Foto-Canvas fängt den Pointer per Capture, daher
      // bleibt e.target das Canvas)? Dann übernimmt das Sheet die Geste NIE.
      if (startsOnNoDrag(e.target)) return;
      const s = start.current;
      if (!s.decided) {
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dx) < DIR_THRESHOLD && Math.abs(dy) < DIR_THRESHOLD) return;
        s.decided = true;
        s.drag = shouldDrag(dx, dy);
      }
      // Genau einmal starten. Der touchmove-Handler kann die Geste (bei Touch) schon
      // entschieden haben – dann übernimmt der Pointer hier trotzdem den framer-Drag.
      if (s.drag && !s.started) {
        s.started = true;
        dragControls.start(e); // framer-motion übernimmt -> Sheet folgt dem Finger
      }
    },
    onPointerUp: () => {
      const s = start.current;
      s.decided = false;
      s.drag = false;
      s.started = false;
    },
    onPointerCancel: () => {
      const s = start.current;
      s.decided = false;
      s.drag = false;
      s.started = false;
    },
  };
}
