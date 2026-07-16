"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";
import { viewerCanSeePro } from "./spots";
import type { TourDetail, TourStopView } from "./tour-types";

// Gespeicherte User-Runden (0028). Persistiert wird nur der SNAPSHOT (geordnete
// Punkt-IDs + fertige Geh-Route + Meta) -> erneutes Ansehen kostet KEINE API (Claude/
// Mapbox liefen nur einmal beim Bauen). Titel/Audio werden beim Ansehen frisch geladen,
// neu gegatet und signiert. Owner-Zugriff über RLS (Auth-Client); Struktur/Audio über
// den Service-Client (wie bei kuratierten Touren).

const DE = "de";
const GENERATED_FREE_STOPS = 2; // identisch zum Generator: erste 2 Stops gratis

export type SaveUserTourInput = {
  areaId: string;
  name: string;
  emoji: string | null;
  interests: string[];
  pointIds: string[];
  routeGeo: [number, number][] | null;
  start: { lat: number; lng: number } | null;
  distanceKm: number | null;
  durationMin: number | null;
};

export type UserTourSummary = {
  id: string;
  name: string;
  emoji: string | null;
  areaName: string | null;
  stopCount: number;
  distanceKm: number | null;
  durationMin: number | null;
};

// Runde des aktuellen Users speichern. RLS erzwingt user_id = auth.uid().
export async function saveUserTour(
  input: SaveUserTourInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };

  const pointIds = (input.pointIds ?? []).filter((x) => typeof x === "string" && x);
  if (!input.areaId || pointIds.length < 2) return { ok: false, error: "invalid" };
  const name = (input.name ?? "").trim().slice(0, 80) || "Meine Runde";

  const { data, error } = await supabase
    .from("user_tours")
    .insert({
      user_id: user.id,
      area_id: input.areaId,
      name,
      emoji: input.emoji ?? null,
      interests: input.interests ?? [],
      point_ids: pointIds,
      route_geo: input.routeGeo ?? null,
      start_lat: input.start?.lat ?? null,
      start_lng: input.start?.lng ?? null,
      distance_km: input.distanceKm ?? null,
      duration_min: input.durationMin ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "db" };

  revalidatePath("/touren");
  return { ok: true, id: data.id as string };
}

// Runde des Users löschen (RLS: nur eigene).
export async function deleteUserTour(id: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase.from("user_tours").delete().eq("id", id);
  if (error) return { ok: false };
  revalidatePath("/touren");
  return { ok: true };
}

// Gespeicherte Runden des Users als Kachel-Daten (null = nicht eingeloggt).
export async function listUserTours(locale: string): Promise<UserTourSummary[] | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("user_tours")
    .select("id, name, emoji, area_id, point_ids, distance_km, duration_min")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  const rows = data as unknown as Record<string, unknown>[];

  // Gebietsnamen gesammelt über den Service-Client (published-RLS umgehen, nur Anzeige).
  const areaIds = [...new Set(rows.map((r) => r.area_id as string | null).filter(Boolean))] as string[];
  const areaName = new Map<string, string>();
  if (areaIds.length) {
    const svc = createServiceClient();
    const { data: areas } = await svc
      .from("tour_areas")
      .select("id, tour_area_translations(lang, name)")
      .in("id", areaIds);
    for (const a of (areas as unknown as Record<string, unknown>[] | null) ?? []) {
      const trs = (a.tour_area_translations as { lang: string; name: string }[] | null) ?? [];
      const tr = trs.find((r) => r.lang === locale) ?? trs.find((r) => r.lang === DE) ?? trs[0];
      areaName.set(a.id as string, tr?.name ?? "");
    }
  }

  return rows.map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? "",
    emoji: (r.emoji as string | null) ?? null,
    areaName: areaName.get(r.area_id as string) ?? null,
    stopCount: ((r.point_ids as string[] | null) ?? []).length,
    distanceKm: (r.distance_km as number | null) ?? null,
    durationMin: (r.duration_min as number | null) ?? null,
  }));
}

// Gespeicherte Runde als TourDetail rekonstruieren (frisches Audio + Gating + Signing).
// RLS auf user_tours stellt sicher, dass nur der Eigentümer die Runde laden kann.
export async function getUserTourDetail(
  id: string,
  locale: string,
): Promise<TourDetail | null> {
  // Volle Locale nutzen (nicht mehr auf en/de zusammenstauchen!) – Titel- und Audio-Picker
  // fallen bei fehlender Sprache selbst auf Deutsch zurück. So kommen fr/it/nl/… wirklich an.
  const lang = locale;
  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  if (!user) return null;

  const { data: row } = await authed
    .from("user_tours")
    .select("id, name, emoji, area_id, point_ids, route_geo, start_lat, start_lng, distance_km, duration_min")
    .eq("id", id)
    .maybeSingle();
  if (!row) return null; // nicht vorhanden ODER nicht Eigentümer (RLS)

  const r = row as unknown as Record<string, unknown>;
  const orderedIds = ((r.point_ids as string[] | null) ?? []).filter(Boolean);
  if (orderedIds.length === 0) return null;

  const canSeePro = await viewerCanSeePro();
  const svc = createServiceClient();

  // Punkte (nur veröffentlichte, in veröffentlichtem Gebiet) laden.
  const { data: pointRows } = await svc
    .from("tour_points")
    .select("id, status, lat, lng, emoji, image_url, tour_areas(status), tour_point_translations(lang, title)")
    .in("id", orderedIds);
  const pointById = new Map<string, Record<string, unknown>>();
  for (const p of (pointRows as unknown as Record<string, unknown>[] | null) ?? []) {
    const area = p.tour_areas as { status?: string } | null;
    if (p.status === "published" && area?.status === "published") {
      pointById.set(p.id as string, p);
    }
  }

  // Audio je Punkt (RLS-dicht -> Service-Client).
  const audioByPoint = new Map<
    string,
    { url: string | null; text: string | null; dur: number | null }
  >();
  {
    const { data: audioRows } = await svc
      .from("tour_point_audio")
      .select("point_id, lang, audio_url, audio_text, duration_sec")
      .in("point_id", orderedIds);
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
        voiced(lang) ??
        voiced(DE) ??
        list.find((x) => x.lang === lang) ??
        list.find((x) => x.lang === DE) ??
        list[0];
      audioByPoint.set(pid, {
        url: (a?.audio_url as string | null) ?? null,
        text: (a?.audio_text as string | null) ?? null,
        dur: (a?.duration_sec as number | null) ?? null,
      });
    }
  }

  // Reihenfolge = gespeicherte point_ids; nicht mehr verfügbare Punkte fallen raus.
  const kept = orderedIds.map((pid) => pointById.get(pid)).filter(Boolean) as Record<string, unknown>[];
  if (kept.length === 0) return null;

  const prelim = kept.map((point, i) => {
    const trs = (point.tour_point_translations as { lang: string; title: string }[] | null) ?? [];
    const tr = trs.find((x) => x.lang === lang) ?? trs.find((x) => x.lang === DE) ?? trs[0];
    const audio = audioByPoint.get(point.id as string) ?? { url: null, text: null, dur: null };
    const locked = i >= GENERATED_FREE_STOPS && !canSeePro;
    return { point, title: tr?.title ?? "", audio, locked, order: i + 1 };
  });

  // Signed-URLs nur für nicht-gesperrte Audio-Pfade.
  const signed = new Map<string, string>();
  const toSign = [
    ...new Set(prelim.filter((x) => !x.locked && x.audio.url).map((x) => x.audio.url as string)),
  ];
  if (toSign.length) {
    const { data: signedList } = await svc.storage
      .from("tour-audio")
      .createSignedUrls(toSign, 60 * 60 * 2);
    for (const s of signedList ?? []) {
      if (!s.error && s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
    }
  }

  const stops: TourStopView[] = prelim.map((x) => ({
    spotSlug: x.point.id as string,
    order: x.order,
    title: x.title,
    shortDesc: null,
    emoji: (x.point.emoji as string | null) ?? null,
    // Bild ist öffentlicher Teaser, auch bei locked (0029) – nur Audio ist Pro.
    imageUrl: (x.point.image_url as string | null) ?? null,
    lat: (x.point.lat as number | null) ?? null,
    lng: (x.point.lng as number | null) ?? null,
    locked: x.locked,
    audioUrl: x.locked || !x.audio.url ? null : (signed.get(x.audio.url) ?? null),
    audioText: x.locked ? null : x.audio.text,
    durationSec: x.locked ? null : x.audio.dur,
  }));

  const startLat = r.start_lat as number | null;
  const startLng = r.start_lng as number | null;

  return {
    slug: `meine-${r.id as string}`,
    region: "",
    emoji: (r.emoji as string | null) ?? "🎧",
    coverUrl: null,
    title: (r.name as string) ?? "",
    subtitle: null,
    description: null,
    stopCount: stops.length,
    isPro: true,
    freeStops: GENERATED_FREE_STOPS,
    durationMin: (r.duration_min as number | null) ?? null,
    distanceKm: (r.distance_km as number | null) ?? null,
    stops,
    canSeePro,
    routeGeo: (r.route_geo as [number, number][] | null) ?? null,
    start: startLat != null && startLng != null ? { lat: startLat, lng: startLng } : null,
  };
}
