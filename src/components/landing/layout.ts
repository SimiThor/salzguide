// Die Container-Breite und der Seitenrand der Startseite. EINE Quelle, weil es sonst
// pro Section eine eigene wird.
//
// Genau das war der Fall: sechs Sections auf px-6, der TrustStrip auf px-4. Acht Pixel,
// die niemand einzeln bemerkt, aber die Kacheln standen dadurch sichtbar weiter aussen als
// die Überschrift darunter. Auf einer Seite, die „aus einem Guss" wirken soll, ist so ein
// Versatz der Unterschied zwischen entworfen und zusammengetragen. (Derselbe Fehler wie bei
// den fünf Button-Grössen in cta.ts und dem zweiten Pro-Look: pro Baustelle neu erfunden.)
//
// 1200px: die Breite, auf die sich alle Sections ohnehin schon geeinigt hatten.
// px-6 (24px): der Rand, den der Hero und alle Text-Sections nutzen. Auch die Kopfzeile
// landet ab md dort (sie ist mobil bewusst enger, damit die Leiste nicht bricht).
export const LANDING_CONTAINER = "mx-auto w-full max-w-[1200px] px-6";

// Ohne Rand: für Sections, die selbst full-bleed sein wollen (Karussell), und die den Rand
// an ihre innere Schiene weiterreichen (railPadClass="px-6"). Dann beginnt die erste Karte
// exakt unter der Überschrift und die letzte schneidet am Bildschirmrand an.
export const LANDING_CONTAINER_BLEED = "mx-auto w-full max-w-[1200px]";
