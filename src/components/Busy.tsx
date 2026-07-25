// Das eine Ladezeichen der Plattform: dünner Ring, rotierender Bogen mit runden Enden,
// wie iOS es macht. Es stand wortgleich in LoginForm, WithdrawalForm und SupportForm und
// fehlte überall sonst, wo Knöpfe nur „Speichert …" schrieben. Drei Kopien und dreissig
// Textstellen sind dreiunddreissig Wege, unterschiedlich auszusehen.
//
// NICHT für KI-Aktionen. Toni und die Analyse-Knöpfe haben ihre eigene Sprache
// (sg-ai-shimmer, sg-ai-dot, sg-ai-glow in globals.css, siehe AiButton). Wer eine KI
// arbeiten sieht, soll das auch am Zeichen erkennen.

// Grösse in `em`, nicht in Pixeln: So passt sich das Zeichen von selbst an die Schriftgrösse
// des Knopfes an, vom 12px-Admin-Knopf bis zum grossen Formular-Knopf. Eine Regel statt
// einer Entscheidung pro Aufrufstelle. Farbe erbt es ohnehin über currentColor.
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-[1.05em] w-[1.05em] shrink-0 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" />
      <path
        className="opacity-90"
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
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
