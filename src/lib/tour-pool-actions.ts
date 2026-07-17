"use server";

import { createServiceClient } from "./supabase/service";
import { fetchWithRetry } from "./ai-fetch";
import { BRAND_VOICE } from "./brand-voice";
import { TAG_KEYS } from "./tour-tags";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
import { hashTexts } from "./spot-hash";
import { stripEmDashFields } from "./em-dash";
import { requireAdmin } from "./admin-guard";

const POINT_TARGET_LOCALES = routing.locales.filter((l) => l !== "de");

// Server-Actions für das Audio-Tour-POOL-Modell: Gebiete (tour_areas) + dedizierte
// Audio-Punkte (tour_points) statt Explore-Spots. Muster wie tour-actions.ts:
// assertAdmin-Gate + Session-Client-Writes (RLS greift zusätzlich), kein revalidatePath.

const e = (v: string) => (v.trim() === "" ? null : v.trim());

function slugifyKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}


// Cover: nur eigene öffentliche spot-media-URL.
function guardStorageUrl(
  url: string | null,
): { ok: true; url: string | null } | { ok: false } {
  const clean = typeof url === "string" && url.trim() ? url.trim() : null;
  if (!clean) return { ok: true, url: null };
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!base || !clean.startsWith(`${base}/storage/v1/object/public/spot-media/`))
    return { ok: false };
  return { ok: true, url: clean };
}

// Audio: OBJEKT-PFAD im privaten tour-audio-Bucket (keine URL, kein "..").
function guardAudioPath(
  path: string | null,
): { ok: true; path: string | null } | { ok: false } {
  const clean = typeof path === "string" && path.trim() ? path.trim() : null;
  if (!clean) return { ok: true, path: null };
  if (clean.length > 200 || clean.includes("://") || clean.startsWith("/") || clean.includes(".."))
    return { ok: false };
  if (!/^[A-Za-z0-9._/-]+\.(mp3|m4a|aac|ogg|wav)$/i.test(clean)) return { ok: false };
  return { ok: true, path: clean };
}

export type SaveResult = { ok: boolean; id?: string; error?: string };

// ── Gebiete ──────────────────────────────────────────────────────────────────
export type AreaTexts = { name: string; subtitle: string };
export type AreaInput = {
  id?: string;
  emoji: string;
  coverUrl: string | null;
  startLat: number | null;
  startLng: number | null;
  status: "draft" | "published";
  de: AreaTexts;
  translations: Record<string, AreaTexts>;
  translationsSourceHash?: string;
};

export async function saveArea(input: AreaInput): Promise<SaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  const deName = input.de.name.trim();
  if (!deName) return { ok: false, error: "required" };

  const cover = guardStorageUrl(input.coverUrl);
  if (!cover.ok) return { ok: false, error: "bad_url" };

  const row = {
    status: input.status === "published" ? "published" : "draft",
    start_lat: input.startLat != null && Number.isFinite(input.startLat) ? input.startLat : null,
    start_lng: input.startLng != null && Number.isFinite(input.startLng) ? input.startLng : null,
    emoji: e(input.emoji),
    cover_url: cover.url,
  };

  const createdNew = !input.id;
  let areaId = input.id;
  if (areaId) {
    const { error } = await supabase.from("tour_areas").update(row).eq("id", areaId);
    if (error) return { ok: false, error: "db" };
  } else {
    const base = slugifyKey(deName) || "gebiet";
    const { data: existing, error: keyErr } = await supabase.from("tour_areas").select("key");
    if (keyErr) return { ok: false, error: "db" };
    const used = new Set(((existing ?? []) as { key: string }[]).map((r) => r.key));
    for (let attempt = 0; attempt < 6 && !areaId; attempt++) {
      let key = base;
      let n = 2;
      while (used.has(key)) key = `${base}-${n++}`;
      const { data, error } = await supabase
        .from("tour_areas")
        .insert({ ...row, key })
        .select("id")
        .single();
      if (!error && data) areaId = (data as { id: string }).id;
      else if (error && (error as { code?: string }).code === "23505") used.add(key);
      else return { ok: false, error: "db" };
    }
  }
  if (!areaId) return { ok: false, error: "db" };

  const abort = async (err: string): Promise<SaveResult> => {
    if (createdNew && areaId) await supabase.from("tour_areas").delete().eq("id", areaId);
    return { ok: false, error: err };
  };

  const { error: eDe } = await supabase.from("tour_area_translations").upsert(
    { area_id: areaId, lang: "de", name: deName, subtitle: e(input.de.subtitle) },
    { onConflict: "area_id,lang" },
  );
  if (eDe) return abort("db");

  // Übersetzungen je Sprache: mit Inhalt upserten, sonst löschen (kein leerer Rest).
  for (const l of POINT_TARGET_LOCALES) {
    const tx = input.translations?.[l];
    const has = tx && [tx.name, tx.subtitle].some((v) => v.trim() !== "");
    if (has) {
      const { error } = await supabase.from("tour_area_translations").upsert(
        { area_id: areaId, lang: l, name: tx!.name.trim() || deName, subtitle: e(tx!.subtitle) },
        { onConflict: "area_id,lang" },
      );
      if (error) return abort("db");
    } else {
      const { error } = await supabase
        .from("tour_area_translations")
        .delete()
        .eq("area_id", areaId)
        .eq("lang", l);
      if (error) return abort("db");
    }
  }

  // Aktualitäts-Marke (source_hash) auf der DE-Zeile – fehlertolerant (Migration 0031).
  const deHash = hashTexts([deName, input.de.subtitle]);
  await supabase
    .from("tour_area_translations")
    .update({ source_hash: deHash })
    .eq("area_id", areaId)
    .eq("lang", "de");

  return { ok: true, id: areaId };
}

export async function deleteArea(id: string): Promise<SaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { error } = await gate.supabase.from("tour_areas").delete().eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}

export async function setAreaStatus(
  id: string,
  status: "draft" | "published",
): Promise<SaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const s = status === "published" ? "published" : "draft";
  const { error } = await gate.supabase.from("tour_areas").update({ status: s }).eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true, id };
}

// ── Pool-Punkte ──────────────────────────────────────────────────────────────
export type PointTexts = { title: string; audioText: string; audioUrl: string | null };
export type PointInput = {
  id?: string;
  areaId: string;
  lat: number | null;
  lng: number | null;
  kind: string;
  tags: string[];
  weight: number;
  emoji: string;
  imageUrl: string | null;
  status: "draft" | "published";
  de: PointTexts;
  // Übersetzungen je Sprache (Titel + Sprechtext + Audiodatei). DE bleibt in `de`.
  translations: Record<string, PointTexts>;
  translationsSourceHash?: string;
};

function cleanTags(tags: string[]): string[] {
  return [
    ...new Set(
      (tags ?? [])
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 40),
    ),
  ].slice(0, 20);
}

export async function savePoint(input: PointInput): Promise<SaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  if (!input.areaId) return { ok: false, error: "bad_input" };
  const deTitle = input.de.title.trim();
  if (!deTitle) return { ok: false, error: "required" };

  const audioDe = guardAudioPath(input.de.audioUrl);
  if (!audioDe.ok) return { ok: false, error: "bad_url" };
  const image = guardStorageUrl(input.imageUrl);
  if (!image.ok) return { ok: false, error: "bad_url" };

  // Übersetzungen einlesen + Audiopfade prüfen.
  const trClean: Record<string, { title: string; audioText: string; path: string | null }> = {};
  for (const [lang, tx] of Object.entries(input.translations ?? {})) {
    if (lang === "de" || !tx) continue;
    const g = guardAudioPath(tx.audioUrl);
    if (!g.ok) return { ok: false, error: "bad_url" };
    trClean[lang] = {
      title: (tx.title ?? "").trim(),
      audioText: (tx.audioText ?? "").trim(),
      path: g.path,
    };
  }

  // VERÖFFENTLICHEN nur, wenn ALLE Sprachen Titel + Audio (Sprechtext + mp3) haben.
  // (Als Entwurf speichern ist immer erlaubt.) -> Anti-Chaos-Gate für Audio-Punkte.
  if (input.status === "published") {
    const missing: string[] = [];
    if (!audioDe.path || !input.de.audioText.trim()) missing.push("de");
    for (const l of POINT_TARGET_LOCALES) {
      const g = trClean[l];
      if (!g || !g.title || !g.path || !g.audioText) missing.push(l);
    }
    if (missing.length) return { ok: false, error: `langs_incomplete:${missing.join(",")}` };
  }

  const row = {
    area_id: input.areaId,
    lat: input.lat != null && Number.isFinite(input.lat) ? input.lat : null,
    lng: input.lng != null && Number.isFinite(input.lng) ? input.lng : null,
    kind: e(input.kind),
    tags: cleanTags(input.tags),
    weight: Number.isFinite(input.weight) ? Math.trunc(input.weight) : 0,
    emoji: e(input.emoji),
    image_url: image.url,
    status: input.status === "published" ? "published" : "draft",
  };

  const createdNew = !input.id;
  let pointId = input.id;
  if (pointId) {
    const { error } = await supabase.from("tour_points").update(row).eq("id", pointId);
    if (error) return { ok: false, error: "db" };
  } else {
    const { data, error } = await supabase
      .from("tour_points")
      .insert(row)
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "db" };
    pointId = (data as { id: string }).id;
  }
  if (!pointId) return { ok: false, error: "db" };

  const abort = async (err: string): Promise<SaveResult> => {
    if (createdNew && pointId) await supabase.from("tour_points").delete().eq("id", pointId);
    return { ok: false, error: err };
  };

  // Titel (öffentlich) je Sprache.
  const deHash = hashTexts([input.de.title, input.de.audioText]);
  const { error: eDe } = await supabase.from("tour_point_translations").upsert(
    { point_id: pointId, lang: "de", title: deTitle },
    { onConflict: "point_id,lang" },
  );
  if (eDe) return abort("db");
  for (const l of POINT_TARGET_LOCALES) {
    const g = trClean[l];
    if (g && g.title) {
      const { error } = await supabase.from("tour_point_translations").upsert(
        { point_id: pointId, lang: l, title: g.title },
        { onConflict: "point_id,lang" },
      );
      if (error) return abort("db");
    } else {
      await supabase
        .from("tour_point_translations")
        .delete()
        .eq("point_id", pointId)
        .eq("lang", l);
    }
  }

  // Audio je Sprache (Pro-Asset). Leere Felder -> Zeile löschen.
  const audioRows: [string, string | null, string][] = [
    ["de", audioDe.path, input.de.audioText],
    ...POINT_TARGET_LOCALES.map(
      (l) => [l, trClean[l]?.path ?? null, trClean[l]?.audioText ?? ""] as [string, string | null, string],
    ),
  ];
  for (const [lang, path, text] of audioRows) {
    const txt = (text ?? "").trim();
    if (!path && !txt) {
      const { error: eDel } = await supabase
        .from("tour_point_audio")
        .delete()
        .eq("point_id", pointId)
        .eq("lang", lang);
      if (eDel) return abort("db");
    } else {
      const { error: eAudio } = await supabase.from("tour_point_audio").upsert(
        { point_id: pointId, lang, audio_url: path, audio_text: txt || null },
        { onConflict: "point_id,lang" },
      );
      if (eAudio) return abort("db");
    }
  }

  // Aktualitäts-Marken (source_hash) fehlertolerant setzen (Migration 0031).
  {
    const { error: dh } = await supabase
      .from("tour_point_translations")
      .update({ source_hash: deHash })
      .eq("point_id", pointId)
      .eq("lang", "de");
    if (!dh && input.translationsSourceHash) {
      await supabase
        .from("tour_point_translations")
        .update({ source_hash: input.translationsSourceHash })
        .eq("point_id", pointId)
        .neq("lang", "de");
    }
  }

  return { ok: true, id: pointId };
}

export async function deletePoint(id: string): Promise<SaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { error } = await gate.supabase.from("tour_points").delete().eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}

export async function setPointStatus(
  id: string,
  status: "draft" | "published",
): Promise<SaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const s = status === "published" ? "published" : "draft";
  const { error } = await gate.supabase.from("tour_points").update({ status: s }).eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true, id };
}

// Pool-Punkte eines Gebiets für den kuratierten Runden-Builder (Client-Picker).
export type PickerPoint = { id: string; title: string; status: string; hasAudio: boolean };

export async function listAreaPoints(
  areaId: string,
): Promise<{ ok: boolean; points?: PickerPoint[]; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!areaId) return { ok: true, points: [] };
  const { data, error } = await gate.supabase
    .from("tour_points")
    .select("id, status, tour_point_translations(lang, title), tour_point_audio(lang)")
    .eq("area_id", areaId)
    .order("sort_order", { ascending: true });
  if (error) return { ok: false, error: "db" };
  const points: PickerPoint[] = ((data as unknown as Record<string, unknown>[]) ?? []).map((p) => {
    const trs = (p.tour_point_translations as { lang: string; title: string }[] | null) ?? [];
    const tr = trs.find((r) => r.lang === "de") ?? trs[0];
    return {
      id: p.id as string,
      title: tr?.title ?? "(ohne Titel)",
      status: p.status as string,
      hasAudio: ((p.tour_point_audio as unknown[] | null) ?? []).length > 0,
    };
  });
  return { ok: true, points };
}

// ── KI-Sprechtexte für Audio-Punkte ──────────────────────────────────────────
// Zusatz zur zentralen BRAND_VOICE: Regeln speziell für den gesprochenen Audio-Tour-
// Text (Zielgruppe [[salzguide-zielgruppe]]: junge Locals/Reisende 18–40, anti-Kitsch).
const AUDIO_GUIDE_RULES = `AUDIO-GUIDE-MODUS (gesprochener Text):
- Du schreibst einen SPRECHTEXT für eine selbstgeführte Audio-Tour, den eine Stimme vorliest. Nur den Fließtext ausgeben – keine Überschrift, keine Regieanweisung, keine Aufzählung.
- LÄNGE: 90–120 Sekunden gesprochen = ca. 220–300 Wörter. Lieber knackig als zu lang. NICHT überziehen.
- Klingt GESPROCHEN, nicht geschrieben: kurze Sätze, Du-Form, gut zum Zuhören beim Gehen.
- Zielgruppe: junge Locals & Reisende (18–40), allergisch auf Museums-/Reiseführer-Gelaber. Also KEIN "Willkommen bei..."-Ton, keine trockene Chronologie.
- Starker HOOK im ersten Satz (neugierig machen), dann 1–2 überraschende, konkrete Facts oder eine kleine Anekdote/Geschichte zu GENAU diesem Ort – zeig, warum's cool/lustig/besonders ist.
- WENIG Jahreszahlen (höchstens eine, nur wenn sie wirklich was bringt). Keine Datenflut, keine Namensketten.
- Ende mit einem kleinen "schau dir das an" / einer Überleitung zum Weitergehen.
- Fakten 100% korrekt: nutze NUR die gegebenen Notizen/Fakten + wirklich allgemein bekanntes Wissen. Erfinde nichts (keine erfundenen Zahlen, Namen, Distanzen).`;

export type PointAudioGenResult = { ok: boolean; text?: string; error?: string };

async function callAudioTool(
  system: string,
  userMsg: string,
  toolName: string,
): Promise<PointAudioGenResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };
  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 900,
          system,
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: toolName,
              description: "Der fertige gesprochene Audio-Tour-Text.",
              input_schema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          ],
          tool_choice: { type: "tool", name: toolName },
        }),
      },
      2,
      60000,
    );
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Claude ${res.status}: ${txt.slice(0, 160)}` };
    }
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === toolName,
    ) as { input?: { text?: string } } | undefined;
    const text = block?.input?.text?.trim();
    if (!text) return { ok: false, error: "Kein Text erhalten" };
    return { ok: true, text };
  } catch {
    return { ok: false, error: "KI-Dienst gerade nicht erreichbar – bitte nochmal versuchen." };
  }
}

// Deutschen Sprechtext für einen Punkt erzeugen (grounded auf Titel/Tags/Notizen).
export async function generatePointAudioText(input: {
  title: string;
  kind: string;
  tags: string[];
  areaName: string;
  notes: string;
}): Promise<PointAudioGenResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.title.trim()) return { ok: false, error: "Bitte zuerst einen Titel eingeben." };

  const system = `${BRAND_VOICE}\n\n${AUDIO_GUIDE_RULES}`;
  const ctx = [
    `Station: ${input.title.trim()}`,
    input.areaName.trim() ? `Gebiet: ${input.areaName.trim()}` : "",
    input.kind.trim() ? `Typ: ${input.kind.trim()}` : "",
    input.tags.length ? `Themen-Tags: ${input.tags.join(", ")}` : "",
    input.notes.trim() ? `Notizen & Fakten (Grundlage, nutze NUR das + allgemein Bekanntes):\n${input.notes.trim()}` : "Keine zusätzlichen Notizen – bleib bei allgemein bekannten, sicheren Fakten und erfinde nichts.",
  ]
    .filter(Boolean)
    .join("\n");
  const userMsg = `Schreib den deutschen Sprechtext (90–120 Sek.) für diese Audio-Tour-Station und gib ihn über das Tool "audio_text_de" zurück.\n\n${ctx}`;
  return callAudioTool(system, userMsg, "audio_text_de");
}

// ── TTS: Sprechtext -> MP3-Stimme (ElevenLabs) ───────────────────────────────
// Erzeugt serverseitig die Audiodatei und legt sie im PRIVATEN tour-audio-Bucket ab
// (Service-Client). Der Client bekommt nur den Objekt-PFAD zurück (wie beim manuellen
// Upload) -> Auslieferung weiterhin nur via Signed-URL an berechtigte Hörer.
const ELEVEN_MODEL = "eleven_multilingual_v2"; // EINE Stimme spricht ALLE Sprachen
function elevenVoiceId(lang: string): string {
  // Eine Basis-Stimme für alle Sprachen (multilingual-Model spricht die jeweilige Sprache).
  // Optional pro Sprache überschreibbar via ELEVENLABS_VOICE_ID_<LANG> (z. B. _EN, _FR).
  const base = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const perLang = process.env[`ELEVENLABS_VOICE_ID_${lang.toUpperCase()}`];
  return perLang && perLang.trim() ? perLang.trim() : base;
}

// Voice-Settings für RUHIGES, natürliches Vorlesen (nicht hetzen, Pausen zulassen):
// - speed 0.9 (< 1.0 = langsamer) ist der Haupt-Hebel gegen „zu schnell"
// - style 0.0 = keine Übertreibung -> ruhiger, gleichmäßiger, natürliche Betonung/Pausen
// - stability etwas höher = konsistente, angenehme Erzählstimme
// Alles per ENV feinjustierbar (ohne Code-Änderung), sauber geklemmt auf gültige Bereiche.
function clampNum(v: string | undefined, def: number, min: number, max: number): number {
  const n = v != null && v !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function elevenVoiceSettings() {
  return {
    stability: clampNum(process.env.ELEVENLABS_STABILITY, 0.55, 0, 1),
    similarity_boost: clampNum(process.env.ELEVENLABS_SIMILARITY, 0.75, 0, 1),
    style: clampNum(process.env.ELEVENLABS_STYLE, 0.0, 0, 1),
    use_speaker_boost: process.env.ELEVENLABS_SPEAKER_BOOST !== "false",
    speed: clampNum(process.env.ELEVENLABS_SPEED, 0.9, 0.7, 1.2),
  };
}

export type TtsResult = { ok: boolean; path?: string; previewUrl?: string | null; error?: string };

export async function synthesizePointVoice(input: {
  text: string;
  lang: string;
}): Promise<TtsResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Kein Text zum Vertonen." };
  if (text.length > 5000) return { ok: false, error: "Text zu lang (max. 5000 Zeichen)." };
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, error: "ELEVENLABS_API_KEY fehlt – bitte in .env.local eintragen" };
  const lang = (input.lang || "de").toLowerCase();

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${elevenVoiceId(lang)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: ELEVEN_MODEL,
          voice_settings: elevenVoiceSettings(),
        }),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `ElevenLabs ${res.status}: ${t.slice(0, 160)}` };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return { ok: false, error: "Leere Audio-Antwort von ElevenLabs." };

    const service = createServiceClient();
    const path = `point-${lang}-${crypto.randomUUID()}.mp3`;
    const { error } = await service.storage
      .from("tour-audio")
      .upload(path, bytes, { contentType: "audio/mpeg", upsert: false });
    if (error) return { ok: false, error: "Upload der Stimme fehlgeschlagen." };
    // Kurzlebige Signed-URL zum sofortigen Probehören im Admin (privater Bucket).
    const { data: signed } = await service.storage
      .from("tour-audio")
      .createSignedUrl(path, 60 * 30);
    return { ok: true, path, previewUrl: signed?.signedUrl ?? null };
  } catch {
    return { ok: false, error: "TTS gerade nicht erreichbar – bitte nochmal versuchen." };
  }
}

// Deutschen Sprechtext ins Englische übertragen (gleicher Ton, gleiche Länge).
export async function translatePointAudioText(input: {
  textDe: string;
}): Promise<PointAudioGenResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.textDe.trim()) return { ok: false, error: "Kein deutscher Text zum Übersetzen." };

  const system = `You translate a spoken audio-tour narration from German to English for SalzGuide. Keep the SAME casual young-local vibe (like a friend telling you something cool on the spot), the same length (~90–120 seconds spoken), short spoken sentences, "you" form. Avoid museum/brochure tone and clichés (breathtaking, hidden gem, must-see). NEVER use em dashes (—). They are the clearest tell of AI-written text and cost us the trust this brand is built on. Write like a human types: full stop, comma, colon, or a plain hyphen. The ONLY exception is Chinese, where the doubled "——" is standard punctuation. Keep proper nouns/place names. Translate faithfully; invent nothing. Return only the narration text via the tool "audio_text_en".`;
  const userMsg = `Translate this German audio-tour narration to English and return it via the tool "audio_text_en":\n\n${input.textDe.trim()}`;
  return callAudioTool(system, userMsg, "audio_text_en");
}

// ── KI: „In ALLE Sprachen übersetzen" (Titel + Sprechtext) ───────────────────
export type PointTranslateAllResult = {
  ok: boolean;
  translations?: Record<string, { title: string; audioText: string }>;
  sourceHash?: string;
  failed?: string[];
  error?: string;
};

async function translatePointTo(
  src: { title: string; audioText: string },
  locale: string,
  key: string,
): Promise<{ title: string; audioText: string } | null> {
  const langName = localeMeta(locale).english;
  const system = `You translate a SalzGuide audio-tour point from German into natural ${langName}. Keep the SAME casual young-local vibe (like a friend telling you something cool on the spot), the same narration length (~90–120s spoken), short spoken sentences, informal "you" address. Avoid museum/brochure tone and clichés. NEVER use em dashes (—). They are the clearest tell of AI-written text and cost us the trust this brand is built on. Write like a human types: full stop, comma, colon, or a plain hyphen. The ONLY exception is Chinese, where the doubled "——" is standard punctuation. Keep proper nouns/place names exactly. Translate faithfully; invent nothing. Return a short "title" and the spoken "audio_text" via the tool "point_texts".`;
  const userMsg = `Translate this German audio-tour point into ${langName} and return it via the tool "point_texts".\n\nTitle: ${src.title.trim()}\n\nNarration:\n${src.audioText.trim()}`;
  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          system,
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: "point_texts",
              description: `${langName} title + spoken narration.`,
              input_schema: {
                type: "object",
                properties: { title: { type: "string" }, audio_text: { type: "string" } },
                required: ["title", "audio_text"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "point_texts" },
        }),
      },
      2,
      60000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "point_texts",
    ) as { input?: Record<string, string> } | undefined;
    const t = block?.input;
    if (!t) return null;
    // locale mitgeben: Chinesisch braucht seinen Strich (破折号).
    return stripEmDashFields(
      {
        title: (t.title ?? "").trim() || src.title.trim(),
        audioText: src.audioText.trim() ? (t.audio_text ?? "").trim() : "",
      },
      locale,
    );
  } catch {
    return null;
  }
}

export async function translatePointTextsAll(input: {
  title: string;
  audioText: string;
}): Promise<PointTranslateAllResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.title.trim())
    return { ok: false, error: "Bitte zuerst deutschen Titel/Text erstellen." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  const results = await Promise.all(
    POINT_TARGET_LOCALES.map(async (l) => [l, await translatePointTo(input, l, key)] as const),
  );
  const translations: Record<string, { title: string; audioText: string }> = {};
  const failed: string[] = [];
  for (const [l, tx] of results) {
    if (tx) translations[l] = tx;
    else failed.push(l);
  }
  if (Object.keys(translations).length === 0)
    return { ok: false, error: "Übersetzung fehlgeschlagen – bitte nochmal versuchen." };
  return {
    ok: true,
    translations,
    sourceHash: hashTexts([input.title, input.audioText]),
    failed: failed.length ? failed : undefined,
  };
}

// ── EIN-Klick-KI: füllt fast alles für einen Punkt (super easy für Admins) ────
export type PointFillData = {
  titleEn: string;
  tags: string[];
  emoji: string;
  kind: string;
  audioTextDe: string;
};

export async function generatePointAll(input: {
  title: string;
  notes: string;
  areaName: string;
}): Promise<{ ok: boolean; data?: PointFillData; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.title.trim()) return { ok: false, error: "Bitte zuerst einen Titel eingeben." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  const system = `${BRAND_VOICE}\n\n${AUDIO_GUIDE_RULES}\n\nDU FÜLLST AUSSERDEM METADATEN für diesen Audio-Tour-Punkt:
- title_en: englische Übersetzung des Titels (Eigennamen/Ortsnamen behalten).
- tags: 0–4 passende Themen NUR aus dieser Liste (exakt diese Keys): ${TAG_KEYS.join(", ")}.
- emoji: EIN passendes Emoji zum Ort.
- kind: kurzer Typ auf Deutsch (1–2 Wörter, z.B. Aussicht, Sage, Kirche, Café, Platz, Gasse).
- audio_text_de: NUR der DEUTSCHE Sprechtext (90–120 Sek.). Den englischen Text macht später ein separater Übersetzen-Schritt – hier NICHT erzeugen.`;
  const ctx = [
    `Station: ${input.title.trim()}`,
    input.areaName.trim() ? `Gebiet: ${input.areaName.trim()}` : "",
    input.notes.trim()
      ? `Notizen & Fakten (Grundlage, nutze NUR das + allgemein Bekanntes):\n${input.notes.trim()}`
      : "Keine Notizen – bleib bei allgemein bekannten, sicheren Fakten und erfinde nichts.",
  ]
    .filter(Boolean)
    .join("\n");
  const userMsg = `Erzeuge den DEUTSCHEN Sprechtext (90–120 Sek.) UND die Metadaten (EN-Titel, Tags, Emoji, Typ) für diese Audio-Tour-Station. Gib alles über das Tool "point_content" zurück.\n\n${ctx}`;

  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          system,
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: "point_content",
              description: "Deutscher Sprechtext + Metadaten für den Audio-Tour-Punkt.",
              input_schema: {
                type: "object",
                properties: {
                  title_en: { type: "string" },
                  tags: { type: "array", items: { type: "string", enum: [...TAG_KEYS] } },
                  emoji: { type: "string" },
                  kind: { type: "string" },
                  audio_text_de: { type: "string" },
                },
                required: ["title_en", "tags", "emoji", "kind", "audio_text_de"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "point_content" },
        }),
      },
      2,
      60000,
    );
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `Claude ${res.status}: ${t.slice(0, 160)}` };
    }
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "point_content",
    ) as { input?: Record<string, unknown> } | undefined;
    const d = block?.input;
    if (!d) return { ok: false, error: "Keine Antwort erhalten" };
    const allowed = new Set<string>(TAG_KEYS);
    const tags = Array.isArray(d.tags)
      ? (d.tags as unknown[]).filter((x): x is string => typeof x === "string" && allowed.has(x))
      : [];
    return {
      ok: true,
      data: {
        titleEn: String(d.title_en ?? "").trim() || input.title.trim(),
        tags,
        emoji: String(d.emoji ?? "").trim(),
        kind: String(d.kind ?? "").trim(),
        audioTextDe: String(d.audio_text_de ?? "").trim(),
      },
    };
  } catch {
    return { ok: false, error: "KI-Dienst gerade nicht erreichbar – bitte nochmal versuchen." };
  }
}

// Gebiets-Texte (Name + Untertitel) ins Englische übersetzen.
export async function translateAreaText(input: {
  name: string;
  subtitle: string;
}): Promise<{ ok: boolean; texts?: { name: string; subtitle: string }; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.name.trim()) return { ok: false, error: "Bitte zuerst den deutschen Namen ausfüllen." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };
  const system = `You translate short SalzGuide UI labels from German to English. Natural and casual, no clichés. Keep proper nouns/place names. Keep empty fields empty. Return via the tool "area_texts_en".`;
  const userMsg = `Translate to English via tool "area_texts_en" (keep empty fields empty).\nname: ${input.name.trim()}\nsubtitle: ${input.subtitle.trim()}`;
  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 400,
          system,
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: "area_texts_en",
              description: "English translations of the area labels.",
              input_schema: {
                type: "object",
                properties: { name: { type: "string" }, subtitle: { type: "string" } },
                required: ["name", "subtitle"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "area_texts_en" },
        }),
      },
      2,
      45000,
    );
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `Claude ${res.status}: ${t.slice(0, 160)}` };
    }
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "area_texts_en",
    ) as { input?: { name?: string; subtitle?: string } } | undefined;
    const en = block?.input;
    if (!en) return { ok: false, error: "Keine Übersetzung erhalten" };
    return {
      ok: true,
      texts: {
        name: en.name?.trim() || input.name.trim(),
        subtitle: input.subtitle.trim() ? (en.subtitle ?? "").trim() : "",
      },
    };
  } catch {
    return { ok: false, error: "KI-Dienst gerade nicht erreichbar – bitte nochmal versuchen." };
  }
}

// ── KI: Gebiet-Labels „In ALLE Sprachen übersetzen" ──────────────────────────
export type AreaTranslateAllResult = {
  ok: boolean;
  translations?: Record<string, AreaTexts>;
  sourceHash?: string;
  failed?: string[];
  error?: string;
};

async function translateAreaTo(
  src: AreaTexts,
  locale: string,
  key: string,
): Promise<AreaTexts | null> {
  const langName = localeMeta(locale).english;
  const system = `You translate short SalzGuide UI labels from German into natural ${langName}. Casual, no clichés. Keep proper nouns/place names. Keep empty fields empty. Return via the tool "area_texts".`;
  const userMsg = `Translate to ${langName} via tool "area_texts" (keep empty fields empty).\nname: ${src.name.trim()}\nsubtitle: ${src.subtitle.trim()}`;
  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 400,
          system,
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: "area_texts",
              description: `${langName} translations of the area labels.`,
              input_schema: {
                type: "object",
                properties: { name: { type: "string" }, subtitle: { type: "string" } },
                required: ["name", "subtitle"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "area_texts" },
        }),
      },
      2,
      45000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "area_texts",
    ) as { input?: { name?: string; subtitle?: string } } | undefined;
    const t = block?.input;
    if (!t) return null;
    return {
      name: (t.name ?? "").trim() || src.name.trim(),
      subtitle: src.subtitle.trim() ? (t.subtitle ?? "").trim() : "",
    };
  } catch {
    return null;
  }
}

export async function translateAreaTextAll(input: AreaTexts): Promise<AreaTranslateAllResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.name.trim()) return { ok: false, error: "Bitte zuerst den deutschen Namen ausfüllen." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  const results = await Promise.all(
    POINT_TARGET_LOCALES.map(async (l) => [l, await translateAreaTo(input, l, key)] as const),
  );
  const translations: Record<string, AreaTexts> = {};
  const failed: string[] = [];
  for (const [l, tx] of results) {
    if (tx) translations[l] = tx;
    else failed.push(l);
  }
  if (Object.keys(translations).length === 0)
    return { ok: false, error: "Übersetzung fehlgeschlagen – bitte nochmal versuchen." };
  return {
    ok: true,
    translations,
    sourceHash: hashTexts([input.name, input.subtitle]),
    failed: failed.length ? failed : undefined,
  };
}
