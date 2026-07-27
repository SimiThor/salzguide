// Beschriftungen fürs Analytics-Dashboard. Deutsch, weil der Admin-Bereich deutsch ist.
//
// WARUM DAS NICHT IN DER SEITE STEHT: `classifyPath` (lib/analytics.ts) und diese Tabelle
// müssen zusammenpassen. Wer dort eine Seitenart ergänzt und hier nicht, bekommt im
// Dashboard den Rohwert zu sehen — „tours" statt „Touren (Liste)". Das ist kein Absturz und
// kein Fehler im Log, es sieht nur aus wie ein Programmierfehler, der es dann auch ist.
//
// Hier importiert scripts/analytics-check.ts sie und prüft gegen die echten Routen der App,
// dass jede Seitenart, die entstehen kann, auch einen Namen hat. Aus einer Konvention wird
// eine Prüfung.

/**
 * Seitenarten, die `classifyPath` NICHT MEHR vergibt, die aber in der Tabelle stehen.
 *
 * Reichweitendaten bleiben 14 Monate liegen. Eine Auswertung sieht also immer auch Kennungen,
 * die der heutige Code gar nicht mehr erzeugen kann — und die brauchen genauso einen Namen,
 * denn im Dashboard steht sonst der Rohwert.
 *
 * `home` ist der Grund, warum diese Liste existiert, und ein besonders unangenehmer Fall:
 * Bis 07/2026 war die Wurzel der App die KARTE. „home" heisst in Altdaten also
 * Karten-Aufruf, nicht Startseiten-Aufruf. Unbeschriftet stünde dort „home", und jeder
 * würde es als Startseite lesen — eine Zahl, die stimmt, unter einem Namen, der lügt.
 * Deshalb steht das Datum im Label.
 *
 * Beim Anlegen einer neuen Kennung in `classifyPath` gehört die alte HIER hinein, nicht
 * gelöscht. scripts/analytics-check.ts prüft beide Listen.
 */
export const LEGACY_KINDS: Record<string, string> = {
  home: "Karte (bis 07/2026)",
};

export const KIND_LABELS: Record<string, string> = {
  landing: "Startseite",
  explore: "Karte",
  spot: "Spot-Seiten",
  events: "Events",
  water: "Wasser",
  tours: "Touren (Liste)",
  tour: "Tour-Seiten",
  pro: "Pro (Verkauf)",
  saved: "Merkliste",
  profile: "Profil",
  about: "Über uns",
  support: "Hilfe",
  legal: "Rechtliches",
  demo: "Demo",
  // „Sonstige" ist KEIN Sammelbecken für vergessene Routen mehr (dafür sorgt der Check),
  // sondern das, was übrig bleibt: aufgerufene Adressen, die es in der App nicht gibt —
  // alte Links von der WordPress-Seite, Tippfehler, Scanner. Dass der Posten gross ist,
  // ist deshalb selbst eine Information und kein Messfehler.
  other: "Sonstige Adressen",
  ...LEGACY_KINDS,
};

export const SOURCE_LABELS: Record<string, string> = {
  direct: "Direkt",
  search: "Suche",
  social: "Social Media",
};

export const DEVICE_LABELS: Record<string, string> = {
  mobile: "Mobil",
  desktop: "Desktop",
  tablet: "Tablet",
  other: "Sonstige",
};

export const EVENT_CAT_LABELS: Record<string, string> = {
  party: "Party",
  tradition: "Tradition",
  kultur: "Kultur",
  sport: "Sport",
  kids: "Kids",
};
