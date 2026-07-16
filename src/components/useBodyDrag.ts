"use client";

import { useRef } from "react";
import type { DragControls } from "framer-motion";

// Ermöglicht das Ziehen eines Bottom-Sheets vom Sheet-Körper aus (nicht nur am Griff) –
// wie in iOS/Google Maps. Robuste Koordination:
//  - Horizontale Gesten -> ignorieren (native Karussells scrollen weiter).
//  - Vertikale Gesten bei Peek/Halb -> Sheet ziehen.
//  - Bei VOLL ausgefahrenem Sheet: Inhalt scrollt; nur Runterziehen am oberen Rand (scrollTop 0)
//    zieht das Sheet (zum Einklappen) – Hochwischen scrollt den Inhalt.
export function useBodyDrag(
  dragControls: DragControls,
  bodyRef: React.RefObject<HTMLElement | null>,
  atFull: boolean,
) {
  const start = useRef({ x: 0, y: 0, decided: false });

  return {
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY, decided: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s.decided) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // unter Schwelle
      s.decided = true;
      if (Math.abs(dx) > Math.abs(dy)) return; // horizontal -> Karussell/native
      const el = bodyRef.current;
      if (atFull && el && el.scrollTop > 0) return; // Inhalt gescrollt -> scrollen lassen
      if (atFull && dy < 0) return; // oben, hochwischen -> Inhalt scrollen
      dragControls.start(e); // vertikal -> Sheet ziehen
    },
    onPointerUp: () => {
      start.current.decided = false;
    },
    onPointerCancel: () => {
      start.current.decided = false;
    },
  };
}
