"use client";

// Das eine „smart"-Symbol der App: der gefüllte Phosphor-Sparkle, wie er im PC-Header sitzt.
// EINE Quelle, damit jeder KI-Knopf und jedes KI-Feature plattformweit DASSELBE Zeichen
// trägt, statt eines ✨-Emojis (das je nach Gerät, Betriebssystem und Font anders aussieht
// und nie ganz zur Marke passt).
//
// Zwei Tönungen, damit das Zeichen überall lesbar bleibt und trotzdem harmonisch wirkt:
//   • Standard (currentColor): erbt die Textfarbe des Knopfs. Auf den roten/dunklen
//     KI-Knöpfen ist der Text weiss -> der Sparkle wird weiss und verschwindet nicht auf
//     der farbigen Fläche.
//   • gradient: der warme Marken-Verlauf (Akzentrot -> Orange -> Gold). Das ist das
//     Apple-Intelligence-Signal („smart", aber warm wie ein Local-Tipp, nicht kalt-technisch).
//     Nur auf HELLEN Flächen einsetzen (Header, weisse Karten), wo der Verlauf sichtbar ist.
//
// Der Verlaufs-id ist PRO INSTANZ eindeutig (useId). Warum kein fester id: Header und
// KI-Buttons zeigen den Sparkle mehrfach auf derselben Seite. Bei gleichem id nimmt der
// Browser das ERSTE Element — und das steckt im DesktopHeader, der am Handy `display:none`
// ist. Ein Verlauf in einem ausgeblendeten Teilbaum malt nicht, der Sparkle wäre unsichtbar.
// Eindeutige ids schliessen das aus. (Deshalb "use client": useId ist ein Hook.)
import { useId } from "react";

const SPARKLE_PATH =
  "M208,144a15.78,15.78,0,0,1-10.42,14.94L146,178l-19,51.62a15.92,15.92,0,0,1-29.88,0L78,178,26.42,159A15.92,15.92,0,0,1,26.42,129L78,110l19-51.62a15.92,15.92,0,0,1,29.88,0L146,110l51.62,19A15.78,15.78,0,0,1,208,144ZM152,48h16V64a8,8,0,0,0,16,0V48h16a8,8,0,0,0,0-16H184V16a8,8,0,0,0-16,0V32H152a8,8,0,0,0,0,16Zm88,32h-8V72a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0V96h8a8,8,0,0,0,0-16Z";

export default function AiSparkle({
  className = "h-4 w-4",
  gradient = false,
}: {
  /** Grösse/Abstände. Standard 16px; im Fluss neben Text gern `h-[1.05em] w-[1.05em]`. */
  className?: string;
  /** Warmer Marken-Verlauf statt Textfarbe. Nur auf hellen Flächen. */
  gradient?: boolean;
}) {
  // useId liefert ids mit „:" — im SVG-url()-Verweis unschön, deshalb rausfiltern.
  const gid = "sg-ai-sparkle-" + useId().replace(/:/g, "");
  return (
    <svg className={className} viewBox="0 0 256 256" aria-hidden>
      {gradient && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#cc2924" />
            <stop offset="55%" stopColor="#d8452a" />
            <stop offset="100%" stopColor="#e8823a" />
          </linearGradient>
        </defs>
      )}
      <path fill={gradient ? `url(#${gid})` : "currentColor"} d={SPARKLE_PATH} />
    </svg>
  );
}
