import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { createServiceClient } from "@/lib/supabase/service";
import { siteUrl } from "@/lib/site-url";

// Mehrsprachige Sitemap: jede indexierbare Route × alle Sprachen, jeweils mit hreflang-
// Alternates. Neue Sprache in locales.ts => automatisch in der Sitemap. Rechts-Seiten
// (noindex) + Admin sind bewusst NICHT enthalten.

// Ohne revalidate friert Next die Sitemap beim Build ein — ein neuer Spot stünde erst
// nach dem nächsten Deploy drin. Eine Stunde ist für Google mehr als frisch genug.
export const revalidate = 3600;

// Statische, öffentlich indexierbare Pfade (relativ, ohne Sprach-Präfix).
// "" = Startseite (erklärt das Produkt), "/explore" = die Karte.
const STATIC_PATHS = [
  "",
  "/explore",
  "/touren",
  "/wasser",
  "/events",
  "/pro",
  "/ueber-uns",
  "/support",
];

// Seiten, deren Inhalt sich laufend ändert (neue Spots/Events) — im Gegensatz zur
// Startseite, die als Verkaufsseite selten angefasst wird. Bis 07/2026 war „" selbst
// die Karte; die Annahme „Wurzel = ändert sich oft" stimmt seit dem Umzug nicht mehr.
const WEEKLY_PATHS = new Set(["/explore", "/events"]);

// Priorität: Startseite 1 (Einstieg), Karte 0.9 (das Produkt), Rest 0.7.
function priorityFor(path: string): number {
  if (path === "") return 1;
  if (path === "/explore") return 0.9;
  return 0.7;
}

function languagesFor(path: string): Record<string, string> {
  const base = siteUrl();
  return {
    ...Object.fromEntries(routing.locales.map((l) => [l, `${base}/${l}${path}`])),
    // x-default = die Adresse für "keine der Sprachen passt" — wie in alternatesFor()
    // (lib/metadata.ts) zeigt sie auf die Standardsprache. Sitemap und <head> müssen
    // dasselbe sagen, sonst widersprechen sich die beiden hreflang-Quellen.
    "x-default": `${base}/${routing.defaultLocale}${path}`,
  };
}

function entriesForPath(
  path: string,
  priority: number,
  // Nur für Inhalte mit echtem DB-Zeitstempel (Spots/Touren). Statische Seiten bekommen
  // bewusst KEIN Datum: Das Build-Datum wäre gelogen und Google straft wackelnde
  // lastmod-Angaben mit Ignorieren der ganzen Spalte.
  lastModified?: Date,
): MetadataRoute.Sitemap {
  const languages = languagesFor(path);
  const base = siteUrl();
  return routing.locales.map((locale) => ({
    url: `${base}/${locale}${path}`,
    alternates: { languages },
    changeFrequency: WEEKLY_PATHS.has(path) ? "weekly" : "monthly",
    priority,
    ...(lastModified ? { lastModified } : {}),
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.flatMap((p) =>
    entriesForPath(p, priorityFor(p)),
  );

  // Dynamische Inhalte (veröffentlichte Spots + Touren) × alle Sprachen.
  try {
    const svc = createServiceClient();
    const [{ data: spots }, { data: tours }] = await Promise.all([
      // Pro-Spots NICHT indexieren: Slugs sind sprechend ("liechtensteinklamm"), die
      // Sitemap würde also den Namen jedes Geheimtipps ausplaudern – während wir
      // daneben Koordinaten runden und Titel schwärzen. Ihre Seiten zeigen ohnehin nur
      // die Paywall, haben für Google also keinen Inhalt.
      svc
        .from("spots")
        .select("slug, updated_at")
        .eq("status", "published")
        .eq("is_pro", false),
      svc.from("tours").select("slug, updated_at").eq("status", "published"),
    ]);
    for (const s of spots ?? [])
      entries.push(...entriesForPath(`/spot/${s.slug}`, 0.6, new Date(s.updated_at)));
    for (const t of tours ?? [])
      entries.push(...entriesForPath(`/touren/${t.slug}`, 0.5, new Date(t.updated_at)));
  } catch (e) {
    console.error("sitemap dynamic entries failed:", e);
  }

  return entries;
}
