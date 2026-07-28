// Reihenfolge der Explore-Regale: Stufen + Abwechslungs-Regel (Konzept: docs/38).
//
// Ein Spot hat EINE Gewichtungs-Stufe (spots.sort_weight, Migration 0059) statt einer
// frei vergebenen Zahl: 3 Highlight, 2 Stark, 1 Normal, 0 Zurückhaltend. Die Stufe sagt
// nur, wie gut der Spot für sich ist — WO er in welchem Regal steht, wird hier gerechnet.
//
// Die Abwechslungs-Regel löst das "Hochkeil zweimal auf Platz 1"-Problem: Sortieren alle
// Regale nach derselben Zahl, steht der stärkste Spot in jedem seiner Regale ganz vorne,
// und die Seite fühlt sich an, als gäbe es nur fünf Spots. Deshalb gilt, Regal für Regal
// von oben nach unten:
//
//   1. Im ersten Regal zählt nur die Stufe — die Top-Kategorie zeigt wirklich das Beste.
//   2. Wer einen der ersten TOP_SLOTS Plätze bekommt (das ist, was beim Aufklappen ohne
//      Wischen sichtbar ist), gilt ab da als "schon vorne gewesen".
//   3. In jedem weiteren Regal kommen ERST die Spots, die noch nicht vorne waren (nach
//      Stufe), DANN die schon gezeigten (nach Stufe), GANZ hinten die Zurückhaltenden.
//      So bekommt jedes Regal frische Gesichter, ohne dass ein Highlight hinter die
//      Füller rutscht oder gar verschwindet.
//
// Sommer und Winter sind getrennte Seiten und werden getrennt gerechnet: Was im
// Sommer vorne stand, kostet im Winter nichts.
//
// Bewusst DETERMINISTISCH (kein Zufall): Das Ergebnis liegt im Katalog-Cache
// (getExploreData). Zufall hieße, dass die Seite bei jeder Cache-Erneuerung anders
// aussieht und ein Screenshot nie dem entspricht, was der Nächste sieht. Als
// Feinsortierung bei gleicher Stufe gewinnen neuere Spots (frischer Inhalt zeigt sich
// von selbst), danach entscheidet der Slug — stabil, springt nie.
//
// Reines Rechenmodul ohne Imports: läuft auf dem Server UND im Prüf-Skript
// (npm run ranking:check), das die ECHTE Funktion importiert statt sie nachzubauen.

/** So viele Plätze pro Regal gelten als "vorne" und zählen als gezeigt. Entspricht den
 *  Karten, die beim Aufklappen des Sheets ohne Wischen im Bild stehen (Explore.tsx lädt
 *  aus demselben Grund genau die ersten drei Bilder eager). */
export const TOP_SLOTS = 3;

/** Die vier Stufen als eine Quelle für Admin-Formular, Prüf-Skript und Doku. */
export const WEIGHT_TIERS = [
  { value: 3, label: "Highlight", hint: "Das Beste vom Land, darf in den Regalen vorne stehen." },
  { value: 2, label: "Stark", hint: "Sehr gut, vordere Hälfte." },
  { value: 1, label: "Normal", hint: "Der Standard für jeden guten Spot." },
  { value: 0, label: "Zurückhaltend", hint: "Füllt Regale auf, steht hinten." },
] as const;

export type RankCategory = { key: string; season: string; sortOrder: number };

export type RankSpot = {
  slug: string;
  /** Gewichtungs-Stufe 0..3 (spots.sort_weight). */
  weight: number;
  /** ISO-Zeitstempel — vergleicht sich als String korrekt, kein Date nötig. */
  createdAt: string;
  seasons: string[];
  categoryKeys: { key: string; season: string }[];
};

/** Schlüssel eines Regals in der Ergebnis-Map. */
export const shelfKey = (key: string, season: string): string => `${season}:${key}`;

// String-Vergleich ohne localeCompare: Der hängt an der Locale der Umgebung, und die
// Reihenfolge soll auf jedem Server und im Prüf-Skript exakt gleich ausfallen.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Rechnet für jedes Regal (Kategorie je Saison) die fertige Spot-Reihenfolge.
 * Ergebnis: shelfKey(key, season) -> Slugs in Anzeige-Reihenfolge.
 */
export function rankShelves(
  categories: RankCategory[],
  spots: RankSpot[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();

  // Je Saison eine eigene Rechnung mit eigenem "schon vorne gewesen"-Gedächtnis.
  const seasons = [...new Set(categories.map((c) => c.season))];
  for (const season of seasons) {
    const featured = new Set<string>();
    const shelves = categories
      .filter((c) => c.season === season)
      // Dieselbe Reihenfolge, in der die Regale auf der Seite stehen — nur so trifft
      // "schon vorne gewesen" die Regale, die der Nutzer danach sieht.
      .sort((a, b) => a.sortOrder - b.sortOrder || cmp(a.key, b.key));

    for (const shelf of shelves) {
      const candidates = spots.filter(
        (s) =>
          s.seasons.includes(season) &&
          s.categoryKeys.some((ck) => ck.key === shelf.key && ck.season === season),
      );
      // Drei Gruppen, innerhalb jeder nach Stufe: erst die frischen Gesichter, dann die
      // schon gezeigten, ganz hinten die Zurückhaltenden (deren Definition "steht
      // hinten" ist — auch hinter schon gezeigten Highlights).
      const group = (s: RankSpot) => (featured.has(s.slug) ? 1 : s.weight === 0 ? 2 : 0);
      candidates.sort(
        (a, b) =>
          group(a) - group(b) ||
          b.weight - a.weight ||
          cmp(b.createdAt, a.createdAt) ||
          cmp(a.slug, b.slug),
      );
      out.set(shelfKey(shelf.key, season), candidates.map((s) => s.slug));
      for (const s of candidates.slice(0, TOP_SLOTS)) featured.add(s.slug);
    }
  }

  return out;
}
