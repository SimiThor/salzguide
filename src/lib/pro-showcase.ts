// Die Zahlen und Motive für „Was drin ist" auf /pro (components/ProShowcase.tsx).
//
// Service-Client, weil die RLS anonymen Lesern die Pro-Spots verbirgt (Migration 0017), und
// genau die werden hier gezählt. Unbedenklich, weil diese Funktion nur Zahlen, übersetzte
// Regal- und Art-Namen und Blur-Vorschauen verlässt (deren Dateiname ist eine Zufalls-ID).
// Kein Slug, kein Titel, keine Gemeinde, keine Koordinate.
import { unstable_cache } from "next/cache";
import type { ProShowcaseData } from "@/components/ProShowcase";
import { createServiceClient } from "./supabase/service";
import { EXPLORE_REVALIDATE, SPOTS_TAG, heroPreviewFromMedia } from "./spots";
import { factSubtype } from "./facts-i18n";

// Regale mit weniger Pro-Spots stehen nicht in der Zahlenzeile: „1 Panoramastraße" liest
// sich wie ein Mangel, nicht wie ein Grund zu kaufen. Vier Regale plus Winter und Touren
// passen am iPhone auf zwei Zeilen.
const SHELF_MIN = 3;
const SHELF_MAX = 4;
// Sechs Motive: am iPhone sind knapp vier sichtbar, der Rest lädt zum Wischen ein.
const TILE_MAX = 6;

type CategoryRef = {
  key: string;
  season: string;
  sort_order: number | null;
  title_translations: Record<string, string> | null;
};
type Row = {
  slug: string;
  subtype: string | null;
  seasons: string[] | null;
  is_pro: boolean;
  sort_weight: number | null;
  created_at: string;
  spot_categories: { categories: CategoryRef | CategoryRef[] | null }[] | null;
};

const categoriesOf = (r: Row): CategoryRef[] =>
  (r.spot_categories ?? []).flatMap((l) =>
    Array.isArray(l.categories) ? l.categories : l.categories ? [l.categories] : [],
  );
const shelfId = (c: CategoryRef) => `${c.key}/${c.season}`;

/**
 * „Was drin ist" in der Sprache der Seite. Ein Ergebnis je Sprache, gecacht wie der Katalog
 * (SPOTS_TAG): Stellt jemand im Admin einen Spot um, zieht die Zahl mit. null, wenn es
 * nichts zu zeigen gibt oder die Abfrage scheitert: Dann bleibt die Pro-Seite, wie sie war.
 */
export function getProShowcase(locale: string): Promise<ProShowcaseData | null> {
  return unstable_cache(() => queryProShowcase(locale), ["pro-showcase", locale], {
    tags: [SPOTS_TAG],
    revalidate: EXPLORE_REVALIDATE,
  })();
}

async function queryProShowcase(locale: string): Promise<ProShowcaseData | null> {
  const svc = createServiceClient();
  const [spotsRes, toursRes] = await Promise.all([
    svc
      .from("spots")
      .select(
        "slug, subtype, seasons, is_pro, sort_weight, created_at, spot_categories(categories(key, season, sort_order, title_translations))",
      )
      .eq("status", "published"),
    // Nur zählen (head: true überträgt keine Zeilen).
    svc
      .from("tours")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .eq("is_pro", true),
  ]);
  if (spotsRes.error) {
    console.error("getProShowcase:", spotsRes.error.message);
    return null;
  }

  const rows = (spotsRes.data ?? []) as unknown as Row[];
  const pro = rows.filter((r) => r.is_pro);
  if (pro.length === 0) return null;

  // Pro-Spots je Regal. Ein Spot kann in zwei Regalen stehen (Seen UND leichte Wanderungen),
  // die Zahlen summieren sich also nicht zur Gesamtzahl. Jede einzelne stimmt.
  const shelves = new Map<string, { cat: CategoryRef; count: number }>();
  for (const r of pro) {
    for (const c of categoriesOf(r)) {
      const entry = shelves.get(shelfId(c)) ?? { cat: c, count: 0 };
      entry.count += 1;
      shelves.set(shelfId(c), entry);
    }
  }
  const label = (c: CategoryRef) => c.title_translations?.[locale] ?? c.title_translations?.de ?? c.key;

  const summerShelves = [...shelves.values()]
    .filter((s) => s.cat.season === "summer" && s.count >= SHELF_MIN)
    .sort((a, b) => b.count - a.count || (a.cat.sort_order ?? 0) - (b.cat.sort_order ?? 0))
    .slice(0, SHELF_MAX)
    .map((s) => ({ key: shelfId(s.cat), label: label(s.cat), count: s.count }));

  // Die Motive: je eines aus einem anderen Regal, in der Reihenfolge der Explore-Regale
  // (Sommer vor Winter). Innerhalb eines Regals zuerst eine Art, die noch nicht dran war,
  // damit nicht drei Bergseen nebeneinander stehen. Ohne Zufall: Das Ergebnis liegt im Cache,
  // und Zufall hiesse eine andere Seite nach jeder Erneuerung.
  const shelfOrder = [...shelves.values()]
    .map((s) => s.cat)
    .sort((a, b) =>
      a.season === b.season ? (a.sort_order ?? 0) - (b.sort_order ?? 0) : a.season === "summer" ? -1 : 1,
    );
  const byRank = (a: Row, b: Row) =>
    (b.sort_weight ?? 0) - (a.sort_weight ?? 0) ||
    b.created_at.localeCompare(a.created_at) ||
    a.slug.localeCompare(b.slug);
  const picked: Row[] = [];
  const usedSubtypes = new Set<string>();
  for (const cat of shelfOrder) {
    if (picked.length >= TILE_MAX) break;
    const candidates = pro
      .filter((r) => !picked.includes(r) && categoriesOf(r).some((c) => shelfId(c) === shelfId(cat)))
      .sort(byRank);
    const pick = candidates.find((r) => !usedSubtypes.has(r.subtype ?? "")) ?? candidates[0];
    if (!pick) continue;
    picked.push(pick);
    if (pick.subtype) usedSubtypes.add(pick.subtype);
  }

  // Die Vorschau NUR für die gezeigten Motive (zweite, schlanke Abfrage wie in lib/spots.ts).
  let tiles: ProShowcaseData["tiles"] = [];
  if (picked.length > 0) {
    const { data: media, error: mediaErr } = await svc
      .from("spots")
      .select("slug, media(url, role, sort_order, blur_url)")
      .in(
        "slug",
        picked.map((p) => p.slug),
      );
    if (mediaErr) {
      console.error("getProShowcase (Vorschau):", mediaErr.message);
    } else {
      const mediaBySlug = new Map((media ?? []).map((s) => [s.slug as string, s.media]));
      // Der Schlüssel ist ein Zähler, nicht der Slug: Er landet als React-key im HTML.
      tiles = picked.map((p, i) => ({
        key: `tile-${i}`,
        previewUrl: heroPreviewFromMedia(mediaBySlug.get(p.slug)),
        label: factSubtype(p.subtype, locale) ?? null,
      }));
    }
  }

  return {
    total: rows.length,
    pro: pro.length,
    shelves: summerShelves,
    winter: pro.filter((r) => (r.seasons ?? []).includes("winter")).length,
    // Scheitert nur die Touren-Zählung, fehlt eben diese eine Zahl, nicht der ganze Block.
    tours: toursRes.error ? 0 : (toursRes.count ?? 0),
    tiles,
  };
}
