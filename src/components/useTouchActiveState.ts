"use client";

import { useEffect } from "react";

/**
 * Macht `:active` auf iOS überhaupt erst zuverlässig.
 *
 * DAS PROBLEM, in Apples eigenen Worten (Safari Web Content Guide, "Handling Events"):
 * „On iOS, emulated mouse events are sent so quickly that the down or active pseudo state
 * of buttons may never occur." Safari schickt also mousedown/mouseup so dicht hintereinander,
 * dass der Zustand dazwischen nie gezeichnet wird — es sei denn, das Dokument hört auf
 * Touch-Events. Dann behandelt Safari die Seite als touch-bewusst und setzt `:active` für
 * die Dauer der Berührung.
 *
 * WARUM DAS HIER SO WEH TUT: Die App setzt auf ihren Bedien-Elementen
 * `-webkit-tap-highlight-color: transparent` (sg-native-tap) — der graue Blitz ist der
 * Verräter „Webseite". Damit ist `:active` die EINZIGE Rückmeldung, die ein Tap noch gibt.
 * Feuert es nicht, passiert beim Antippen sichtbar gar nichts, und genau dann tippt man ein
 * zweites Mal, weil man den Knopf für tot hält. Rund 70 Komponenten hängen an `active:`-
 * Klassen; diese eine Zeile schaltet sie alle gemeinsam scharf, statt 70 Einzelfälle.
 *
 * Der Listener ist absichtlich leer und `passive` — er blockiert nichts, verzögert nichts
 * und hält nur das Dokument als „hört zu" markiert. Ohne `passive: true` würde er das
 * Scrollen ausbremsen, weil der Browser vor jedem Scroll auf ein mögliches
 * preventDefault() warten müsste.
 */
export function useTouchActiveState() {
  useEffect(() => {
    // Nur auf Geräten ohne echten Zeiger. Am Desktop gibt es das Problem nicht, und ein
    // Listener, den niemand braucht, gehört nicht ins Dokument.
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(hover: hover)").matches) return;
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);
}
