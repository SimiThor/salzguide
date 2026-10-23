import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { currentUserId } from "./viewer";
import {
  asBBox,
  heroAiOriginFromMedia,
  imagesFromMedia,
  localeWithFallback,
  pickTranslation,
  type SpotCardData,
} from "./spots";

export type SavedSpot = SpotCardData & {
  lat: number | null;
  lng: number | null;
  // Bounding-Box der Wanderroute, direkt aus der DB (generierte Spalte route_bbox).
  // Ohne sie flöge die Karte erst zum Punkt und passte NACHTRÄGLICH auf die Route ein,
  // sobald die Linie geladen ist — also genau das Springen, das es auf der Startseite
  // seit Migration 0042 nicht mehr gibt. Vier Zahlen, die mit der Liste mitkommen,
  // sparen diesen zweiten Zug.
  routeBounds?: [number, number, number, number] | null;
};

// Default-Merkliste holen oder anlegen
export async function getOrCreateDefaultList(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  // order + limit statt maybeSingle(): Hat ein Rennen (zwei gleichzeitige Erstanfragen) doch
  // zwei Standardlisten hinterlassen, nehmen wir die älteste, statt mit einem Fehler zu
  // scheitern. Gegen das Entstehen schützt der Index aus Migration 0073.
  const find = async () => {
    const { data } = await supabase
      .from("saved_lists")
      .select("id")
      .eq("user_id", userId)
      .eq("is_default", true)
      .order("created_at", { ascending: true })
      .limit(1);
    return (data?.[0]?.id as string | undefined) ?? null;
  };
  const existing = await find();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("saved_lists")
    .insert({ user_id: userId, name: "Merkliste", is_default: true })
    .select("id")
    .single();
  if (error) {
    // 23505 = eine parallele Anfrage war schneller (Index aus 0073): deren Liste nehmen.
    if (error.code === "23505") return find();
    console.error("getOrCreateDefaultList:", error.message);
    return null;
  }
  return created.id;
}

// Slugs der gespeicherten Spots über einen ausdrücklich übergebenen Client (RLS filtert auf
// die eigenen). Für die App-API (/api/app/v1/saved): Sie übergibt createBearerClient(token),
// das Web den Cookie-Client. WIRFT bei einem Datenbankfehler; die Web-Fassung unten fängt das
// (leere Menge), die App antwortet 503, damit sie "nichts gemerkt" nicht mit "Ausfall"
// verwechselt und lokal Gespeichertes nicht überschreibt.
export async function getSavedSlugsFor(client: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await client.from("saved_items").select("spots(slug)");
  if (error) throw error;

  const set = new Set<string>();
  for (const row of (data ?? []) as { spots: { slug: string } | { slug: string }[] | null }[]) {
    const s = Array.isArray(row.spots) ? row.spots[0] : row.spots;
    if (s?.slug) set.add(s.slug);
  }
  return set;
}

// Slugs der gespeicherten Spots des aktuellen Users (RLS filtert auf eigene)
//
// Lokale Token-Prüfung (currentUserId), weil das reines Lesen ist und an der Karte hängt:
// Die Entdecken-Seite fragte hier zum dritten Mal in einem Render nach demselben Nutzer.
// Die Absicherung leistet ohnehin die RLS, nicht diese Zeile — sie entscheidet nur, ob wir
// die Abfrage überhaupt stellen. Siehe lib/viewer.ts.
export async function getSavedSlugs(): Promise<Set<string>> {
  if (!(await currentUserId())) return new Set();
  const supabase = await createClient();
  try {
    return await getSavedSlugsFor(supabase);
  } catch {
    return new Set();
  }
}

// Gespeicherte Spots als Karten-Daten über einen ausdrücklich übergebenen Client (RLS). Wirft
// bei einem Datenbankfehler (siehe getSavedSlugsFor).
export async function getSavedSpotsFor(
  supabase: SupabaseClient,
  locale: string,
): Promise<SavedSpot[]> {
  const { data: items, error: itemsError } = await supabase.from("saved_items").select("spot_id");
  if (itemsError) throw itemsError;
  const ids = (items ?? []).map((i) => i.spot_id);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("spots")
    .select(
      "slug, emoji, is_pro, type, lat, lng, route_bbox, spot_translations!inner(title, short_desc, lang), media(url, role, sort_order, ai_origin)",
    )
    .in("id", ids)
    .eq("status", "published")
    .in("spot_translations.lang", localeWithFallback(locale))
    .order("sort_weight", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((s) => {
    const t = pickTranslation(
      s.spot_translations as { title: string; short_desc: string | null; lang: string }[],
      locale,
    );
    return {
      slug: s.slug,
      emoji: s.emoji,
      imageUrl: imagesFromMedia(s.media)[0] ?? null,
      imageAiOrigin: heroAiOriginFromMedia(s.media),
      // Läuft über den anon-Key: Die RLS (Migration 0017) lässt Pro-Spots nur durch,
      // wenn der eingeloggte Betrachter sie sehen darf. Gespeichertes ist nie gesperrt.
      locked: false,
      previewUrl: null,
      isPro: s.is_pro,
      type: s.type,
      title: t?.title ?? s.slug,
      shortDesc: t?.short_desc ?? null,
      lat: s.lat,
      lng: s.lng,
      // Dieselbe Regel wie in getExploreSpots: Box nur für Wanderungen, die dieser
      // Betrachter sehen darf. Gespeichertes ist nie gesperrt (siehe `locked` oben),
      // die Prüfung auf den Typ genügt hier.
      routeBounds: s.type === "activity" ? asBBox(s.route_bbox) : null,
    };
  });
}

// Gespeicherte Spots als Karten-Daten (null = nicht eingeloggt)
export async function getSavedSpots(locale: string): Promise<SavedSpot[] | null> {
  if (!(await currentUserId())) return null;
  const supabase = await createClient();
  try {
    return await getSavedSpotsFor(supabase, locale);
  } catch {
    // Wie vorher: Ein Lesefehler zeigt eine leere Liste statt die Seite zu kippen.
    return [];
  }
}
