import { siteUrl } from "@/lib/site-url";

// llms.txt: Kurzvorstellung der Seite für KI-Suchen (ChatGPT, Perplexity & Co.), analog
// zu robots.txt für Crawler. Als Route-Handler statt Datei in public/, weil die absolute
// Adresse aus siteUrl() kommen muss (Domain-Umzug steht an, nichts hartkodieren).
// Keine Request-Daten nötig -> statisch beim Build (Route-Handler sind sonst
// standardmäßig dynamisch, auch ohne Grund).
export const dynamic = "force-static";

export function GET() {
  const base = siteUrl();
  const body = `# SalzGuide

> Ausflugsziele im Salzburger Land auf einer Karte: Wanderungen, Seen, Almen, Aussichtspunkte und Wirtshäuser. Jeden Spot haben wir selbst besucht, zu jedem gibt es einen ehrlichen Tipp. Deutsch ist die Basis, die Seite gibt es in 13 Sprachen.

## Kernseiten (Deutsch)

- [Karte mit allen Spots](${base}/de/explore): Alle Ausflugsziele auf einer Karte, nach Kategorien und Saison sortiert
- [Startseite](${base}/de): Was SalzGuide ist und wie es funktioniert
- [Wassertemperaturen](${base}/de/wasser): Aktuelle Wassertemperaturen der Salzburger Seen
- [Events](${base}/de/events): Veranstaltungen im Salzburger Land
- [Audio-Touren](${base}/de/touren): Geführte Runden zum Anhören
- [SalzGuide Pro](${base}/de/pro): Unsere Geheimtipps, einmal zahlen statt Abo

## Core pages (English)

- [Map with all spots](${base}/en/explore): Things to do in the Salzburg region on one map
- [Start page](${base}/en): What SalzGuide is and how it works
- [Water temperatures](${base}/en/wasser): Current water temperatures of Salzburg's lakes
- [Events](${base}/en/events): What's on in the Salzburg region
- [Audio tours](${base}/en/touren): Guided walks to listen to
- [SalzGuide Pro](${base}/en/pro): Our secret spots, one payment instead of a subscription

## Weitere Sprachen / More languages

- it, nl, ko, fr, zh, es, pt, pl, cs, hu, sk: gleiche Pfade mit anderem Sprachkürzel, z. B. ${base}/it/explore
- Vollständige Seitenliste / full page list: ${base}/sitemap.xml

## KI-Transparenz / AI transparency

- Teile der Inhalte sind KI-unterstützt entstanden (Entwürfe, Übersetzungen, die Stimme der Audio-Touren) und redaktionell geprüft. Details: ${base}/de/ki bzw. ${base}/en/ki
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
