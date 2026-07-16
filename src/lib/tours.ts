import { createServiceClient } from "./supabase/service";
import { viewerCanSeePro } from "./spots";
import type { TourDetail, TourStopView, TourSummary } from "./tour-types";

// Datenschicht für Audio-Touren (POOL-Modell): eine kuratierte Runde besteht aus
// geordneten POOL-PUNKTEN (tour_points) eines Gebiets. Gelesen wird über den
// Service-Client (bypasst RLS -> Teaser/Struktur sichtbar); die AUTORITATIVE
// Gate-Entscheidung fürs Audio passiert hier serverseitig: nur Gratis-Stops oder
// Pro/Admin bekommen eine kurzlebige Signed-URL (privater tour-audio-Bucket).
// tour_point_audio hat KEINEN Public-Read -> harte Barriere gegen Direktzugriff.

const DE = "de";

type TrRow = { lang: string };
function pickTr<T extends TrRow>(rows: T[] | null | undefined, lang: string): T | null {
  const arr = rows ?? [];
  return arr.find((r) => r.lang === lang) ?? arr.find((r) => r.lang === DE) ?? arr[0] ?? null;
}

// Öffentliche Tour-Liste (Kacheln). Nur Struktur/Meta, kein Audio.
export async function getPublishedTours(locale: string): Promise<TourSummary[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tours")
    .select(
      "slug, region, emoji, cover_url, is_pro, free_stops, duration_min, distance_km, sort_order, " +
        "tour_translations(lang, title, subtitle), tour_stops(tour_points(status))",
    )
    .eq("status", "published")
    .order("sort_order", { ascending: true });
  if (error || !data) return [];

  return (data as unknown as Record<string, unknown>[]).map((t) => {
    const tr = pickTr(
      t.tour_translations as ({ lang: string; title: string; subtitle: string | null }[]) | null,
      locale,
    );
    // Nur Stops mit veröffentlichtem Punkt zählen (konsistent mit der Detailseite).
    const stopCount = (
      (t.tour_stops as ({ tour_points: { status: string } | null }[]) | null) ?? []
    ).filter((ts) => ts.tour_points?.status === "published").length;
    return {
      slug: t.slug as string,
      region: t.region as string,
      emoji: (t.emoji as string | null) ?? null,
      coverUrl: (t.cover_url as string | null) ?? null,
      title: tr?.title ?? (t.slug as string),
      subtitle: tr?.subtitle ?? null,
      stopCount,
      isPro: Boolean(t.is_pro),
      freeStops: (t.free_stops as number) ?? 0,
      durationMin: (t.duration_min as number | null) ?? null,
      distanceKm: (t.distance_km as number | null) ?? null,
    };
  });
}

// Eine Tour mit allen Stops (Pool-Punkte) + serverseitig gegatetem Audio.
export async function getTourDetail(
  slug: string,
  locale: string,
): Promise<TourDetail | null> {
  const canSeePro = await viewerCanSeePro();
  const supabase = createServiceClient();

  const { data: tour } = await supabase
    .from("tours")
    .select(
      "id, slug, region, emoji, cover_url, is_pro, free_stops, duration_min, distance_km, " +
        "tour_translations(lang, title, subtitle, description)",
    )
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!tour) return null;

  const tt = tour as unknown as Record<string, unknown>;
  const tr = pickTr(
    tt.tour_translations as
      | ({ lang: string; title: string; subtitle: string | null; description: string | null }[])
      | null,
    locale,
  );

  // Stops = geordnete Pool-Punkte (Titel/Geo/Emoji).
  const { data: stopRows } = await supabase
    .from("tour_stops")
    .select(
      "sort_order, tour_points(id, status, lat, lng, emoji, image_url, " +
        "tour_areas(status), tour_point_translations(lang, title))",
    )
    .eq("tour_id", tt.id as string)
    .order("sort_order", { ascending: true });

  // Nur Stops mit veröffentlichtem Punkt UND veröffentlichtem Gebiet (kein Draft-Leak).
  const rows = ((stopRows as Record<string, unknown>[] | null) ?? []).filter((r) => {
    const p = r.tour_points as Record<string, unknown> | null;
    const area = p?.tour_areas as { status?: string } | null;
    return p != null && p.status === "published" && area?.status === "published";
  });

  // Audio je Punkt aus tour_point_audio (RLS-dicht -> hier via Service-Client).
  const pointIds = rows
    .map((r) => (r.tour_points as Record<string, unknown> | null)?.id as string | undefined)
    .filter((v): v is string => Boolean(v));
  const audioByPoint = new Map<
    string,
    { url: string | null; text: string | null; dur: number | null }
  >();
  if (pointIds.length) {
    const { data: audioRows } = await supabase
      .from("tour_point_audio")
      .select("point_id, lang, audio_url, audio_text, duration_sec")
      .in("point_id", pointIds);
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const a of (audioRows as Record<string, unknown>[] | null) ?? []) {
      const pid = a.point_id as string;
      const list = grouped.get(pid) ?? [];
      list.push(a);
      grouped.set(pid, list);
    }
    for (const [pid, list] of grouped) {
      // Sprache des Nutzers bevorzugen – ABER nur, wenn sie wirklich VERTONT ist (audio_url).
      // Sonst deutsche Vertonung (Text + Stimme als Paar). Verhindert Stille, wenn eine Sprache
      // zwar übersetzt, aber noch nicht vertont wurde. Reine Text-Zeilen sind nur letzte Wahl.
      const voiced = (l: string) => list.find((x) => x.lang === l && Boolean(x.audio_url));
      const a =
        voiced(locale) ??
        voiced(DE) ??
        list.find((x) => x.lang === locale) ??
        list.find((x) => x.lang === DE) ??
        list[0];
      audioByPoint.set(pid, {
        url: (a?.audio_url as string | null) ?? null,
        text: (a?.audio_text as string | null) ?? null,
        dur: (a?.duration_sec as number | null) ?? null,
      });
    }
  }

  const isPro = Boolean(tt.is_pro);
  const freeStops = (tt.free_stops as number) ?? 0;

  const prelim = rows.map((r, i) => {
    const point = (r.tour_points as Record<string, unknown>) ?? {};
    const st = pickTr(
      point.tour_point_translations as ({ lang: string; title: string }[]) | null,
      locale,
    );
    const audio = audioByPoint.get(point.id as string) ?? { url: null, text: null, dur: null };
    // Gating: bei Pro-Tour sind die ersten `freeStops` Stops gratis; Rest nur mit Pro.
    const locked = isPro && i >= freeStops && !canSeePro;
    return { point, st, audio, locked, order: i + 1 };
  });

  // Signed-URLs NUR für nicht-gesperrte Audio-Pfade (privater tour-audio-Bucket).
  const signed = new Map<string, string>();
  const toSign = [
    ...new Set(prelim.filter((p) => !p.locked && p.audio.url).map((p) => p.audio.url as string)),
  ];
  if (toSign.length) {
    const { data: signedList } = await supabase.storage
      .from("tour-audio")
      .createSignedUrls(toSign, 60 * 60 * 2);
    for (const s of signedList ?? []) {
      if (!s.error && s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
    }
  }

  const stops: TourStopView[] = prelim.map((p) => {
    const point = p.point;
    return {
      // spotSlug trägt hier die Punkt-ID (eindeutiger Key für Karte/Player).
      spotSlug: point.id as string,
      order: p.order,
      title: p.st?.title ?? "",
      shortDesc: null,
      emoji: (point.emoji as string | null) ?? null,
      imageUrl: (point.image_url as string | null) ?? null,
      lat: (point.lat as number | null) ?? null,
      lng: (point.lng as number | null) ?? null,
      locked: p.locked,
      audioUrl: p.locked || !p.audio.url ? null : (signed.get(p.audio.url) ?? null),
      audioText: p.locked ? null : p.audio.text,
      durationSec: p.locked ? null : p.audio.dur,
    };
  });

  return {
    slug: tt.slug as string,
    region: tt.region as string,
    emoji: (tt.emoji as string | null) ?? null,
    coverUrl: (tt.cover_url as string | null) ?? null,
    title: tr?.title ?? (tt.slug as string),
    subtitle: tr?.subtitle ?? null,
    description: tr?.description ?? null,
    stopCount: stops.length,
    isPro,
    freeStops,
    durationMin: (tt.duration_min as number | null) ?? null,
    distanceKm: (tt.distance_km as number | null) ?? null,
    stops,
    canSeePro,
  };
}

// Veröffentlichte Gebiete (für den KI-Runden-Builder / Gebiets-Auswahl).
export type PublicArea = {
  id: string;
  name: string;
  startLat: number | null;
  startLng: number | null;
};

export async function getPublishedAreas(locale: string): Promise<PublicArea[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("tour_areas")
    .select("id, start_lat, start_lng, tour_area_translations(lang, name)")
    .eq("status", "published")
    .order("sort_order", { ascending: true });
  return ((data as unknown as Record<string, unknown>[]) ?? []).map((a) => {
    const trs = (a.tour_area_translations as { lang: string; name: string }[] | null) ?? [];
    const tr = trs.find((r) => r.lang === locale) ?? trs.find((r) => r.lang === "de") ?? trs[0];
    return {
      id: a.id as string,
      name: tr?.name ?? "",
      startLat: (a.start_lat as number | null) ?? null,
      startLng: (a.start_lng as number | null) ?? null,
    };
  });
}

// ── Admin-Lesehilfen (nur hinter dem Admin-Rollen-Guard aufgerufen) ──────────
export type AdminTourRow = {
  id: string;
  slug: string;
  region: string;
  status: "draft" | "published";
  isPro: boolean;
  stopCount: number;
  title: string;
};

export async function getToursAdmin(): Promise<AdminTourRow[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("tours")
    .select("id, slug, region, status, is_pro, tour_translations(lang, title), tour_stops(id)")
    .order("sort_order", { ascending: true });
  return ((data as unknown as Record<string, unknown>[]) ?? []).map((t) => {
    const trs = (t.tour_translations as { lang: string; title: string }[] | null) ?? [];
    const tr = trs.find((r) => r.lang === "de") ?? trs[0];
    return {
      id: t.id as string,
      slug: t.slug as string,
      region: t.region as string,
      status: t.status as "draft" | "published",
      isPro: Boolean(t.is_pro),
      stopCount: ((t.tour_stops as unknown[] | null) ?? []).length,
      title: tr?.title ?? (t.slug as string),
    };
  });
}

export type TourEditStop = { pointId: string; title: string };

export type TourEditData = {
  id: string;
  areaId: string | null;
  emoji: string;
  coverUrl: string | null;
  isPro: boolean;
  freeStops: number;
  status: "draft" | "published";
  durationMin: number | null;
  distanceKm: number | null;
  de: { title: string; subtitle: string; description: string };
  en: { title: string; subtitle: string; description: string };
  stops: TourEditStop[];
};

export async function getTourForEdit(id: string): Promise<TourEditData | null> {
  const supabase = createServiceClient();
  const { data: tour } = await supabase
    .from("tours")
    .select(
      "id, area_id, emoji, cover_url, is_pro, free_stops, status, duration_min, distance_km, " +
        "tour_translations(lang, title, subtitle, description)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!tour) return null;
  const tt = tour as unknown as Record<string, unknown>;
  const trs =
    (tt.tour_translations as
      | { lang: string; title: string; subtitle: string | null; description: string | null }[]
      | null) ?? [];
  const de = trs.find((r) => r.lang === "de");
  const en = trs.find((r) => r.lang === "en");

  const { data: stopRows } = await supabase
    .from("tour_stops")
    .select("point_id, sort_order, tour_points(id, tour_point_translations(lang, title))")
    .eq("tour_id", id)
    .order("sort_order", { ascending: true });
  const rows = (stopRows as unknown as Record<string, unknown>[] | null) ?? [];

  const stops: TourEditStop[] = rows.map((r) => {
    const point = (r.tour_points as Record<string, unknown>) ?? {};
    const strs = (point.tour_point_translations as { lang: string; title: string }[] | null) ?? [];
    const title =
      strs.find((x) => x.lang === "de")?.title ?? strs[0]?.title ?? "(ohne Titel)";
    return { pointId: r.point_id as string, title };
  });

  return {
    id: tt.id as string,
    areaId: (tt.area_id as string | null) ?? null,
    emoji: (tt.emoji as string | null) ?? "",
    coverUrl: (tt.cover_url as string | null) ?? null,
    isPro: Boolean(tt.is_pro),
    freeStops: (tt.free_stops as number) ?? 0,
    status: (tt.status as "draft" | "published") ?? "draft",
    durationMin: (tt.duration_min as number | null) ?? null,
    distanceKm: (tt.distance_km as number | null) ?? null,
    de: {
      title: de?.title ?? "",
      subtitle: de?.subtitle ?? "",
      description: de?.description ?? "",
    },
    en: {
      title: en?.title ?? "",
      subtitle: en?.subtitle ?? "",
      description: en?.description ?? "",
    },
    stops,
  };
}
