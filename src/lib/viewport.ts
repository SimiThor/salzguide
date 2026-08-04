"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { readCssLength } from "./sheet-metrics";

// Viewport-Höhe als Zahl – für alles, was sie nicht in CSS ausdrücken kann
// (Mapbox-Padding nimmt Pixel, Sheet-Höhen sind ein Anteil davon).
//
// WARUM NICHT window.innerHeight:
// innerHeight ist die DYNAMISCHE Höhe. Mobile Browser fahren ihre Leisten beim
// Scrollen ein und aus, innerHeight springt dabei um 60–150px und `resize` feuert
// mitten in der Geste. Wer daran hängt, rechnet sein Layout während des Scrollens
// neu – Sheets fahren auf ihre Ausgangsstufe zurück, die Karte kippt ihren
// Ausschnitt, der Inhalt wandert unter dem Finger weg. Die ganze Regel steht in
// globals.css unter "VIEWPORT-HÖHE"; diese Datei ist Fall 4 daraus.
//
// STATTDESSEN --sg-vh (= 100svh):
// svh ist der Bildschirm mit AUSGEFAHRENEN Leisten – pro Gerät und Ausrichtung eine
// feste Zahl. Und es ist dieselbe Größe, mit der die Sheets in globals.css rechnen.
// Zwei Systeme, die sich denselben Bildschirm teilen, müssen ihn gleich messen.
export const VIEWPORT_H_VAR = "--sg-vh";

// useLayoutEffect läuft nach dem Rendern, aber VOR dem Paint. Auf dem Server gibt es
// ihn nicht (React warnt dort) -> dann useEffect, der ohnehin nie läuft.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// FALL 4 DERSELBEN REGEL: DIE BILDSCHIRMTASTATUR.
//
// Die Leisten aus dem Kopf dieser Datei machen den sichtbaren Bereich nur GRÖSSER als
// svh – svh ist der kleinste Fall. Die Tastatur ist die einzige Ausnahme: Sie macht ihn
// KLEINER, und damit ist sie das einzige, was ein Sheet über den oberen Bildschirmrand
// schieben kann. Ein Sheet ist 92% von svh hoch und hängt an bottom: 0. Fährt die
// Tastatur aus, bleiben darunter noch rund 45% übrig – die fehlenden 47% stehen oben
// aus dem Bild heraus. Genau das war der KI-Chat: Sheet bis zum Rand, Eingabezeile
// hinter der Tastatur.
//
// GEMESSEN GEGEN window.innerHeight, NICHT gegen svh:
// Beim Öffnen der Tastatur lässt iOS innerHeight unverändert und schrumpft allein
// visualViewport. Die Differenz ist deshalb genau die Tastatur – die Browser-Leiste
// kürzt sich weg, weil sie in BEIDEN Zahlen steckt. Dieselbe Rechnung benutzt Vaul, das
// Sheet-Paket, an dem sich die Web-Welt orientiert.
//
// UND offsetTop GEHÖRT DAZU:
// Steht das Feld hinter der Tastatur, schiebt iOS zusätzlich den sichtbaren Ausschnitt
// nach unten, um es freizustellen (visualViewport.offsetTop). Fixierte Elemente machen
// diese Verschiebung NICHT mit – sie hängen am Dokument. Genau daran sah man den Fehler:
// Das Sheet wanderte oben aus dem Bild, statt nur von der Tastatur verdeckt zu werden.
// Wer nur die Tastaturhöhe abzieht, korrigiert die halbe Strecke.
//
// NUR BEI FOKUSSIERTEM TEXTFELD:
// Ohne dieses Signal müsste man an einer Schwelle raten, ab wie vielen Pixeln eine
// Differenz "Tastatur" heißt und nicht "Leisten-Animation" – und jede Fehleinschätzung
// verschöbe ein Sheet mitten im Lesen. Keine Tastatur ohne Textfeld: Der Fokus ist das
// eindeutige Signal und kostet keinen Schwellenwert.

// Eingabefelder, die KEINE Tastatur öffnen (Checkbox, Datei-Auswahl, Farbwähler ...).
const NO_KEYBOARD_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function opensKeyboard(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NO_KEYBOARD_TYPES.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

export type Keyboard = {
  // Pixel, die ein unten verankertes, fixiertes Element frei lassen muss.
  inset: number;
  // Höhe des sichtbaren Streifens über der Tastatur – der Deckel für jede Höhe.
  visible: number;
};

// Beide Zahlen sind 0, solange keine Tastatur offen ist. 0 heißt für den Aufrufer
// "nichts anfassen": Ohne Tastatur ist svh die kleinste mögliche Höhe, da gibt es
// nichts zu deckeln (siehe Regel im Kopf dieser Datei).
const NO_KEYBOARD: Keyboard = { inset: 0, visible: 0 };

export function useKeyboard(): Keyboard {
  const [kb, setKb] = useState<Keyboard>(NO_KEYBOARD);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const read = () => {
      const next: Keyboard = opensKeyboard(document.activeElement)
        ? {
            inset: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
            visible: Math.round(vv.height),
          }
        : NO_KEYBOARD;
      // Nur bei echter Änderung neu rendern: visualViewport meldet beim Schieben
      // dutzendfach denselben Stand.
      setKb((cur) =>
        cur.inset === next.inset && cur.visible === next.visible ? cur : next,
      );
    };

    // Erst im nächsten Frame lesen, und zwar aus zwei Gründen:
    // 1. focusout feuert, BEVOR das nächste Feld den Fokus hat. Sofort gelesen wäre
    //    activeElement kurz der body – das Sheet spränge zwischen zwei Feldern einen
    //    Frame lang auf volle Höhe und wieder zurück.
    // 2. visualViewport meldet beim Ausfahren der Tastatur mehrere Ereignisse pro Frame.
    //    So wird daraus eine Messung statt einer Kaskade.
    let frame = 0;
    const readSoon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };

    // focusin/focusout blubbern (focus/blur nicht) -> ein Paar Zuhörer am Dokument deckt
    // jedes Feld der App ab, auch nachgeladene.
    document.addEventListener("focusin", readSoon);
    document.addEventListener("focusout", readSoon);
    // resize = Tastatur fährt aus/ein. scroll = iOS schiebt den sichtbaren Ausschnitt,
    // um das Feld freizustellen; auch dabei ändert sich, was unten verdeckt ist.
    vv.addEventListener("resize", readSoon);
    vv.addEventListener("scroll", readSoon);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", readSoon);
      document.removeEventListener("focusout", readSoon);
      vv.removeEventListener("resize", readSoon);
      vv.removeEventListener("scroll", readSoon);
    };
  }, []);

  return kb;
}

export function useViewportHeight(): number {
  // Startwert 0, NICHT die schon gemessene Höhe: Die Sheets rendern diese Zahl als
  // style={{ height }} ins Server-HTML. Ein Lazy-Initializer würde beim Hydrieren eine
  // andere Höhe liefern als der Server geschrieben hat – React verwirft dann den Baum
  // und meldet einen Hydration-Mismatch. Die Aufrufer haben für diesen einen Render
  // einen Fallback (vh || 800).
  const [height, setHeight] = useState(0);

  // Gemessen wird im Layout-Effekt, nicht im normalen Effekt: Der läuft noch vor dem
  // Paint, also sieht niemand je die Fallback-Höhe. Mit useEffect würde das Sheet mit
  // 800px erscheinen und im nächsten Frame auf die echte Höhe springen – genau das
  // Zucken beim Laden, das wir loswerden wollen.
  useIsomorphicLayoutEffect(() => {
    let lastWidth = window.innerWidth;
    const measure = () => setHeight(readCssLength(VIEWPORT_H_VAR));

    measure();

    // Die Höhe ändert sich beim Leisten-Zug, die BREITE nie. Ein resize mit gleicher
    // Breite ist also eine Leiste oder die eingeblendete Tastatur – beides darf das
    // Layout nicht anfassen. Nur echte Resizes (Drehung, Fenster ziehen am Desktop,
    // Split View) ändern die Breite und werden neu gemessen.
    const onResize = () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      measure();
    };

    // Bei der Drehung meldet iOS die neuen Maße nicht sofort – erst im nächsten Frame
    // stehen sie. Der Breiten-Riegel oben würde ein zu frühes resize sonst mit den
    // ALTEN Werten durchwinken, und die Höhe bliebe die des Hochformats.
    const onOrientation = () => {
      requestAnimationFrame(() => {
        lastWidth = window.innerWidth;
        measure();
      });
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientation);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, []);

  return height;
}
