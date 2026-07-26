// Die EINE Quelle der Rechtslinks (Fußzeile, iPhone-Burger, PC-„Mehr"-Menü) — dasselbe
// Muster wie lib/nav.ts für die Hauptnavigation. Sie MUSS geteilt sein, und zwar nicht aus
// Ordnungsliebe: Bis 07/2026 stand im Burger-Menü nur der fertige Satz „Impressum ·
// Datenschutz · AGB" als Übersetzungstext (Menu.legal). Das sah exakt wie drei Links aus,
// war aber toter Text — auf der Vollbild-Karte, wo sich die Fußzeile selbst ausblendet, war
// das Impressum am Handy damit überhaupt nicht erreichbar. § 5 ECG will es „unmittelbar und
// leicht" zugänglich. Eine Liste, aus der jede Stelle echte <Link> baut, kann diesen Fehler
// nicht wiederholen.
//
// `ns` steht je Eintrag dabei, weil „Hilfe" aus dem Support-Namensraum kommt und der Rest
// aus Legal.
//
// Reihenfolge (bewusst, gilt überall gleich):
//   1. Hilfe — wer hier unten landet, sucht meist jemanden zum Reden, nicht das Impressum.
//   2. Widerruf — § 13a FAGG / EU-RL 2023/2673 (ab 01.10.2026 in Österreich): login-frei,
//      global, leicht zugänglich.
//   3. Datenschutz, 4. Impressum, 5. AGB.

export type LegalLink = {
  /** Ziel ohne Sprach-Präfix (für <Link> aus @/i18n/navigation). */
  href: string;
  /** Übersetzungs-Key innerhalb von `ns`. */
  key: string;
  /** Namensraum in messages/*.json. */
  ns: "Legal" | "Support";
};

export const LEGAL_LINKS: readonly LegalLink[] = [
  { href: "/support", key: "linkLabel", ns: "Support" },
  { href: "/rechtliches/widerruf", key: "cancelContract", ns: "Legal" },
  { href: "/rechtliches/datenschutz", key: "privacy", ns: "Legal" },
  { href: "/rechtliches/impressum", key: "imprint", ns: "Legal" },
  { href: "/rechtliches/agb", key: "terms", ns: "Legal" },
] as const;
