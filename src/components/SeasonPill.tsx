"use client";

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { Season } from "@/lib/season";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Sommer/Winter, als schwebende Pille auf der Karte.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Vorher war das ein iOS-Segmented-Control und stand in der Zeile, in der jetzt die
// Kategorie-Pillen stehen. Die Zeile ist das, was im eingefahrenen Sheet sichtbar bleibt,
// also der wertvollste Platz der Seite — und die Saison ist nicht das, wonach jemand als
// Erstes greift. Sie wird ein- oder zweimal im Jahr gebraucht, und die App stellt sie von
// selbst richtig ein (lib/season.ts).
//
// SIE ZEIGT DEN IST-ZUSTAND, NICHT DAS ZIEL. Ein nacktes ❄️ auf einem Knopf lässt genau
// offen, was man wissen will: heisst es „du bist im Winter" oder „hier gehts zum Winter"?
// Das Wort daneben räumt die Frage weg, und die Pille liest sich damit wie ein Etikett,
// das man umlegen kann. Wohin es geht, steht im aria-label — dort ist Platz für den
// ganzen Satz.
//
// Sie sitzt links oben in der Karte und nicht rechts: Rechts steht schon die Knopfsäule
// (Zoom, Zentrieren, Standort). Ein vierter Knopf dort sähe aus wie ein Karten-Werkzeug,
// ist aber ein Inhalts-Schalter.

const FACE: Record<Season, string> = { summer: "☀️", winter: "❄️" };

export default function SeasonPill({
  season,
  onToggle,
  labels,
  className = "",
}: {
  season: Season;
  onToggle: () => void;
  /** `switchTo` ist der fertige Satz für die ANDERE Saison ("Auf Winter umschalten").
   *  Fertig und nicht mit Platzhalter zusammengesetzt: "Passer à l’été" und "Passer à
   *  l’hiver" unterscheiden sich in mehreren Sprachen nicht nur im eingesetzten Wort. */
  labels: { summer: string; winter: string; switchTo: string };
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <button
      type="button"
      onClick={onToggle}
      // Der sichtbare Text sagt, wo man IST. Der Screenreader-Name sagt, was der Tipp
      // tut — sonst hiesse der Knopf schlicht „Sommer" und niemand wüsste, wozu er da ist.
      aria-label={labels.switchTo}
      // Glas-Optik der Karten-Overlays (siehe SpotMap.tsx, Vollbild-Hinweis): heller
      // Blur-Grund, Haarrand, weicher Schatten. Auf einer Karte muss ein Bedienelement
      // vom Untergrund abheben, ohne ihn zuzudecken.
      className={`sg-hit sg-native-tap flex cursor-pointer items-center gap-1.5 rounded-full border border-black/5 bg-white/80 py-1.5 pl-3 pr-3.5 text-[13px] font-semibold text-ink shadow-[var(--sg-map-tile-shadow)] backdrop-blur-md transition active:scale-95 ${className}`}
    >
      {/* Das Symbol wechselt als kleine Blende statt hart umzuspringen: Der Wechsel baut
          die ganze Karte um (andere Pins, anderer Ausschnitt), und ein Knopf, der dabei
          erkennbar mitgeht, sagt „das kam von hier". mode="wait" verhindert, dass Sonne
          und Schneeflocke kurz übereinanderliegen. */}
      <span className="relative flex h-[18px] w-[18px] items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={season}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.6, rotate: -30 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: 30 }}
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
            className="absolute text-[15px] leading-none"
          >
            {FACE[season]}
          </motion.span>
        </AnimatePresence>
      </span>
      {/* aria-hidden, weil der Knopf seinen Namen schon aus dem aria-label bezieht:
          sonst läse ein Screenreader „Auf Winter umschalten, Sommer". */}
      <span aria-hidden>{labels[season]}</span>
    </button>
  );
}
