import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import {
  imagesFromMedia,
  localeWithFallback,
  pickTranslation,
  type SpotCardData,
} from "./spots";

export type SavedSpot = SpotCardData & { lat: number | null; lng: number | null };

// Default-Merkliste holen oder anlegen
export async function getOrCreateDefaultList(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("saved_lists")
    .select("id")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  if (data) return data.id;

  const { data: created, error } = await supabase
    .from("saved_lists")
    .insert({ user_id: userId, name: "Merkliste", is_default: true })
    .select("id")
    .single();
  if (error) {
    console.error("getOrCreateDefaultList:", error.message);
    return null;
  }
  return created.id;
}

// Slugs der gespeicherten Spots des aktuellen Users (RLS filtert auf eigene)
export async function getSavedSlugs(): Promise<Set<string>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set();

  const { data, error } = await supabase
    .from("saved_items")
    .select("spots(slug)");
  if (error) return new Set();

  const set = new Set<string>();
  for (const row of (data ?? []) as { spots: { slug: string } | { slug: string }[] | null }[]) {
    const s = Array.isArray(row.spots) ? row.spots[0] : row.spots;
    if (s?.slug) set.add(s.slug);
  }
  return set;
}

// Gespeicherte Spots als Karten-Daten (null = nicht eingeloggt)
export async function getSavedSpots(locale: string): Promise<SavedSpot[] | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: items } = await supabase.from("saved_items").select("spot_id");
  const ids = (items ?? []).map((i) => i.spot_id);
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from("spots")
    .select(
      "slug, emoji, is_pro, type, lat, lng, spot_translations!inner(title, short_desc, lang), media(url, role, sort_order)",
    )
    .in("id", ids)
    .eq("status", "published")
    .in("spot_translations.lang", localeWithFallback(locale))
    .order("sort_weight", { ascending: false });

  return (data ?? []).map((s) => {
    const t = pickTranslation(
      s.spot_translations as { title: string; short_desc: string | null; lang: string }[],
      locale,
    );
    return {
      slug: s.slug,
      emoji: s.emoji,
      imageUrl: imagesFromMedia(s.media)[0] ?? null,
      // Läuft über den anon-Key: Die RLS (Migration 0017) lässt Pro-Spots nur durch,
      // wenn der eingeloggte Betrachter sie sehen darf. Gespeichertes ist nie gesperrt.
      locked: false,
      previewBlur: null,
      isPro: s.is_pro,
      type: s.type,
      title: t?.title ?? s.slug,
      shortDesc: t?.short_desc ?? null,
      lat: s.lat,
      lng: s.lng,
    };
  });
}
