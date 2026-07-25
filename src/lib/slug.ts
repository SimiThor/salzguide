// Die EINE Slug-Funktion für interne Keys (Kategorien, Touren, Gebiete, Punkte,
// Anker, Tracking-Links). Vorher stand dieselbe Funktion viermal fast wortgleich im
// Code (admin-actions, tour-actions, tour-pool-actions, anchor-actions) und einmal
// OHNE Umlaut-Behandlung im AdLinkBuilder („Frühjahr" wurde zu „fr-hjahr").
//
// Bewusst NICHT locale-abhängig: Diese Slugs sind stabile Matching-Tokens in der DB
// und in Tracking-URLs, keine Nutzer-Texte. Deutsch (ä/ö/ü/ß) ist die Eingabesprache.
export function slugifyKey(s: string, maxLen = 40): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
}
