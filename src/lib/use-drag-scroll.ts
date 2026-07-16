"use client";

import {
  useEffect,
  useRef,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

// Maus-Drag-to-Scroll für horizontale Karussells (Desktop). Ein Ort für die
// robuste Logik -> Startseiten- und KI-Chat-Karussell verhalten sich identisch:
// - nur Maus (Touch behält natives Scrollen)
// - move/up laufen während eines aktiven Drags über window-Listener -> der Drag
//   reißt nicht ab, auch wenn die Maus das Karussell verlässt
// - BEWUSST kein setPointerCapture: Capture würde das nachfolgende click-Event auf
//   den Container umleiten und Klicks auf Karten/Speichern-Buttons verschlucken
// - onDragStart preventDefault: kein natives Bild-/Link-Ziehen (Geisterbild)
// - onClickCapture: nach echtem Ziehen kein versehentliches Öffnen der Karte
export function useDragScroll(externalRef?: RefObject<HTMLDivElement | null>) {
  const internalRef = useRef<HTMLDivElement | null>(null);
  const ref = externalRef ?? internalRef;
  const state = useRef({ active: false, startX: 0, startScroll: 0, moved: false });
  // Stabile window-Handler (add/removeEventListener brauchen dieselbe Referenz).
  // Im Effect erzeugt -> kein Ref-Zugriff während des Renderns.
  const win = useRef<{ move: (e: PointerEvent) => void; up: () => void } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const el = ref.current;
      if (!state.current.active || !el) return;
      const dx = e.clientX - state.current.startX;
      if (Math.abs(dx) > 4) state.current.moved = true;
      el.scrollLeft = state.current.startScroll - dx;
    };
    const up = () => {
      if (!state.current.active) return;
      state.current.active = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    win.current = { move, up };
    // Aufräumen, falls die Komponente mitten im Drag unmountet (Chat rendert Nachrichten neu).
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      win.current = null;
    };
  }, [ref]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // moved immer zurücksetzen (auch Touch) -> kein „stale" Klick-Blocker.
    if (e.pointerType !== "mouse") {
      state.current.moved = false;
      return;
    }
    const el = ref.current;
    const h = win.current;
    if (!el || !h) return;
    state.current = {
      active: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
    };
    window.addEventListener("pointermove", h.move);
    window.addEventListener("pointerup", h.up);
    window.addEventListener("pointercancel", h.up);
  }

  function onClickCapture(e: ReactMouseEvent) {
    if (state.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      state.current.moved = false;
    }
  }

  const onDragStart = (e: ReactDragEvent) => e.preventDefault();

  return {
    ref,
    dragProps: { onPointerDown, onClickCapture, onDragStart },
  };
}
