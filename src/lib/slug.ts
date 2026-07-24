// Slug-Bildung an EINER Stelle. Der Slug ist der URL-Schlüssel eines Spots, und er muss auf
// dem Client (Formular-Autofüllung aus dem Titel) und auf dem Server (Speichern) EXAKT gleich
// gerechnet werden. Vorher stand die Funktion nur im Formular; der Server speicherte den Slug
// roh (nur getrimmt) — ein von Hand getipptes „Hallstätter See!" landete wörtlich als URL.
//
// Umlaute werden ausgeschrieben (ä->ae), alles Übrige zu Bindestrichen zusammengezogen, führende
// und schließende Bindestriche fallen weg. Idempotent: ein schon gültiger Slug bleibt unverändert.
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
