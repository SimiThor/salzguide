"use client";

import { useEffect, useState } from "react";

/**
 * Ist gerade ein Desktop-Layout aktiv (>= 768px, dieselbe Grenze wie Tailwinds `md`)?
 *
 * NUR FÜR DINGE, DIE ES ERST NACH EINER BENUTZER-AKTION GIBT — Overlays, Sheets, Karten
 * über der Karte. Für das Grundlayout gehört die Unterscheidung in CSS: Der Server kennt
 * die Fensterbreite nicht, dieser Haken startet also zwangsläufig mit `false`, und eine
 * Seite, die daran hängt, zeigt im ersten Bild die Handy-Fassung und tauscht sie in der
 * Hydration — sichtbar als Blitzer. Steht das Panel dagegen erst da, nachdem jemand
 * getippt hat, ist die Hydration längst durch und der Wert stimmt von Anfang an.
 */
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}
