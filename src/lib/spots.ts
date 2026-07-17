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

// Bild-Zeilen eines Spots ordnen (Hero zuerst, dann sort_order). EINE Sortierung für
// Bild-URLs und Blur-Vorschau – sonst zeigt der Teaser irgendwann ein anderes Motiv
// als die entsperrte Karte.
type MediaRow = {
  url: string;
  role: string | null;
  sort_order: number | null;
  blur_url?: string | null;
};
function sortedMedia(media: unknown): MediaRow[] {
  const arr = (Array.isArray(media) ? media : []) as MediaRow[];
  return arr
    .filter((m) => m && typeof m.url === "string")
    .sort((a, b) => {
      const ra = a.role === "hero" ? 0 : 1;
      const rb = b.role === "hero" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
}

export function imagesFromMedia(media: unknown): string[] {
  return sortedMedia(media).map((m) => m.url);
}

// URL der Vorschau des Hero-Bilds (~160px, siehe lib/blur-preview.ts). Das EINZIGE
// Bild, das gesperrte Pro-Spots ausliefern dürfen. null, wenn der Spot kein Foto hat
// oder die Vorschau noch nicht erzeugt wurde (-> Emoji-Fallback).
export function heroPreviewFromMedia(media: unknown): string | null {
  return sortedMedia(media)[0]?.blur_url ?? null;
}

export type SpotCardData = {
  slug: string;
  emoji: string | null;
  imageUrl: string | null; // Hero-Foto – bei gesperrten Spots IMMER null
  // Ist der Spot für DIESEN Betrachter gesperrt? Autoritativ vom Server (is_pro und
  // kein Pro-Zugang). Nicht aus isPro ableiten: Ein zahlender Pro-User sieht Pro-Spots
  // ganz normal, für ihn ist isPro true, locked aber false.
  locked: boolean;
  // URL der Blur-Vorschau – nur bei locked gesetzt, als Teaser fürs Foto.
  previewUrl: string | null;
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

// Anzahl veröffentlichter Spots für die Startseite. Zählt in Postgres (head: true
// überträgt KEINE Zeilen), pro Request nur einmal (cache).
//
// Zwei Darstellungen, EINE Quelle — die Zahl ist immer sichtbar und immer wahr:
//   >= 10 Spots -> auf Zehner ABGERUNDET, mit Plus:  67 -> „60+ Spots"
//   <  10 Spots -> exakt, ohne Plus:                  8 -> „8 Spots"
//
// Warum abrunden statt runden: „60+" muss bei 67 wahr sein. Aufrunden wäre eine Zahl, die
// wir nicht haben — und die Zielgruppe ist laut BRAND_VOICE allergisch auf aufgeblasenes
// Tourismus-Marketing. Lieber untertreiben als sich erwischen lassen.
//
// Warum unter 10 exakt: Abrunden ergäbe „0+ Spots". Die exakte Zahl ist ehrlich und liest
// sich bei einem kuratierten Katalog sogar bewusst — anders als eine kaputte Null.
//
// Der Übergang passiert von selbst: sobald der 10. Spot online geht, steht dort „10+",
// bei den 76 aus der alten Seite „70+". Niemand muss je eine Zahl eintippen.
export type SpotCount = { value: number; rounded: boolean };

export const getSpotCount = cache(async function getSpotCount(): Promise<SpotCount | null> {
  // Service-Client, NICHT der anon-Key: die RLS aus Migration 0017 lässt anonyme Leser nur
  // Nicht-Pro-Spots sehen. Über den anon-Key zählte die Startseite also für Ausgeloggte
  // eine kleinere Zahl als für Pro-Kunden — die Aussage hinge am Betrachter statt am
  // Katalog. Gemeint ist der GESAMTE Katalog; die Pro-Spots sind ja das, was Pro verkauft.
  // Unbedenklich: eine Zahl verrät keine Titel, Slugs oder Koordinaten.
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("spots")
    .select("id", { count: "exact", head: true })
    .eq("status", "published");

  if (error || count == null || count === 0) {
    // Zahl unbekannt oder null -> Aussage weglassen, statt zu raten oder „0 Spots" zu
    // behaupten. Die Startseite blendet die Kachel dann aus.
    if (error) console.error("getSpotCount:", error.message);
    return null;
  }
  return count >= 10
    ? { value: Math.floor(count / 10) * 10, rounded: true }
    : { value: count, rounded: false };
});

// Die im Admin für die Startseite ausgewählten Spots (spots.home_rank), in ihrer
// Reihenfolge. Eine Seite über schöne Orte muss ein paar davon zeigen.
//
// 🔒 `.eq("is_pro", false)` ist hier PFLICHT und nicht bloss Vorsicht: Bei Pro-Spots
// verlässt das Foto den Server nie (nur die Blur-Vorschau) und der Titel wird geschwärzt
// — ein gefeaturedter Pro-Spot wäre also entweder ein Leak oder eine leere Karte. Die
// Admin-Oberfläche bietet ohnehin nur freie Spots an und ein DB-Trigger räumt home_rank
// weg, sobald ein Spot auf Pro gestellt wird; dieser Filter ist die Linie, die auch dann
// hält, wenn jemand die anderen beiden umgeht. Nicht entfernen.
//
// Service-Client wie getExploreData: konsistente Sicht, unabhängig davon, wer schaut —
// die Startseite zeigt allen dasselbe.
export const getFeaturedSpots = cache(async function getFeaturedSpots(
  locale: string,
): Promise<SpotCardData[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("spots")
    .select(
      "slug, emoji, is_pro, type, spot_translations!inner(title, short_desc, lang), media(url, role, sort_order)",
    )
    .eq("status", "published")
    .eq("is_pro", false)
    .not("home_rank", "is", null)
    .in("spot_translations.lang", localeWithFallback(locale))
    .order("home_rank", { ascending: true });

  if (error) {
    // Kein Grund, die ganze Startseite zu killen: ohne Spots blendet die Section sich aus.
    console.error("getFeaturedSpots:", error.message);
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
      locked: false, // nur freie Spots kommen hier an (siehe Filter oben)
      previewUrl: null,
      isPro: false,
      type: s.type,
      title: t?.title ?? s.slug,
      shortDesc: t?.short_desc ?? null,
    };
  });
});

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
      // Läuft über den anon-Key: Die RLS (Migration 0017) lässt Pro-Spots nur durch,
      // wenn der Betrachter sie sehen darf. Was hier ankommt, ist also nie gesperrt.
      locked: false,
      previewUrl: null,
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

// spots.route_bbox kommt fertig aus der DB (generierte Spalte, Migration 0042) – hier
// wird nur noch die Form geprüft, nicht mehr gerechnet. Die frühere JS-Fassung hat
// nebenbei einen Bug verloren: Number(null) ist 0, ein null in den Koordinaten wurde
// also zu Punkt (0,0) und hätte die Box bis Null Island aufgespannt. Die SQL prüft den
// JSON-Typ und liefert in dem Fall NULL.
function asBBox(v: unknown): [number, number, number, number] | null {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number")
    ? (v as [number, number, number, number])
    : null;
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
        // route_bbox statt route_geojson: Wir brauchen hier nur vier Zahlen. Die ganze
        // Geometrie zu holen, um daraus eine Box zu rechnen, kostete bei 8 Spots schon
        // 20 KB und würde bei 100-200 Spots rund 1 MB PRO Seitenaufruf bedeuten.
        // Postgres rechnet die Box beim Schreiben (Migration 0042).
        "slug, emoji, is_pro, type, lat, lng, seasons, route_bbox, spot_translations!inner(title, short_desc, lang), spot_categories(categories(key, season)), media(url, role, sort_order, blur_url)",
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
    // bbox nur für Aktivitäten, die dieser Betrachter sehen darf. An `locked` hängen,
    // nicht an `is_pro`: sonst sähe ein zahlender Pro-Kunde bei Pro-Wanderungen nie die
    // Route, obwohl die Detailseite ihm die volle Geometrie zeigt.
    const routeBounds =
      !locked && s.type === "activity" ? asBBox(s.route_bbox) : null;

    return {
      // Bei gesperrten Pro-Spots NICHTS Echtes ausliefern (kein Slug/Titel/Text)
      slug: locked ? `locked-${i}` : s.slug,
      emoji: locked ? null : s.emoji,
      imageUrl: locked ? null : (imagesFromMedia(s.media)[0] ?? null),
      // Statt des Fotos nur die Vorschau (~160px): Motiv erkennbar, Ort nicht.
      previewUrl: locked ? heroPreviewFromMedia(s.media) : null,
      locked,
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
  // URL der Blur-Vorschau – nur bei locked gesetzt, als Teaser auf der Paywall.
  // Einziges Bild, das ein gesperrter Spot ausliefert.
  previewUrl: string | null;
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
    "slug, type, subtype, emoji, is_pro, duration, lat, lng, parking_lat, parking_lng, transit_lat, transit_lng, route_geojson, elevation_profile, difficulty, best_season, access, price_level, area, fame, has_opening_hours, phone, website_url, ticket_url, ticket_partner, lake_name, google_place_id, video_url, video_poster_url, media(url, role, sort_order, blur_url), local:locals(id, name, role, avatar_url), spot_translations!inner(title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author, lang)";

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
      previewUrl: heroPreviewFromMedia(data.media),
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
    previewUrl: null, // nicht gesperrt -> das echte Foto wird gezeigt
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
