"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

// Das Kärtchen, das erscheint, wenn man einen Punkt auf der Karte antippt — auf der
// Gespeichert-Karte (Spot-Vorschau) genauso wie auf der Spot-Detailkarte (Parkplatz,
// Wasserstelle, Hütte, Start/Ziel, der Spot selbst). Hülle, Ebene, Position und Feder
// liegen an EINER Stelle, damit sich jede Karte gleich anfasst.
//
// Ebene: über den Mapbox-Buttons, unter der Scroll-Schutzfläche (die Leiter steht in
// globals.css). Das Punkt-Kärtchen der Detailkarte lag vorher darunter — der
// Attribution-Button fing damit Tipper ab, die dem ✕ galten.
//
// Höhe: eingebettet sitzt es knapp über dem Rand und deckt Logo/Attribution kurz ab
// (ein Tipp aufs ✕ gibt sie wieder frei). Im Vollbild ist Platz genug — dort rückt es
// über beide. Beides steht im CSS, nicht hier.
export default function MapPopover({
  fullscreen = false,
  children,
}: {
  fullscreen?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`sg-map-popover${fullscreen ? " sg-map-popover--full" : ""}`}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ type: "spring", stiffness: 440, damping: 34 }}
        className="pointer-events-auto mx-auto flex max-w-sm items-center rounded-[16px] bg-white/95 pr-2 shadow-[0_14px_44px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/5 backdrop-blur-xl"
      >
        {children}
      </motion.div>
    </div>
  );
}

// Schließen-Knopf des Kärtchens (überall derselbe).
export function MapPopoverClose({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/5 text-ink active:scale-90"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
