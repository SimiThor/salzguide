import { cache } from "react";
import { createClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";
import type { ElevationProfile } from "./admin-actions";

// Darf der aktuelle Betrachter Pro-Inhalte sehen? (eingeloggter Pro-User ODER Admin)
// Wird server-seitig ermittelt und ist die AUTORITATIVE Gate-Entscheidung für das
// Blanking unten. Die öffentlichen Teaser-Leser laufen über den Service-Client
// (bypassen RLS), damit die gesperrten Pins/Karten weiterhin erscheinen — die
// RLS (Migration 0017) bleibt die harte Sperre gegen direkten PostgREST-Zugriff.
export const viewerCanSeePro = cache(async function viewerCanSeePro(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("profiles")
    .select("is_pro, role")
    .eq("id", user.id)
    .maybeSingle();
  return Boolean(data?.is_pro) || data?.role === "admin";
});

// Koordinate grob runden (~1 km) für Teaser-Pins gesperrter Pro-Spots.
function fuzzCoord(n: number | null): number | null {
  return n == null ? null : Math.round(n * 100) / 100;
}

// Bild-URLs eines Spots aus den media-Zeilen ableiten (Hero zuerst, dann sort_order)
type MediaRow = { url: string; role: string | null; sort_order: number | null };
export function imagesFromMedia(media: unknown): string[] {
  const arr = (Array.isArray(media) ? media : []) as MediaRow[];
  return arr
    .filter((m) => m && typeof m.url === "string")
    .sort((a, b) => {
      const ra = a.role === "hero" ? 0 : 1;
      const rb = b.role === "hero" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })
    .map((m) => m.url);
}

export type SpotCardData = {
  slug: string;
  emoji: string | null;
  imageUrl: string | null; // Hero-Foto (falls vorhanden)
  isPro: boolean;
  type: "activity" | "food";
  title: string;
  shortDesc: string | null;
};

// Wählt die Übersetzung in der gewünschten Sprache, sonst Deutsch (immer vorhanden),
// sonst die erste. So verschwinden Spots NICHT, wenn eine Sprache noch keine Übersetzung
// hat (robuster Fallback für N Sprachen). Voraussetzung: Query lädt locale + "de".
export function pickTranslation<T extends { lang: string }>(
  tr: T | T[] | null | undefined,
  locale: string,
): T | undefined {
  const arr = Array.isArray(tr) ? tr : tr ? [tr] : [];
  return arr.find((x) => x.lang === locale) ?? arr.find((x) => x.lang === "de") ?? arr[0];
}

// Übersetzungs-Zeilen für den Fallback: gewünschte Sprache + Deutsch.
export function localeWithFallback(locale: string): string[] {
  return locale === "de" ? ["de"] : [locale, "de"];
}

// Anzeigename für gesperrte Pro-Spots (Teaser-Pin/-Karte) je Sprache. Klein & self-contained
// (kein i18n-Key nötig), damit alle Sprachen einen sauberen Begriff haben statt Deutsch.
const LOCKED_NAME: Record<string, string> = {
  de: "Geheimtipp",
  en: "Secret spot",
  it: "Chicca segreta",
  nl: "Geheime plek",
  ko: "비밀 명소",
  fr: "Spot secret",
  zh: "秘密景点",
  es: "Lugar secreto",
  pt: "Lugar secreto",
};
function lockedName(locale: string): string {
  return LOCKED_NAME[locale] ?? LOCKED_NAME.de;
}

// Veröffentlichte Spots inkl. Übersetzung in der gewünschten Sprache (mit DE-Fallback).
// Liest über den anon-Key → RLS lässt nur status='published' durch.
export async function getPublishedSpots(locale: string): Promise<SpotCardData[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spots")
    .select("slug, emoji, is_pro, type, spot_translations!inner(title, short_desc, lang), media(url, role, sort_order)")
    .eq("status", "published")
    .in("spot_translations.lang", localeWithFallback(locale))
    .order("sort_weight", { ascending: false });

  if (error) {
    console.error("getPublishedSpots:", error.message);
    return [];
  }

  return (data ?? []).map((s) => {
    const t = pickTranslation(
      s.spot_translations as { title: string; short_desc: string | null; lang: string }[],
      locale,
    );
    return {
      slug: s.slug,
      emoji: s.emoji,
      imageUrl: imagesFromMedia(s.media)[0] ?? null,
      isPro: s.is_pro,
      type: s.type,
      title: t?.title ?? s.slug,
      shortDesc: t?.short_desc ?? null,
    };
  });
}

// ---- Explore (Karte + Karussells + Saison) ----------------------------------
export type ExploreSpot = SpotCardData & {
  lat: number | null;
  lng: number | null;
  seasons: string[];
  categoryKeys: { key: string; season: string }[];
  // Bounding-Box der Wanderroute [minLng, minLat, maxLng, maxLat] – nur für
  // (nicht-Pro) Aktivitäten mit Route. Klein (4 Zahlen) -> kommt direkt mit, damit
  // die Karte beim Antippen SOFORT auf den End-Ausschnitt zoomt (kein Nachladen ->
  // kein Sprung). Die Routen-Linie selbst lädt weiter lazy (getSpotRoute).
  routeBounds?: [number, number, number, number] | null;
};

// Bounding-Box eines LineString-GeoJSON – serverseitig, damit nur die Box (nicht die
// ganze Geometrie) in die Startseiten-Payload wandert.
function routeBBox(rg: unknown): [number, number, number, number] | null {
  const g = rg as { type?: string; coordinates?: [number, number][] } | null;
  if (!g || g.type !== "LineString" || !Array.isArray(g.coordinates) || g.coordinates.length < 2)
    return null;
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const c of g.coordinates) {
    const lng = Number(c?.[0]);
    const lat = Number(c?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return Number.isFinite(minLng) ? [minLng, minLat, maxLng, maxLat] : null;
}

export type ExploreCategory = {
  key: string;
  season: string;
  title: string;
  sortOrder: number;
};

export type ExploreData = {
  spots: ExploreSpot[];
  categories: ExploreCategory[];
};

// canSeePro: solange kein Login existiert (Auftrag G/H) IMMER false ->
// Pro-Inhalte werden serverseitig entfernt, damit echte Titel/Slugs/Texte
// NICHT im Client-HTML landen (docs/33). Nur Teaser-Marker bleiben.
export async function getExploreData(locale: string): Promise<ExploreData> {
  const canSeePro = await viewerCanSeePro();
  // Service-Client: sieht auch Pro-Spots (für die gesperrten Teaser-Pins). Pro-Inhalte
  // werden unten für Nicht-Pro-Betrachter geschwärzt, bevor irgendetwas zum Client geht.
  const supabase = createServiceClient();
  const lockedSpotName = lockedName(locale);

  const [spotsRes, catsRes] = await Promise.all([
    supabase
      .from("spots")
      .select(
        "slug, emoji, is_pro, type, lat, lng, seasons, route_geojson, spot_translations!inner(title, short_desc, lang), spot_categories(categories(key, season)), media(url, role, sort_order)",
      )
      .eq("status", "published")
      .in("spot_translations.lang", localeWithFallback(locale))
      .order("sort_weight", { ascending: false }),
    supabase
      .from("categories")
      .select("key, season, title_translations, sort_order")
      .order("sort_order", { ascending: true }),
  ]);

  if (spotsRes.error) console.error("getExploreData spots:", spotsRes.error.message);
  if (catsRes.error) console.error("getExploreData categories:", catsRes.error.message);

  const spots: ExploreSpot[] = (spotsRes.data ?? []).map((s, i) => {
    const t = pickTranslation(
      s.spot_translations as { title: string; short_desc: string | null; lang: string }[],
      locale,
    );

    const links = (s.spot_categories ?? []) as {
      categories: { key: string; season: string } | { key: string; season: string }[] | null;
    }[];
    const categoryKeys = links
      .flatMap((l) => (Array.isArray(l.categories) ? l.categories : l.categories ? [l.categories] : []))
      .map((c) => ({ key: c.key, season: c.season }));

    const locked = s.is_pro && !canSeePro;
    // bbox nur für nicht-Pro-Aktivitäten (kein Pro-Leak, konsistent zu getSpotRoute).
    const routeBounds =
      !s.is_pro && s.type === "activity" ? routeBBox(s.route_geojson) : null;

    return {
      // Bei gesperrten Pro-Spots NICHTS Echtes ausliefern (kein Slug/Titel/Text)
      slug: locked ? `locked-${i}` : s.slug,
      emoji: locked ? null : s.emoji,
      imageUrl: locked ? null : (imagesFromMedia(s.media)[0] ?? null),
      isPro: s.is_pro,
      type: s.type,
      title: locked ? lockedSpotName : (t?.title ?? s.slug),
      shortDesc: locked ? null : (t?.short_desc ?? null),
      // Gesperrte Pro-Spots: Koordinaten grob runden (~1 km Raster) -> Teaser-Pin zeigt
      // die GEGEND, nicht den exakten geheimen Punkt (die exakte Lage ist Premium-Info).
      lat: locked ? fuzzCoord(s.lat) : s.lat,
      lng: locked ? fuzzCoord(s.lng) : s.lng,
      seasons: s.seasons ?? [],
      categoryKeys,
      routeBounds,
    };
  });

  const categories: ExploreCategory[] = (catsRes.data ?? []).map((c) => {
    const titles = (c.title_translations ?? {}) as Record<string, string>;
    return {
      key: c.key,
      season: c.season,
      title: titles[locale] ?? titles.de ?? c.key,
      sortOrder: c.sort_order,
    };
  });

  return { spots, categories };
}

// ---- Spot-Detail (Auftrag E) ------------------------------------------------
export type SpotDetail = {
  slug: string;
  type: "activity" | "food";
  subtype: string | null;
  emoji: string | null;
  isPro: boolean;
  locked: boolean; // Pro + (noch) kein Zugriff -> Paywall statt Inhalt
  images: string[]; // Fotos (Hero zuerst), leer wenn gesperrt
  duration: string | null;
  route: [number, number][] | null; // Wanderroute (LineString-Koordinaten)
  elevation: ElevationProfile | null; // Höhenprofil (nur Wanderungen)
  lat: number | null;
  lng: number | null;
  parkingLat: number | null;
  parkingLng: number | null;
  transitLat: number | null;
  transitLng: number | null;
  difficulty: string | null;
  bestSeason: string | null;
  access: "oeffis" | "auto" | "beides" | null;
  priceLevel: string | null;
  area: string | null;
  fame: string | null;
  hasOpeningHours: boolean;
  phone: string | null;
  websiteUrl: string | null;
  ticketUrl: string | null;
  ticketPartner: string | null;
  lakeName: string | null;
  googlePlaceId: string | null;
  // Übersetzung
  title: string;
  shortDesc: string | null;
  general: string | null;
  insiderTip: string | null;
  sectionA: string | null;
  sectionB: string | null;
  locationText: string | null;
  insiderAuthor: string | null;
  // Empfehlender Local (Insider-Tipp)
  localName: string | null;
  localRole: string | null;
  localAvatar: string | null;
  videoUrl: string | null; // 9:16-Video (leer/gesperrt = null)
  videoPosterUrl: string | null; // Auto-Standbild zum Video
};

export const getSpotDetail = cache(async function getSpotDetail(
  slug: string,
  locale: string,
): Promise<SpotDetail | null> {
  const canSeePro = await viewerCanSeePro();
  // Service-Client, damit die Paywall-Seite eines Pro-Spots erscheinen kann; die
  // sensiblen Felder werden unten bei `locked` autoritativ genullt (kein Leak).
  const supabase = createServiceClient();
  const select =
    "slug, type, subtype, emoji, is_pro, duration, lat, lng, parking_lat, parking_lng, transit_lat, transit_lng, route_geojson, elevation_profile, difficulty, best_season, access, price_level, area, fame, has_opening_hours, phone, website_url, ticket_url, ticket_partner, lake_name, google_place_id, video_url, video_poster_url, media(url, role, sort_order), local:locals(id, name, role, avatar_url), spot_translations!inner(title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author, lang)";

  const run = (lang: string) =>
    supabase
      .from("spots")
      .select(select)
      .eq("slug", slug)
      .eq("status", "published")
      .eq("spot_translations.lang", lang)
      .maybeSingle();

  let { data, error } = await run(locale);
  // Fallback auf DE, wenn für die Sprache keine Übersetzung existiert
  if (!error && !data && locale !== "de") ({ data, error } = await run("de"));

  if (error) {
    console.error("getSpotDetail:", error.message);
    return null;
  }
  if (!data) return null;

  const tr = data.spot_translations as
    | Record<string, string | null>[]
    | Record<string, string | null>;
  const t = (Array.isArray(tr) ? tr[0] : tr) ?? {};

  const lc = data.local as
    | { id: string; name: string; role: string | null; avatar_url: string | null }
    | { id: string; name: string; role: string | null; avatar_url: string | null }[]
    | null;
  const local = Array.isArray(lc) ? lc[0] : lc;

  // Rolle des Locals in der Sprache des Nutzers (Migration 0033: locals.role_i18n).
  // Best-effort per Extra-Query -> fehlt die Spalte, bleibt die deutsche Rolle (kein Bruch der
  // Detailseite). Name & Foto sind sprachneutral.
  let localRole = local?.role ?? null;
  if (local?.id && locale !== "de") {
    const { data: ri } = await supabase
      .from("locals")
      .select("role_i18n")
      .eq("id", local.id)
      .maybeSingle();
    const roleI18n = (ri?.role_i18n ?? null) as Record<string, string> | null;
    if (roleI18n && roleI18n[locale]?.trim()) localRole = roleI18n[locale];
  }

  const rg = data.route_geojson as
    | { type?: string; coordinates?: [number, number][] }
    | null;
  const route =
    rg && rg.type === "LineString" && Array.isArray(rg.coordinates)
      ? rg.coordinates
      : null;

  const locked = data.is_pro && !canSeePro;

  // Gesperrter Pro-Spot für Nicht-Pro: NUR die für die Paywall nötigen Strukturfelder,
  // alle Inhalte/Standorte autoritativ genullt (die Seite rendert ohnehin nur die
  // Paywall). So verlässt kein Premium-Inhalt den Server – zusätzlich zur RLS (0017).
  if (locked) {
    return {
      slug: data.slug,
      type: data.type,
      subtype: null,
      emoji: null,
      isPro: true,
      locked: true,
      images: [],
      duration: null,
      route: null,
      elevation: null,
      lat: null,
      lng: null,
      parkingLat: null,
      parkingLng: null,
      transitLat: null,
      transitLng: null,
      difficulty: null,
      bestSeason: null,
      access: null,
      priceLevel: null,
      area: null,
      fame: null,
      hasOpeningHours: false,
      phone: null,
      websiteUrl: null,
      ticketUrl: null,
      ticketPartner: null,
      lakeName: null,
      googlePlaceId: null,
      title: lockedName(locale),
      shortDesc: null,
      general: null,
      insiderTip: null,
      sectionA: null,
      sectionB: null,
      locationText: null,
      insiderAuthor: null,
      localName: null,
      localRole: null,
      localAvatar: null,
      videoUrl: null,
      videoPosterUrl: null,
    };
  }

  return {
    slug: data.slug,
    type: data.type,
    subtype: data.subtype,
    emoji: data.emoji,
    isPro: data.is_pro,
    locked: false,
    images: imagesFromMedia(data.media),
    duration: data.duration,
    route,
    elevation: (data.elevation_profile as ElevationProfile | null) ?? null,
    lat: data.lat,
    lng: data.lng,
    parkingLat: data.parking_lat,
    parkingLng: data.parking_lng,
    transitLat: data.transit_lat,
    transitLng: data.transit_lng,
    difficulty: data.difficulty,
    bestSeason: data.best_season,
    access: data.access,
    priceLevel: data.price_level,
    area: data.area,
    fame: data.fame,
    hasOpeningHours: data.has_opening_hours,
    phone: data.phone,
    websiteUrl: data.website_url,
    ticketUrl: data.ticket_url,
    ticketPartner: data.ticket_partner,
    lakeName: data.lake_name,
    googlePlaceId: data.google_place_id,
    title: (t.title as string) ?? data.slug,
    shortDesc: (t.short_desc as string) ?? null,
    general: (t.general as string) ?? null,
    insiderTip: (t.insider_tip as string) ?? null,
    sectionA: (t.section_a as string) ?? null,
    sectionB: (t.section_b as string) ?? null,
    locationText: (t.location_text as string) ?? null,
    insiderAuthor: (t.insider_author as string) ?? null,
    localName: local?.name ?? null,
    localRole,
    localAvatar: local?.avatar_url ?? null,
    videoUrl: (data.video_url as string | null) ?? null,
    videoPosterUrl: (data.video_poster_url as string | null) ?? null,
  };
});
