// Slug-Bildung an EINER Stelle. Zwei verwandte, aber verschiedene Aufgaben:
//
// slugify: der URL-Schlüssel eines SPOTS. Muss auf dem Client (Formular-Autofüllung aus
// dem Titel) und auf dem Server (Speichern) EXAKT gleich gerechnet werden. Vorher stand
// die Funktion nur im Formular; der Server speicherte den Slug roh (nur getrimmt), ein
// von Hand getipptes „Hallstätter See!" landete wörtlich als URL. Idempotent: ein schon
// gültiger Slug bleibt unverändert. KEINE Längen-Kappung.
//
// slugifyKey: interne Matching-Tokens (Kategorien, Touren, Gebiete, Punkte, Anker,
// Tracking-Links) mit Längen-Kappung. Vorher stand dieselbe Funktion viermal fast
// wortgleich im Code und einmal OHNE Umlaut-Behandlung im AdLinkBuilder („Frühjahr"
// wurde zu „fr-hjahr").
//
// Beide bewusst NICHT locale-abhängig: Deutsch (ä/ö/ü/ß) ist die Eingabesprache.

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

export function slugifyKey(s: string, maxLen = 40): string {
  return slugify(s).slice(0, maxLen).replace(/-+$/, "");
}
