"use client";

import { useEffect, useState } from "react";

// Die Peek-Höhe des Bottom-Sheets steht in globals.css (--sg-sheet-peek) – dort, weil
// nur CSS sie vor dem ersten Paint kennt (siehe Kommentar in globals.css). Manches
// braucht sie trotzdem als Zahl, allen voran Mapbox: fitBounds/padding nimmt Pixel,
// keine CSS-Werte. Diese Datei ist die einzige Brücke zwischen beiden Welten.
//
// Ausgelesen wird die REGISTRIERTE Property (@property syntax "<length>"): der Browser
// rechnet sie zu Pixeln aus. Ohne Registrierung gäbe getComputedStyle nur den Text
// "calc(86px + ...)" zurück.
export const SHEET_PEEK_VAR = "--sg-sheet-peek";
// Höhe der Tab-Leiste inkl. Home-Indicator. Sie liegt ÜBER dem Sheet, ihre Höhe gehört
// deshalb zu jeder Stufe dazu, die etwas sichtbar halten soll.
export const NAV_H_VAR = "--sg-nav-h";

// Liest eine registrierte CSS-Länge als Pixelzahl. `el` bestimmt, welcher Wert gilt –
// die Property vererbt, ein Sheet darf sie also lokal überschreiben (z.B. Audio-Tour).
export function readCssLength(name: string, el?: Element | null): number {
  if (typeof window === "undefined") return 0;
  const target = el ?? document.documentElement;
  const raw = getComputedStyle(target).getPropertyValue(name);
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) ? px : 0;
}

// Peek-Höhe in Pixeln, aktuell gehalten bei Drehung/Resize.
//
// Der Startwert wird schon beim ERSTEN Client-Render gelesen (Lazy-Initializer), nicht
// erst im Effekt: Das Karten-Padding hängt daran, und die Karte passt ihren Ausschnitt
// beim Mounten ein. Käme die Zahl einen Render später, würde die Karte zweimal
// einpassen und sichtbar nachrucken. Auf dem Server gibt es kein document -> 0, das
// stört nicht: dort rechnet die Karte ohnehin nichts.
export function useSheetPeek(): number {
  const [peek, setPeek] = useState(() => readCssLength(SHEET_PEEK_VAR));
  useEffect(() => {
    const read = () => setPeek(readCssLength(SHEET_PEEK_VAR));
    read();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);
  return peek;
}
