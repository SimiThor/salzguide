import { notFound } from "next/navigation";

// Fängt jede URL unterhalb von /[locale], für die es keine echte Route gibt (Tippfehler,
// tote Links, umgezogene Seiten), und reicht sie an die gestaltete 404-Seite weiter
// (../not-found.tsx).
//
// WARUM ES DIESE DATEI BRAUCHT: `not-found.tsx` allein greift nur, wenn irgendwo im Code
// `notFound()` aufgerufen wird (z.B. Spot-Seite ohne Treffer). Eine URL, zu der gar keine
// Route existiert, läuft daran vorbei und landet auf der nackten englischen Next-404 ohne
// unsere Gestaltung. Dieser Catch-all macht aus „keine Route" denselben Fall wie „kein
// Treffer" — das dokumentierte next-intl-Muster.
export default function CatchAllPage() {
  notFound();
}
