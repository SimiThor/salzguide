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
// globals.css unter "VIEWPORT-HÖHE"; diese Datei ist Fall 3 daraus.
//
// STATTDESSEN --sg-vh (= 100svh):
// svh ist der Bildschirm mit AUSGEFAHRENEN Leisten – pro Gerät und Ausrichtung eine
// feste Zahl. Und es ist dieselbe Größe, mit der die Sheets in globals.css rechnen.
// Zwei Systeme, die sich denselben Bildschirm teilen, müssen ihn gleich messen.
export const VIEWPORT_H_VAR = "--sg-vh";

// useLayoutEffect läuft nach dem Rendern, aber VOR dem Paint. Auf dem Server gibt es
// ihn nicht (React warnt dort) -> dann useEffect, der ohnehin nie läuft.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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
