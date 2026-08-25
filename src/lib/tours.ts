import { createServiceClient } from "./supabase/service";
import { viewerCanSeePro } from "./spots";
import { cleanRouteGeo } from "./tour-route";
import { translationStatus } from "./spot-hash";
import { routing } from "@/i18n/routing";
import { tourModeOf, type TourMode } from "./tour-mode";
import { stopAudioAccess } from "./tour-audio-gate";
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
  // `mode` kommt erst mit Migration 0064. Fehlt sie, darf die Tourenliste nicht
  // ausfallen -> zweiter Versuch ohne die Spalte (Muster wie in getTourDetail).
  const listCols =
    "slug, region, emoji, cover_url, is_pro, free_stops, duration_min, distance_km, sort_order, " +
    "tour_translations(lang, title, subtitle), tour_stops(tour_points(status))";
  const q = (cols: string) =>
    supabase
      .from("tours")
      .select(cols)
      .eq("status", "published")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }); // sort_order ist überall 0 -> ohne Zweitschlüssel wäre die Reihenfolge Postgres-Zufall
  let { data, error } = await q(`${listCols}, mode`);
  if (error) ({ data, error } = await q(listCols));
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
      // Fortbewegungsart aus der DB (0064). Ohne die Spalte (Fallback-Abfrage oben)
      // ist der Wert undefined -> "walk", denn jede bestehende Runde ist eine Geh-Tour.
      mode: tourModeOf(t.mode),
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

  // Start/Ziel und die gesnappte Linie kommen erst mit Migration 0061. Solange sie
  // fehlen, darf die öffentliche Tour-Seite nicht ausfallen -> zweiter Versuch ohne
  // diese Spalten (gleiches Fallback-Muster wie getAreaForEdit in tour-pool.ts).
  const baseCols =
    "id, slug, region, emoji, cover_url, is_pro, free_stops, duration_min, distance_km, " +
    "tour_translations(lang, title, subtitle, description)";
  // Neue Spalten, die es je nach Migrationsstand noch nicht gibt: Route (0061) und
  // Fortbewegungsart (0064). Schlägt die Abfrage deshalb fehl, greift der zweite
  // Versuch mit baseCols allein.
  const routeCols = "start_lat, start_lng, end_lat, end_lng, route_geo, mode";
  const withRoute = await supabase
    .from("tours")
    .select(`${baseCols}, ${routeCols}`)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  let tour: Record<string, unknown> | null = withRoute.error
    ? null
    : ((withRoute.data as unknown as Record<string, unknown> | null) ?? null);
  if (withRoute.error) {
    const plain = await supabase
      .from("tours")
      .select(baseCols)
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    tour = (plain.data as unknown as Record<string, unknown> | null) ?? null;
  }
  if (!tour) return null;

  const tt = tour;
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
    {
      url: string | null;
      text: string | null;
      dur: number | null;
      teaserUrl: string | null;
      teaserSec: number | null;
    }
  >();
  if (pointIds.length) {
    // Die Kostprobe-Spalten kommen erst mit Migration 0065. Fehlen sie, darf die Tour-Seite
    // nicht ausfallen -> zweiter Versuch ohne sie (Muster wie oben bei route_geo und mode).
    const audioCols = "point_id, lang, audio_url, audio_text, duration_sec";
    const holen = async (cols: string) =>
      (await supabase.from("tour_point_audio").select(cols).in("point_id", pointIds)).data as
        | Record<string, unknown>[]
        | null;
    const audioRows = (await holen(`${audioCols}, teaser_url, teaser_sec`)) ?? (await holen(audioCols));
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const a of audioRows ?? []) {
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
        teaserUrl: (a?.teaser_url as string | null) ?? null,
        teaserSec: (a?.teaser_sec as number | null) ?? null,
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
    const audio = audioByPoint.get(point.id as string) ?? {
      url: null,
      text: null,
      dur: null,
      teaserUrl: null,
      teaserSec: null,
    };
    // Gating: bei Pro-Tour sind die ersten `freeStops` Stops gratis; Rest nur mit Pro.
    const locked = isPro && i >= freeStops && !canSeePro;
    return { point, st, audio, locked, order: i + 1 };
  });

  // Signed-URLs aus dem privaten tour-audio-Bucket, und die Aufteilung ist das Gate:
  //
  //   offener Stopp   -> die VOLLDATEI wird signiert, die Kostprobe braucht er nicht
  //   gesperrter Stopp -> NUR die Kostprobe, niemals die Volldatei
  //
  // Deshalb ist die Kostprobe ein eigenes Objekt und kein Abschnitt der Volldatei: Wer die
  // Volldatei ausliefert und nach 20 Sekunden stoppt, hat kein Gate gebaut, sondern eine
  // Bitte. Ein Blick in die Netzwerkspur, und die ganze Geschichte liegt da.
  const signed = new Map<string, string>();
  const toSign = [
    ...new Set(
      prelim
        .map(
          (p) =>
            stopAudioAccess({
              locked: p.locked,
              audioUrl: p.audio.url,
              teaserUrl: p.audio.teaserUrl,
            }).signPath,
        )
        .filter((v): v is string => Boolean(v)),
    ),
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
      // Titel, Bild und Position sind bei Touren bewusst ÖFFENTLICHE Teaser – nur
      // Audio-Text und MP3 sind die Pro-Ware (Migration 0029, Entscheidung 2026-07-10).
      // Anders als bei Geheimtipp-Spots wird hier also NICHT geblankt: Wer die Runde
      // kaufen soll, muss vorher sehen, wohin sie führt.
      imageUrl: (point.image_url as string | null) ?? null,
      lat: (point.lat as number | null) ?? null,
      lng: (point.lng as number | null) ?? null,
      locked: p.locked,
      audioUrl: p.locked || !p.audio.url ? null : (signed.get(p.audio.url) ?? null),
      audioText: p.locked ? null : p.audio.text,
      durationSec: p.locked ? null : p.audio.dur,
      // Die Kostprobe gibt es NUR am gesperrten Stopp. An einem offenen waere sie sinnlos
      // und wuerde die Oberflaeche nur vor die Wahl zwischen zwei Play-Knoepfen stellen.
      teaserUrl:
        p.locked && p.audio.teaserUrl ? (signed.get(p.audio.teaserUrl) ?? null) : null,
      teaserSec: p.locked ? p.audio.teaserSec : null,
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
    // Fortbewegungsart aus der DB (0064). Sie entscheidet, ob
    // /touren/[slug]/navigation überhaupt ausgeliefert wird (docs/40).
    mode: tourModeOf(tt.mode),
    stops,
    canSeePro,
    // Gesnappte Geh-Route + Start/Ziel (Migration 0061). Fehlen sie, zeichnet die
    // Karte wie bisher die Linie über die Stationen (TourView).
    routeGeo: cleanRouteGeo(tt.route_geo),
    start: coordOf(tt.start_lat, tt.start_lng),
    end: coordOf(tt.end_lat, tt.end_lng),
  };
}

// Ein Koordinatenpaar aus zwei Spalten – nur wenn BEIDE gesetzt sind.
function coordOf(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : null;
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
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true }); // sort_order ist überall 0 -> ohne Zweitschlüssel wäre die Reihenfolge Postgres-Zufall
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
  // Übersetzungs-Status wie in der Punkte-Liste: wie viele Zielsprachen sind da und
  // stammen aus dem aktuellen deutschen Stand.
  trPresent: number;
  trTotal: number;
  trComplete: boolean;
};

export async function getToursAdmin(): Promise<AdminTourRow[]> {
  const supabase = createServiceClient();
  const targets = routing.locales.filter((l) => l !== DE);
  const cols = "id, slug, region, status, is_pro, tour_stops(id)";
  // source_hash gibt es erst ab Migration 0060 -> mit Fallback abfragen.
  const withHash = await supabase
    .from("tours")
    .select(`${cols}, tour_translations(lang, title, source_hash)`)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true }); // sort_order ist überall 0 -> ohne Zweitschlüssel wäre die Reihenfolge Postgres-Zufall
  let rows = withHash.error
    ? null
    : ((withHash.data as unknown as Record<string, unknown>[] | null) ?? null);
  if (withHash.error) {
    const plain = await supabase
      .from("tours")
      .select(`${cols}, tour_translations(lang, title)`)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    rows = (plain.data as unknown as Record<string, unknown>[] | null) ?? null;
  }
  return (rows ?? []).map((t) => {
    const trs =
      (t.tour_translations as
        | { lang: string; title: string; source_hash?: string | null }[]
        | null) ?? [];
    const tr = trs.find((r) => r.lang === DE) ?? trs[0];
    const st = translationStatus(trs, targets);
    return {
      id: t.id as string,
      slug: t.slug as string,
      region: t.region as string,
      status: t.status as "draft" | "published",
      isPro: Boolean(t.is_pro),
      stopCount: ((t.tour_stops as unknown[] | null) ?? []).length,
      title: tr?.title ?? (t.slug as string),
      trPresent: st.present,
      trTotal: st.total,
      trComplete: st.state === "complete",
    };
  });
}

export type TourEditStop = { pointId: string; title: string };

export type TourTextData = { title: string; subtitle: string; description: string };

export type TourEditData = {
  id: string;
  areaId: string | null;
  emoji: string;
  coverUrl: string | null;
  isPro: boolean;
  freeStops: number;
  status: "draft" | "published";
  mode: TourMode;
  durationMin: number | null;
  distanceKm: number | null;
  de: TourTextData;
  // Alle weiteren Sprachen wie bei Punkten/Gebieten: eine Zeile je Sprache, Deutsch
  // bleibt die Quelle. translationsSourceHash = Stand, aus dem übersetzt wurde.
  translations: Record<string, TourTextData>;
  translationsSourceHash?: string;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  routeGeo: [number, number][] | null;
  routeHash: string | null;
  stops: TourEditStop[];
};

export async function getTourForEdit(id: string): Promise<TourEditData | null> {
  const supabase = createServiceClient();
  // source_hash (0060) und die Route-Spalten (0061) mit Fallback abfragen, damit das
  // Admin-Formular auch vor den Migrationen aufgeht (Muster: getAreaForEdit).
  const baseCols =
    "id, area_id, emoji, cover_url, is_pro, free_stops, status, duration_min, distance_km";
  const full = await supabase
    .from("tours")
    .select(
      `${baseCols}, start_lat, start_lng, end_lat, end_lng, route_geo, route_hash, mode, ` +
        "tour_translations(lang, title, subtitle, description, source_hash)",
    )
    .eq("id", id)
    .maybeSingle();
  let tour: Record<string, unknown> | null = full.error
    ? null
    : ((full.data as unknown as Record<string, unknown> | null) ?? null);
  if (full.error) {
    const plain = await supabase
      .from("tours")
      .select(`${baseCols}, tour_translations(lang, title, subtitle, description)`)
      .eq("id", id)
      .maybeSingle();
    tour = (plain.data as unknown as Record<string, unknown> | null) ?? null;
  }
  if (!tour) return null;
  const tt = tour;
  const trs =
    (tt.tour_translations as
      | {
          lang: string;
          title: string;
          subtitle: string | null;
          description: string | null;
          source_hash?: string | null;
        }[]
      | null) ?? [];
  const build = (lang: string): TourTextData => {
    const r = trs.find((x) => x.lang === lang);
    return {
      title: r?.title ?? "",
      subtitle: r?.subtitle ?? "",
      description: r?.description ?? "",
    };
  };
  const translations: Record<string, TourTextData> = {};
  for (const l of routing.locales) {
    if (l === DE) continue;
    if (trs.some((r) => r.lang === l)) translations[l] = build(l);
  }
  // Die Marke steht auf den ZIEL-Zeilen (saveTour stempelt sie), nicht auf der
  // DE-Zeile, die jeder Save auf aktuell setzt – wie bei Punkten und Gebieten.
  const deHash = trs.find((r) => r.lang !== DE && r.source_hash)?.source_hash ?? undefined;

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
    mode: tourModeOf(tt.mode),
    durationMin: (tt.duration_min as number | null) ?? null,
    distanceKm: (tt.distance_km as number | null) ?? null,
    de: build(DE),
    translations,
    translationsSourceHash: deHash ?? undefined,
    startLat: (tt.start_lat as number | null) ?? null,
    startLng: (tt.start_lng as number | null) ?? null,
    endLat: (tt.end_lat as number | null) ?? null,
    endLng: (tt.end_lng as number | null) ?? null,
    routeGeo: cleanRouteGeo(tt.route_geo),
    routeHash: (tt.route_hash as string | null) ?? null,
    stops,
  };
}
