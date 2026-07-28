import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";

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

// og:locale erwartet die Unterstrich-Form (de_AT); bcp47 liefert Bindestriche (de-AT).
function ogLocale(code: string): string {
  return localeMeta(code).bcp47.replace("-", "_");
}

/**
 * Open-Graph- + Twitter-Card für EINE Seite — die Link-Vorschau in WhatsApp, iMessage,
 * Slack, X & Co. Wie `alternatesFor` PRO SEITE aufrufen, nie im Layout: Next merged
 * Metadata nach unten, ein `openGraph` im Layout würde jeder Unterseite ohne eigenes
 * die Startseiten-Vorschau unterschieben (dieselbe Falle wie oben bei `alternates`).
 *
 * `image`: absolute Foto-URL (z. B. Spot-Hero aus Supabase). Ohne Angabe kommt das
 * Marken-Standardbild (public/og-default.png, erzeugt von scripts/make-icons.ts).
 * Relative Pfade löst Next über metadataBase aus dem Layout zu absoluten URLs auf.
 */
export function ogFor(opts: {
  locale: string;
  path: string; // ohne Sprach-Präfix, wie bei alternatesFor
  title: string;
  description?: string | null;
  image?: string | null;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const description = opts.description ?? undefined;
  const image = opts.image ?? "/og-default.png";
  return {
    openGraph: {
      type: "website",
      siteName: "SalzGuide",
      locale: ogLocale(opts.locale),
      url: `/${opts.locale}${opts.path}`,
      title: opts.title,
      description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description,
      images: [image],
    },
  };
}
