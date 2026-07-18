// Knöpfe und Status-Kennzeichnungen, an EINER Stelle.
//
// ═══════════════════════════════════════════════════════════════════════════════
//  DIE REGEL:  Gefüllt heisst anfassbar.  Umrandet heisst Zustand.
// ═══════════════════════════════════════════════════════════════════════════════
//
// WARUM ES DIE BRAUCHT: Vorher trugen beide dieselbe graue Kapsel. In der Admin-Nutzerliste
// standen "Pro · geschenkt" (nur Text) und "Pro schenken" (ein Knopf) nebeneinander in
// derselben Zeile, unterschieden durch 4px Innenabstand und 1px Schriftgrösse. Anton hat
// gefragt, welches davon man drücken kann. Genau diese Frage darf eine Oberfläche nicht
// stellen lassen.
//
// WARUM NICHT ÜBER active:scale: Das Signal ist im Projekt zu 100% richtig gerichtet (98
// Vorkommen, alle auf anfassbaren Dingen, kein einziges Badge). Es erscheint aber erst beim
// BERÜHREN. Wer nur hinschaut, hat nichts davon. Die Trennung muss im Ruhezustand sichtbar
// sein, deshalb Füllung gegen Linie.
//
// Warum Linie und nicht "gar keine Kapsel": Ein Badge ist ein Marker, es soll etwas
// markieren. Ohne Rahmen verschwimmt es mit dem Fliesstext daneben. Die Haarlinie hält die
// Marker-Wirkung und gibt trotzdem die Füllung ab, an der man den Knopf erkennt.
//
// DREI DOKUMENTIERTE AUSNAHMEN, alle mit eigenem, unverwechselbarem Aussehen:
//
//   1. ProBadge (components/ProBadge.tsx) ist gefüllt und nicht anfassbar. Es ist kein
//      Status, sondern ein Markenzeichen — der Produktname als Wortmarke. Es trägt als
//      einziges Element der App einen Verlauf; kein Knopf tut das. Verwechslung ausgeschlossen.
//   2. Zähler-Punkte (die kleinen roten Kreise mit einer ZAHL darin, z.B. offene Anfragen in
//      der Admin-Navigation) bleiben gefüllt. Das ist das iOS-Mitteilungsabzeichen, es wird
//      seit Jahrzehnten so gelesen. Bedingung: rund, nur eine Zahl. Sobald ein WORT darin
//      steht, ist es ein Status und gehört umrandet.
//   3. Über Foto und Karte darf ein Status gefüllt sein, sonst ist er nicht lesbar. Dort
//      trennt stattdessen der SCHATTEN: Knöpfe schweben (shadow-md), Beschriftungen liegen
//      flach auf. Siehe MapCard/SpotDetailMap.

// ── Knöpfe ───────────────────────────────────────────────────────────────────
//
// Gemeinsam: gefüllte Kapsel, halbfett, und IMMER Press-Feedback. Ein Knopf ohne
// active:scale fühlt sich am Handy tot an, und genau daran fehlte es bisher bei rund 40
// Stück (vor allem im Admin).
//
// active:scale-[0.98] ist der Wert für Knöpfe mit Text: In der Codebase steht er 41 Mal und
// ist damit der eingebürgerte Standard. Runde Icon-Knöpfe dürfen weiter kräftiger
// zusammenzucken (0.95/0.90), die sind klein und brauchen mehr Weg, um die Rückmeldung zu
// zeigen.
const BTN = "rounded-full font-semibold transition active:scale-[0.98] disabled:opacity-50";

/** Grösse für Fliesstext-Zusammenhänge (Profil, Formulare, Sheets). */
const BTN_MD = `${BTN} px-5 py-3 text-sm`;
/** Kompakt, für dichte Listen — vor allem im Admin. */
const BTN_SM = `${BTN} px-3.5 py-2 text-[13px]`;

/** Die eine wichtige Aktion. Rot gefüllt, weisser Text. */
export const BTN_PRIMARY = `${BTN_MD} bg-accent text-white`;
export const BTN_PRIMARY_SM = `${BTN_SM} bg-accent text-white`;

/** Alles Weitere. Neutral gefüllt — diese Fläche gehört ab jetzt ausschliesslich Knöpfen. */
export const BTN_SECONDARY = `${BTN_MD} bg-black/5 text-ink`;
export const BTN_SECONDARY_SM = `${BTN_SM} bg-black/5 text-ink`;

/**
 * Löschen, Entziehen, Widerrufen. Rot, aber nicht laut: Eine Handlung, die man bereuen
 * kann, soll erkennbar sein, ohne wie die Haupt-Aktion um Aufmerksamkeit zu bitten.
 */
export const BTN_DANGER = `${BTN_MD} bg-accent/10 text-accent`;
export const BTN_DANGER_SM = `${BTN_SM} bg-accent/10 text-accent`;

// ── Status ───────────────────────────────────────────────────────────────────
//
// Gemeinsam: KEINE Füllung, eine Haarlinie, kleiner und leichter gesetzt als jeder Knopf,
// und niemals Press-Feedback. Die Linie nimmt die Farbe des Textes auf, damit ein Zustand
// als EIN Ding liest und nicht als Text in einem fremden Rahmen.
const STATUS = "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1";

/** Der Normalfall: eine sachliche Angabe ohne Wertung. */
export const STATUS_NEUTRAL = `${STATUS} text-muted ring-black/10`;
/** Hebt hervor, was zur Marke gehört oder Aufmerksamkeit verdient. */
export const STATUS_ACCENT = `${STATUS} text-accent ring-accent/25`;
/** Erledigt, veröffentlicht, gratis. Grün ist im Projekt schon die Farbe dafür. */
export const STATUS_GOOD = `${STATUS} text-emerald-700 ring-emerald-600/30`;
