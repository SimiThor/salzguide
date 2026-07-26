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

/**
 * Der senkrechte Abstand JEDER Section der Startseite. Dieselbe Begründung wie beim
 * Seitenrand darüber, nur in der anderen Richtung.
 *
 * Nachgemessen war der Rhythmus vorher (Abstand von einem Block zum nächsten, am iPhone):
 * 112, 120, 128, 128, 128, 120, 72. Drei Sections liefen auf py-14/py-20, vier auf
 * py-16/py-24, und der Schluss-CTA hing mit pt-4 nur 72px unter seinem Vorgänger. Einzeln
 * fällt keine dieser Zahlen auf, zusammen ist es der Unterschied zwischen einer Seite, die
 * atmet, und einer, die stellenweise zusammenzuckt.
 *
 * 64px am Handy, 96px am Desktop, an jeder Naht. Zwei aneinandergrenzende Sections ergeben
 * damit überall dieselben 128 bzw. 192px Luft.
 *
 * BEWUSSTE AUSNAHME: Der Hero bringt keinen eigenen Abstand mit. Er endet mit Bild und
 * Knopf, und die erste Aussage darunter soll nah dran bleiben.
 */
export const LANDING_SECTION_Y = "py-16 md:py-24";
