// Bausteine für strukturierte Daten (schema.org, JSON-LD) — gerendert über
// components/JsonLd.tsx. Google nutzt sie für Rich Results, KI-Suchen (ChatGPT,
// Perplexity) lesen sie als maschinenlesbare Zusammenfassung der Seite.
//
// SICHERHEITSREGEL: Die Builder bekommen ausschliesslich Daten, die ohnehin auf der
// Seite stehen — für Spots also das bereits geschwärzte SpotDetail. Ein gesperrter
// Pro-Spot liefert null: Koordinaten, Titel und Fotos eines Geheimtipps haben in
// Metadaten genauso wenig verloren wie im sichtbaren HTML.
//
// `undefined`-Felder verschwinden bei JSON.stringify von selbst — deshalb stehen hier
// bewusst `?? undefined`-Ketten statt bedingter Objekt-Bastelei.

import { siteUrl } from "@/lib/site-url";
import { SOCIAL_PROFILES } from "@/lib/social";
import { bcp47 } from "@/i18n/locales";
import { factArea } from "@/lib/facts-i18n";
import type { SpotDetail } from "@/lib/spots";
import type { EventItem } from "@/lib/events";

/** Die Organisation hinter der Seite — einmal auf der Startseite. */
export function organizationLd() {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "SalzGuide",
    url: base,
    logo: `${base}/icons/icon-512.png`,
    sameAs: SOCIAL_PROFILES.map((p) => p.url),
  };
}

/** Die Website als Ganzes — einmal auf der Startseite, in der Sprache des Besuchers. */
export function webSiteLd(locale: string) {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "SalzGuide",
    url: `${base}/${locale}`,
    inLanguage: bcp47(locale),
  };
}

/**
 * Ein Spot als TouristAttraction (activity) bzw. FoodEstablishment (food).
 * Gesperrte Pro-Spots liefern null — siehe Sicherheitsregel im Dateikopf.
 */
export function spotLd(spot: SpotDetail, locale: string) {
  if (spot.locked) return null;
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": spot.type === "food" ? "FoodEstablishment" : "TouristAttraction",
    name: spot.title,
    description: spot.shortDesc ?? undefined,
    image: spot.images[0] ?? undefined,
    url: `${base}/${locale}/spot/${spot.slug}`,
    telephone: spot.phone ?? undefined,
    geo:
      spot.lat != null && spot.lng != null
        ? { "@type": "GeoCoordinates", latitude: spot.lat, longitude: spot.lng }
        : undefined,
    address: {
      "@type": "PostalAddress",
      // Gebiets-Label in der Sprache des Besuchers (facts-i18n), wenn gepflegt.
      addressLocality: spot.area ? factArea(spot.area, locale) : undefined,
      addressRegion: "Salzburg",
      addressCountry: "AT",
    },
  };
}

/**
 * Brotkrumen-Pfad (Startseite -> Entdecken -> Spot). `items` sind Name + Pfad OHNE
 * Sprach-Präfix, in Reihenfolge; die letzte Station (die Seite selbst) ohne Link.
 */
export function breadcrumbLd(locale: string, items: { name: string; path?: string }[]) {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.path != null ? `${base}/${locale}${it.path}` : undefined,
    })),
  };
}

/**
 * Frage-Antwort-Seiten als FAQPage („Gut zu wissen").
 *
 * Genau dafür ist der Typ gedacht: eine Seite, die aus Fragen mit je EINER Antwort
 * besteht. Google zeigt daraus zwar nur noch selten Rich Results, aber die KI-Suchen
 * lesen die Liste als fertige Antwort auf „Braucht man in Salzburg Bargeld?" — und
 * genau diese Fragen tippt unsere Zielgruppe heute in ChatGPT statt in Google.
 *
 * Voraussetzung von schema.org: Die Antworten müssen auch SICHTBAR auf der Seite stehen.
 * Das tun sie, deshalb klappt die Seite mit <details> auf und nicht über JavaScript
 * (siehe components/Disclosure.tsx).
 */
export function faqLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

/**
 * Die Event-Liste als ItemList aus schema.org-Events. Ohne Strassenadresse in der DB
 * gibt es keine Rich-Result-Garantie von Google — für KI-Suchen ist die Liste trotzdem
 * die maschinenlesbare Antwort auf "Was ist los in Salzburg?".
 */
export function eventsLd(events: EventItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: events.map((e, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Event",
        name: e.title,
        description: e.description ?? undefined,
        startDate: e.startsAt,
        endDate: e.endsAt ?? undefined,
        image: e.imageUrl ?? undefined,
        isAccessibleForFree: e.isFree || undefined,
        location: e.locationName
          ? { "@type": "Place", name: e.locationName }
          : undefined,
      },
    })),
  };
}
