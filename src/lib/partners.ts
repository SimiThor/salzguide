// Die EINE Quelle der Partner-Nennung (Copyright-Satz + Logos) — dasselbe Muster wie
// lib/social.ts für die Profile und lib/legal-links.ts für die Rechtslinks.
//
// WARUM ES SIE GIBT: Die Spot-Fotos und -Videos sind in Kooperation mit SalzburgerLand
// Tourismus und Gasteinertal Tourismus entstanden. Die Nennung samt Logos auf jeder
// Seite ist Teil der Vereinbarung über die Weiternutzung dieser Inhalte auf SalzGuide —
// sie ist Pflicht, nicht Deko. Wer sie von einer Seite entfernt, entfernt eine
// vertragliche Zusage. Auf der alten WordPress-Seite stand sie aus demselben Grund in
// der Fusszeile jeder Seite.
//
// Gerendert wird sie ausschliesslich über components/PartnerCredits.tsx: im globalen
// LegalFooter und, weil der auf den Vollbild-Karten nicht rendert (lib/routes.ts),
// zusätzlich am Ende der dortigen Panels (Explore, Wasser, Touren).
//
// KEIN ENV, KEINE DB: Partner, Adressen und Logos ändern sich nur mit dem Vertrag.

export type PartnerKey = "salzburgerland" | "gastein" | "steinerMedia" | "thorSolutions";

export type Partner = {
  key: PartnerKey;
  /**
   * Markenname. Kein Übersetzungs-Key: Marken werden nicht übersetzt. Zugleich der
   * zugängliche Name des Logo-Links (alt-Text am Bild).
   */
  name: string;
  /** Öffentliche Startseite des Partners. */
  url: string;
  /** Logo unter public/partners/. SVG, wo eines verfügbar war, sonst WebP mit Transparenz. */
  logo: string;
  /** Intrinsische Masse des Logos (Layout-Hinweis fürs <img>, verhindert Springen). */
  width: number;
  height: number;
  /**
   * Anzeigehöhe in px, PRO Logo statt einer Reihenhöhe: Die Schrift füllt in jedem Logo
   * einen anderen Anteil der Fläche (SalzburgerLand trägt Farbtupfer über und unter dem
   * Schriftzug, Gastein ist eine reine Wortmarke). Eine gemeinsame Höhe sähe deshalb
   * ungleich aus, obwohl sie gleich wäre — angeglichen wird die WIRKUNG, nicht die Zahl.
   */
  displayHeight: number;
};

// Reihenfolge (bewusst, gilt überall gleich): erst die beiden Verbände, deren Inhalte
// es sind — dieselbe Reihenfolge wie im Copyright-Satz —, dann die beiden Firmen
// hinter SalzGuide.
export const PARTNERS: readonly Partner[] = [
  {
    key: "salzburgerland",
    name: "SalzburgerLand Tourismus",
    url: "https://www.salzburgerland.com/",
    logo: "/partners/salzburgerland.svg",
    width: 125,
    height: 47,
    displayHeight: 32,
  },
  {
    key: "gastein",
    name: "Gasteinertal Tourismus",
    url: "https://www.gastein.com/",
    logo: "/partners/gastein.svg",
    width: 987,
    height: 224,
    displayHeight: 17,
  },
  {
    key: "steinerMedia",
    name: "Steiner Media",
    url: "https://www.steinermedia.at/",
    logo: "/partners/steiner-media.webp",
    width: 360,
    height: 108,
    displayHeight: 22,
  },
  {
    key: "thorSolutions",
    name: "Thor Solutions",
    url: "https://www.thorsolutions.at/",
    logo: "/partners/thor-solutions.webp",
    width: 360,
    height: 108,
    // 2px mehr als Steiner Media: Die Wortmarke trägt in der Datei mehr Luft um sich
    // und wirkt bei gleicher Zahl kleiner. Angeglichen ist die Wirkung, siehe oben.
    displayHeight: 24,
  },
] as const;

/** Ein einzelner Partner, z.B. für die Links IM Copyright-Satz. */
export function partner(key: PartnerKey): Partner {
  // Der Fund ist garantiert: PARTNERS enthält jeden Key genau einmal. Der Fallback
  // existiert nur, damit der Typ ohne `!` auskommt (dasselbe Muster wie socialProfile).
  return PARTNERS.find((p) => p.key === key) ?? PARTNERS[0];
}
