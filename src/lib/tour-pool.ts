import { createServiceClient } from "./supabase/service";
import { routing } from "@/i18n/routing";
import { countVoicedLangs, requiredVoiceIds, type VoiceRow } from "./tts-rules";
import { loadPointFiles, loadPointTourUsage, type PointTourUsage } from "./tts-files";
import { getDefaultVoice, getVoices } from "./tts-voices";

// Admin-Lesehilfen fürs Audio-Tour-POOL-Modell (Gebiete + Punkte). Nur hinter dem
// Admin-Rollen-Guard aufgerufen -> Service-Client (sieht Entwürfe + RLS-dichtes Audio).

export type AdminAreaRow = {
  id: string;
  key: string;
  status: "draft" | "published";
  name: string;
  pointCount: number;
};

export async function getAreasAdmin(): Promise<AdminAreaRow[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("tour_areas")
    .select("id, key, status, tour_area_translations(lang, name), tour_points(id)")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true }); // sort_order ist überall 0 -> ohne Zweitschlüssel wäre die Reihenfolge Postgres-Zufall
  return ((data as unknown as Record<string, unknown>[]) ?? []).map((a) => {
    const trs = (a.tour_area_translations as { lang: string; name: string }[] | null) ?? [];
    const tr = trs.find((r) => r.lang === "de") ?? trs[0];
    return {
      id: a.id as string,
      key: a.key as string,
      status: a.status as "draft" | "published",
      name: tr?.name ?? (a.key as string),
      pointCount: ((a.tour_points as unknown[] | null) ?? []).length,
    };
  });
}

type AreaTextData = { name: string; subtitle: string };

export type AreaEditData = {
  id: string;
  emoji: string;
  coverUrl: string | null;
  startLat: number | null;
  startLng: number | null;
  status: "draft" | "published";
  de: AreaTextData;
  translations: Record<string, AreaTextData>;
  translationsSourceHash?: string;
};

export async function getAreaForEdit(id: string): Promise<AreaEditData | null> {
  const supabase = createServiceClient();
  const cols = "id, emoji, cover_url, start_lat, start_lng, status";
  // source_hash existiert erst nach Migration 0031 -> mit Fallback abfragen (robust).
  let data: Record<string, unknown> | null = null;
  const withHash = await supabase
    .from("tour_areas")
    .select(`${cols}, tour_area_translations(lang, name, subtitle, source_hash)`)
    .eq("id", id)
    .maybeSingle();
  if (withHash.error) {
    const plain = await supabase
      .from("tour_areas")
      .select(`${cols}, tour_area_translations(lang, name, subtitle)`)
      .eq("id", id)
      .maybeSingle();
    data = (plain.data as Record<string, unknown> | null) ?? null;
  } else {
    data = (withHash.data as Record<string, unknown> | null) ?? null;
  }
  if (!data) return null;
  const a = data;
  const trs =
    (a.tour_area_translations as
      | { lang: string; name: string; subtitle: string | null; source_hash?: string | null }[]
      | null) ?? [];
  const build = (lang: string): AreaTextData => {
    const r = trs.find((x) => x.lang === lang);
    return { name: r?.name ?? "", subtitle: r?.subtitle ?? "" };
  };
  const translations: Record<string, AreaTextData> = {};
  for (const l of routing.locales) {
    if (l === "de") continue;
    if (trs.some((r) => r.lang === l)) translations[l] = build(l);
  }
  // Wie bei den Punkten: die Marke steht auf den ZIEL-Zeilen (saveArea stempelt sie), nicht auf
  // der DE-Zeile, die jeder Save auf aktuell setzt.
  const deHash = trs.find((r) => r.lang !== "de" && r.source_hash)?.source_hash ?? undefined;
  return {
    id: a.id as string,
    emoji: (a.emoji as string | null) ?? "",
    coverUrl: (a.cover_url as string | null) ?? null,
    startLat: (a.start_lat as number | null) ?? null,
    startLng: (a.start_lng as number | null) ?? null,
    status: (a.status as "draft" | "published") ?? "draft",
    de: build("de"),
    translations,
    translationsSourceHash: deHash ?? undefined,
  };
}

export type AdminPointRow = {
  id: string;
  title: string;
  status: "draft" | "published";
  lat: number | null;
  lng: number | null;
  tags: string[];
  hasAudio: boolean;
  /** Stimme -> Zahl der Sprachen mit Volldatei. */
  voicedLangs: Record<string, number>;
  // Übersetzungs-Status: wie viele Ziel-Sprachen sind fertig (Titel + vertont).
  trPresent: number;
  trTotal: number;
  trComplete: boolean;
};

export async function getAreaPoints(areaId: string): Promise<AdminPointRow[]> {
  const supabase = createServiceClient();
  const targets = routing.locales.filter((l) => l !== "de");
  const { data } = await supabase
    .from("tour_points")
    .select(
      "id, lat, lng, status, tags, tour_point_translations(lang, title), tour_point_voice_files(lang, voice_id, audio_url)",
    )
    .eq("area_id", areaId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true }); // sort_order ist überall 0 -> ohne Zweitschlüssel wäre die Reihenfolge Postgres-Zufall
  return ((data as unknown as Record<string, unknown>[]) ?? []).map((p) => {
    const trs = (p.tour_point_translations as { lang: string; title: string }[] | null) ?? [];
    const audio =
      (p.tour_point_voice_files as { lang: string; voice_id: string; audio_url: string | null }[] | null) ?? [];
    const tr = trs.find((r) => r.lang === "de") ?? trs[0];
    // Eine Ziel-Sprache ist „fertig", wenn Titel vorhanden UND eine Audiodatei (irgendeiner
    // Stimme) existiert. Welche Stimme eine Runde braucht, zeigt der Runden-Editor je Station.
    const present = targets.filter(
      (l) =>
        trs.some((r) => r.lang === l && r.title?.trim()) &&
        audio.some((r) => r.lang === l && r.audio_url),
    ).length;
    return {
      id: p.id as string,
      title: tr?.title ?? "(ohne Titel)",
      status: p.status as "draft" | "published",
      lat: (p.lat as number | null) ?? null,
      lng: (p.lng as number | null) ?? null,
      tags: (p.tags as string[] | null) ?? [],
      hasAudio: audio.some((r) => r.audio_url),
      voicedLangs: countVoicedLangs(audio),
      trPresent: present,
      trTotal: targets.length,
      trComplete: present === targets.length,
    };
  });
}

type PointTextData = {
  title: string;
  audioText: string;
};

/** Eine Datei einer Stimme in einer Sprache, wie der Editor sie zeigt. */
export type PointVoiceFile = {
  audioUrl: string | null;
  /** hashTexts([Text]) zum Zeitpunkt der Vertonung; null = Altbestand/manuell. */
  audioHash: string | null;
  teaserUrl: string | null;
  // Kurzlebige Signed-URL zum Abhören im Editor (privater tour-audio-Bucket).
  // Ohne sie zeigt das Formular nur "✓ MP3", und zum Anhören müsste man neu
  // vertonen (kostet ElevenLabs-Guthaben) oder die Live-Tour öffnen.
  previewUrl: string | null;
};

/** Was der Editor über die Stimmen wissen muss: Liste, Standard, Pflicht, Dateien, Runden. */
export type PointVoiceData = {
  voices: VoiceRow[];
  defaultVoiceId: string | null;
  /** Stimmen der veröffentlichten Runden, in denen der Punkt steckt (tts-rules.ts). */
  requiredVoiceIds: string[];
  /** voiceId -> lang -> Datei */
  files: Record<string, Record<string, PointVoiceFile>>;
  tours: PointTourUsage[];
};

export type PointEditData = {
  id: string;
  areaId: string;
  lat: number | null;
  lng: number | null;
  kind: string;
  tags: string[];
  weight: number;
  emoji: string;
  imageUrl: string | null;
  status: "draft" | "published";
  de: PointTextData;
  translations: Record<string, PointTextData>;
  translationsSourceHash?: string;
  voice: PointVoiceData;
};

/** Stimmen-Daten für einen NEUEN Punkt (noch keine Dateien, keine Runden). */
export async function getVoiceDataForNewPoint(): Promise<PointVoiceData> {
  const voices = await getVoices();
  return {
    voices,
    defaultVoiceId: (await getDefaultVoice())?.id ?? null,
    requiredVoiceIds: [],
    files: {},
    tours: [],
  };
}

export async function getPointForEdit(id: string): Promise<PointEditData | null> {
  const supabase = createServiceClient();
  const cols =
    "id, area_id, lat, lng, kind, tags, weight, emoji, image_url, status, " +
    "tour_point_audio(lang, audio_text)";
  // source_hash existiert erst nach Migration 0031 -> mit Fallback abfragen (robust).
  let data: Record<string, unknown> | null = null;
  const withHash = await supabase
    .from("tour_points")
    .select(`${cols}, tour_point_translations(lang, title, source_hash)`)
    .eq("id", id)
    .maybeSingle();
  if (withHash.error) {
    const plain = await supabase
      .from("tour_points")
      .select(`${cols}, tour_point_translations(lang, title)`)
      .eq("id", id)
      .maybeSingle();
    data = (plain.data as Record<string, unknown> | null) ?? null;
  } else {
    data = (withHash.data as Record<string, unknown> | null) ?? null;
  }
  if (!data) return null;
  const p = data;
  const trs =
    (p.tour_point_translations as
      | { lang: string; title: string; source_hash?: string | null }[]
      | null) ?? [];
  const audio =
    (p.tour_point_audio as { lang: string; audio_text: string | null }[] | null) ?? [];

  // Stimmen (0068): Dateien je Stimme und Sprache, Runden des Punkts, Pflicht-Stimmen.
  const [voices, defaultVoice, rawFiles, tours] = await Promise.all([
    getVoices(),
    getDefaultVoice(),
    loadPointFiles(supabase, id),
    loadPointTourUsage(supabase, id),
  ]);
  // Signed-URLs für alle vorhandenen Volldateien in EINEM Aufruf (siehe PointVoiceFile).
  const audioPaths = Object.values(rawFiles).flatMap((byLang) =>
    Object.values(byLang).map((f) => f.url).filter((u): u is string => !!u),
  );
  const signedByPath = new Map<string, string>();
  if (audioPaths.length) {
    const { data: signed } = await supabase.storage
      .from("tour-audio")
      .createSignedUrls(audioPaths, 60 * 60);
    for (const sd of signed ?? []) {
      if (sd.path && sd.signedUrl) signedByPath.set(sd.path, sd.signedUrl);
    }
  }
  const files: Record<string, Record<string, PointVoiceFile>> = {};
  for (const [voiceId, byLang] of Object.entries(rawFiles)) {
    files[voiceId] = {};
    for (const [lang, f] of Object.entries(byLang)) {
      files[voiceId][lang] = {
        audioUrl: f.url,
        audioHash: f.hash,
        teaserUrl: f.teaserUrl,
        previewUrl: f.url ? (signedByPath.get(f.url) ?? null) : null,
      };
    }
  }

  const build = (lang: string): PointTextData => {
    const t = trs.find((r) => r.lang === lang);
    const a = audio.find((r) => r.lang === lang);
    return { title: t?.title ?? "", audioText: a?.audio_text ?? "" };
  };
  const translations: Record<string, PointTextData> = {};
  for (const l of routing.locales) {
    if (l === "de") continue;
    const has = trs.some((r) => r.lang === l) || audio.some((r) => r.lang === l);
    if (has) translations[l] = build(l);
  }
  // Aus WELCHEM DE-Stand die Übersetzungen stammen, steht auf den ZIEL-Zeilen (savePoint stempelt
  // sie mit dem Stand von damals). Die DE-Zeile trägt eine eigene Marke, die jeder Save auf aktuell
  // setzt -> als Veraltet-Anker wertlos. Deshalb hier eine Ziel-Zeile lesen, nicht die DE-Zeile.
  const deHash = trs.find((r) => r.lang !== "de" && r.source_hash)?.source_hash ?? undefined;
  return {
    id: p.id as string,
    areaId: p.area_id as string,
    lat: (p.lat as number | null) ?? null,
    lng: (p.lng as number | null) ?? null,
    kind: (p.kind as string | null) ?? "",
    tags: (p.tags as string[] | null) ?? [],
    weight: (p.weight as number | null) ?? 0,
    emoji: (p.emoji as string | null) ?? "",
    imageUrl: (p.image_url as string | null) ?? null,
    status: (p.status as "draft" | "published") ?? "draft",
    de: build("de"),
    translations,
    translationsSourceHash: deHash ?? undefined,
    voice: {
      voices,
      defaultVoiceId: defaultVoice?.id ?? null,
      requiredVoiceIds: requiredVoiceIds(tours.filter((t) => t.status === "published").map((t) => t.voiceId)),
      files,
      tours,
    },
  };
}
