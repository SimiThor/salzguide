// Der rote Haupt-Knopf der Startseite. EINE Quelle, weil es sonst fünf werden.
//
// Genau das war hier der Fall: px-4 py-2, px-5 py-4, px-6 py-3.5, px-6 py-4 und px-8 py-4,
// fünf Grössen für denselben Knopf, jede beim Schreiben der jeweiligen Section erfunden.
// Auf einer Seite, die „aus einem Guss" wirken soll, ist das der Unterschied zwischen
// entworfen und zusammengetragen.
//
// Der Wert kommt NICHT von mir: Er ist Klasse für Klasse der Knopf aus ProLanding.tsx
// (der Kauf-Knopf auf /pro), also der Knopf, den die App ohnehin schon überall benutzt.
// Der rote Schatten unter der roten Fläche ist dabei die Signatur des SalzGuide-Designs
// (siehe globals.css) und gehört dazu.
export const CTA_PRIMARY =
  "rounded-full bg-accent px-5 py-4 text-[16px] font-semibold text-white " +
  "shadow-[0_10px_24px_-8px_rgba(204,41,36,0.6)] transition active:scale-[0.98]";

// Kompakte Fassung: nur für die Kopfzeile, wo ein 56px hoher Knopf die Leiste sprengen
// würde. Gleiche Farbe, gleicher Schatten, gleiche Rundung, nur kleiner.
//
// min-h-11 = 44px, Apples Mindestmass für ein Tap-Ziel. Ohne das war der Knopf am iPhone
// nachgemessen 37px hoch: sieht gut aus, trifft sich mit dem Daumen aber schlecht, und
// genau dieser Knopf ist ab dem ersten Scrollen der einzige Weg nach vorn. In die 60px
// hohe Leiste (--sg-header-h) passt er trotzdem locker.
export const CTA_COMPACT =
  "inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-[14px] font-semibold " +
  "text-white shadow-[0_10px_24px_-8px_rgba(204,41,36,0.6)] transition active:scale-[0.98] " +
  "md:px-5 md:text-[15px]";
