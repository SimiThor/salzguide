// Das eine Ladezeichen der Plattform: acht Speichen, die der Reihe nach verblassen, wie
// der Aktivitätsanzeiger von iOS. Es stand vorher als Ring mit rotierendem Bogen wortgleich
// in LoginForm, WithdrawalForm und SupportForm und fehlte überall sonst, wo Knöpfe nur
// „Speichert …" schrieben.
//
// WARUM NICHTS ROTIERT: Ein laufendes CSS-transform rastert Chrome einmal in eine Ebene und
// dreht dann dieses Bild. Bei 1,4px Strichstärke auf 13px Symbolgrösse wird daraus sichtbares
// Flimmern, das Zeichen „eiert". Hier bewegt sich nichts, es ändert sich nur die Deckkraft
// je Speiche: jeder Frame ist gestochen scharf, in jeder Grösse. Die Drehung entsteht
// allein im Auge, aus der Reihenfolge der Blenden (globals.css, sg-spinner-fade).
//
// NICHT für KI-Aktionen. Toni und die Analyse-Knöpfe haben ihre eigene Sprache
// (sg-ai-shimmer, sg-ai-dot, sg-ai-glow in globals.css, siehe AiButton). Wer eine KI
// arbeiten sieht, soll das auch am Zeichen erkennen.

// Acht Speichen: bei 13px Symbolgrösse laufen zwölf ineinander, vier wirken ruckelig.
const SPEICHEN = 8;

// Grösse in `em`, nicht in Pixeln: So passt sich das Zeichen von selbst an die Schriftgrösse
// des Knopfes an, vom 12px-Admin-Knopf bis zum grossen Formular-Knopf. Eine Regel statt
// einer Entscheidung pro Aufrufstelle. Die Farbe erbt es über currentColor.
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-[1.05em] w-[1.05em] shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-hidden
    >
      {Array.from({ length: SPEICHEN }, (_, i) => (
        <rect
          key={i}
          className="sg-spinner-spoke"
          x="10.85"
          y="1.9"
          width="2.3"
          height="6.2"
          rx="1.15"
          transform={`rotate(${(360 / SPEICHEN) * i} 12 12)`}
          // Negativer Versatz: Die Blende läuft schon, wenn das Zeichen erscheint, also
          // startet keine Speiche bei voller Deckkraft und es gibt kein Aufblitzen.
          style={{ animationDelay: `${-(0.8 / SPEICHEN) * (SPEICHEN - i)}s` }}
        />
      ))}
    </svg>
  );
}

/**
 * Beschriftung eines Knopfes, der gerade arbeitet: Ladezeichen + Text.
 *
 *   {pending ? <Busy>Speichert</Busy> : "Speichern"}
 *
 * Ohne die drei Punkte am Ende: Die standen früher dafür, dass etwas läuft, und genau das
 * sagt jetzt die Animation. Beides zusammen wäre doppelt gemoppelt.
 *
 * `aria-live="polite"`, damit auch ohne Blick auf den Knopf angesagt wird, dass es losgeht.
 */
export default function Busy({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-live="polite">
      <Spinner />
      {children}
    </span>
  );
}
