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
  other: "Sonstige",
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
