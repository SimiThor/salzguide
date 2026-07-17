import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

// Canonical + hreflang für EINE Seite. Muss pro Seite gesetzt werden — das Layout darf
// es nicht: Next merged Metadata nach unten, ein `alternates` im Layout würde also JEDER
// Unterseite die Startseite als Original andrehen. Genau das war bis 07/2026 der Fall
// (/wasser, /events, /touren, /gespeichert, /pro zeigten alle auf „/"): kein Build-
// Fehler, keine Warnung, die Seiten wurden schlicht nicht sauber indexiert.
//
// `path` ist der Pfad OHNE Sprach-Präfix, mit führendem Slash oder leer für die
// Startseite (z. B. "" | "/explore" | "/spot/nockstein").
export function alternatesFor(locale: string, path: string): Metadata["alternates"] {
  return {
    canonical: `/${locale}${path}`,
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}${path}`])),
      "x-default": `/${routing.defaultLocale}${path}`,
    },
  };
}
