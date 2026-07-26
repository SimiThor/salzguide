// ZENTRALE Firmen-/Rechtsdaten für alle Rechtstexte (Impressum, Datenschutz, AGB, Widerruf).
// HIER die echten Werte EINMAL eintragen -> alle Seiten aktualisieren sich automatisch.
// Betreiber: Anton Steiner, Einzelunternehmer (GISA statt Firmenbuch). Vor Live anwaltlich prüfen.
export const LEGAL = {
  brand: "SalzGuide",
  company: "Anton Steiner",
  owner: "Anton Steiner",
  legalForm: "Einzelunternehmen",
  street: "Funkestraße 5",
  zip: "5020",
  city: "Salzburg",
  country: "Österreich",
  email: "anton@steinermedia.at",
  phone: "+43 664 5279354",
  vatId: "ATU77969058",
  // GISA-Zahl (Gewerbeinformationssystem Austria) – für Einzelunternehmer statt Firmenbuch.
  gisa: "34773253",
  trade: "Filmproduktion",
  authority: "Magistrat der Stadt Salzburg – Gewerbebehörde",
  chamber: "Wirtschaftskammer Salzburg (WKS)",
  // Grundlegende Richtung / Blattlinie nach §25 MedienG.
  editorialLine:
    "SalzGuide ist ein unabhängiger digitaler Reise- und Freizeitführer für das Salzburger Land mit kuratierten Orten, Audio-Touren und einem KI-Assistenten.",
  // Muss mitwandern, sobald sich der Inhalt der Rechtstexte ändert: Ein "Stand" von gestern
  // unter einer Erklärung von heute ist selbst eine falsche Angabe. Zuletzt: Gerätespeicher
  // vollständig aufgelistet (Cookies, localStorage, Karte), Social-Media-Profile und die
  // Instagram-Kacheln als eigene Abschnitte; Meta ist KEIN Empfänger (die Bilder laden wir
  // selbst hoch, es gibt keinen Abruf dort) (26.07.2026).
  updated: "26. Juli 2026",
} as const;

// Vollständige Postanschrift als einzeiliger String.
export function legalAddress(): string {
  return `${LEGAL.street}, ${LEGAL.zip} ${LEGAL.city}, ${LEGAL.country}`;
}

// Metadaten für die Rechtstexte. Diese Seiten sind BEWUSST nur auf Deutsch (rechtlich
// verbindlich = deutsche Fassung), werden aber unter jeder Sprach-URL identisch gezeigt.
// Damit Google sie NICHT als „übersetzte Alternativen" missversteht, zeigt die Canonical
// immer auf die /de-Version und wir setzen KEINE per-Sprache-hreflang (nur x-default -> /de).
// (Ein `alternates`-Objekt auf der Seite ERSETZT die vom Root-Layout geerbten Alternates
// vollständig – deshalb hier explizit Canonical + x-default.) Zusätzlich sind die Seiten
// via rechtliches/layout.tsx auf `noindex` gesetzt.
export function legalMetadata(
  slug: "agb" | "datenschutz" | "impressum" | "widerruf",
  title: string,
): import("next").Metadata {
  const de = `/de/rechtliches/${slug}`;
  return {
    title,
    alternates: { canonical: de, languages: { "x-default": de } },
  };
}
