import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase/service";
import { pickRoundVoice } from "./tts-rules";
import { getDefaultVoice, getVoiceById, voiceInfoOf } from "./tts-voices";
import { loadStopAudio } from "./tours";
import { MY_TOUR_PREFIX } from "./tour-chain";
import type { TourDetail, TourStopView } from "./tour-types";

// Kern der gespeicherten User-Runden (0028), OHNE Betrachter-Annahmen: Der Aufrufer reicht den
// Client im Namen des Nutzers herein (Cookie-Client im Web, Bearer-Client in der App) und
// prueft vorher selbst, wer fragt. Die RLS auf user_tours gilt mit der Identitaet dieses
// Clients. Die "use server"-Datei user-tours.ts darf nichts Neues exportieren; deshalb leben
// die Kerne hier und die Web-Actions rufen sie nur auf (docs/41, 4.2).

const DE = "de";
export const GENERATED_FREE_STOPS = 2; // identisch zum Generator: erste 2 Stops gratis
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Ist das eine UUID in Kleinschreibung? Sonst fragt man die Datenbank gar nicht erst. */
export function isUserTourId(id: string): boolean {
  return UUID.test(id);
}

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

/** Runde fuer `userId` ablegen. Die RLS (0072) erzwingt user_id = auth.uid() und Pro. */
export async function insertUserTour(
  client: SupabaseClient,
  userId: string,
  input: SaveUserTourInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const pointIds = (input.pointIds ?? []).filter((x) => typeof x === "string" && x);
  if (!input.areaId || pointIds.length < 2) return { ok: false, error: "invalid" };
  const name = (input.name ?? "").trim().slice(0, 80) || "Meine Runde";

  const { data, error } = await client
    .from("user_tours")
    .insert({
      user_id: userId,
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
  return { ok: true, id: data.id as string };
}

/** Eigene Runde loeschen (RLS: nur eigene). false = Datenbankfehler; "gab es nicht" ist KEIN Fehler. */
export async function removeUserTour(client: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await client.from("user_tours").delete().eq("id", id);
  return !error;
}

/** Wie viele Runden hat der Nutzer (RLS: nur eigene)? null = Datenbankfehler. */
export async function countUserTours(client: SupabaseClient): Promise<number | null> {
  const { count, error } = await client.from("user_tours").select("id", { count: "exact", head: true });
  return error ? null : (count ?? 0);
}

/** Eigene Runden als Kachel-Daten, neueste zuerst. */
export async function listUserTourSummaries(
  client: SupabaseClient,
  locale: string,
): Promise<UserTourSummary[]> {
  const { data, error } = await client
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

/**
 * Gespeicherte Runde als TourDetail rekonstruieren (frisches Audio + Gating + Signing).
 * `client` traegt die Identitaet des Eigentuemers: Die RLS auf user_tours laesst nur ihn die
 * Zeile lesen, jeder andere bekommt null (wie "gibt es nicht"). `canSeePro` wird erst
 * gefragt, wenn die Zeile da ist.
 */
export async function loadUserTourDetail(
  client: SupabaseClient,
  id: string,
  locale: string,
  canSeePro: () => Promise<boolean>,
): Promise<TourDetail | null> {
  // Volle Locale nutzen (nicht mehr auf en/de zusammenstauchen!) – Titel- und Audio-Picker
  // fallen bei fehlender Sprache selbst auf Deutsch zurück. So kommen fr/it/nl/… wirklich an.
  const lang = locale;

  const { data: row } = await client
    .from("user_tours")
    .select("id, name, emoji, area_id, point_ids, route_geo, start_lat, start_lng, distance_km, duration_min")
    .eq("id", id)
    .maybeSingle();
  if (!row) return null; // nicht vorhanden ODER nicht Eigentümer (RLS)

  const r = row as unknown as Record<string, unknown>;
  const orderedIds = ((r.point_ids as string[] | null) ?? []).filter(Boolean);
  if (orderedIds.length === 0) return null;

  const canSee = await canSeePro();
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

  // EINE Stimme je Runde (0068): die mit der größten Abdeckung über die gespeicherten
  // Punkte. Wurde der Pool seither teilweise umvertont und ein Punkt hat diese Stimme nicht
  // mehr, bleibt er stumm statt in fremder Stimme zu sprechen; der Hinweis wird generisch.
  const { data: fileRows } = await svc
    .from("tour_point_voice_files")
    .select("point_id, voice_id, audio_url")
    .in("point_id", orderedIds);
  const voicesByPoint = new Map<string, string[]>();
  for (const f of (fileRows as { point_id: string; voice_id: string; audio_url: string | null }[] | null) ?? []) {
    if (!f.audio_url) continue;
    voicesByPoint.set(f.point_id, [...(voicesByPoint.get(f.point_id) ?? []), f.voice_id]);
  }
  const roundVoiceId = pickRoundVoice(
    orderedIds.map((id) => ({ voiceIds: voicesByPoint.get(id) ?? [] })),
    (await getDefaultVoice())?.id ?? null,
  );
  const allSameVoice =
    roundVoiceId != null && orderedIds.every((id) => (voicesByPoint.get(id) ?? []).includes(roundVoiceId));
  const roundVoice = roundVoiceId && allSameVoice ? await getVoiceById(roundVoiceId) : null;

  // Audio je Punkt (RLS-dicht -> Service-Client), nur Dateien der Runden-Stimme.
  const audioByPoint = new Map<
    string,
    { url: string | null; text: string | null; dur: number | null }
  >();
  {
    const audioRows = await loadStopAudio(svc, orderedIds, roundVoiceId);
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const a of audioRows) {
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
    const locked = i >= GENERATED_FREE_STOPS && !canSee;
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
    slug: `${MY_TOUR_PREFIX}${r.id as string}`,
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
    // Gespeicherte Runden kommen ausschliesslich aus dem (Geh-)KI-Builder.
    mode: "walk",
    voice: voiceInfoOf(roundVoice),
    stops,
    canSeePro: canSee,
    routeGeo: (r.route_geo as [number, number][] | null) ?? null,
    start: startLat != null && startLng != null ? { lat: startLat, lng: startLng } : null,
    // Das Ziel IST der Start: Der Builder plant ausschliesslich Rundwege (ab Start und
    // zurück, lib/routing/user-loop.ts). Die Navigation braucht das Ziel ausdruecklich,
    // sonst endet sie am letzten Halt statt wieder am Ausgangspunkt (docs/40, Rundtour);
    // die Karte der Uebersicht setzt bei Start = Ziel ohnehin keine zweite Fahne.
    end: startLat != null && startLng != null ? { lat: startLat, lng: startLng } : null,
  };
}
