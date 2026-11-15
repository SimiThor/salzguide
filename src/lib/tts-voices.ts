import "server-only";
import { createServiceClient } from "./supabase/service";
import {
  cleanVoiceSettings,
  elevenIdOf,
  pickDefaultVoice,
  type VoiceInfo,
  type VoiceRow,
  type VoiceKind,
  type VoiceUsage,
} from "./tts-rules";
export type { VoiceUsage };

// Lesen der Stimmen (tts_voices, Migration 0068). Ueber den Service-Client, weil die Tabelle
// keinen Public-Read hat und auch der Player (Offenlegung) und der KI-Runden-Generator sie
// brauchen. Geschrieben wird nur in tts-voice-actions.ts, hinter requireAdmin.

const BASE_COLS = "id, key, name, kind, eleven_voice_id, person_name, is_default, sort_order";
// Sprech-Einstellungen je Stimme (0069). Fehlen die Spalten noch, greift der zweite Versuch
// ohne sie, und die Stimme bekommt die ElevenLabs-Standardwerte (cleanVoiceSettings).
const SETTING_COLS = "stability, similarity, style, speed, speaker_boost";

export function toVoiceRow(r: Record<string, unknown>): VoiceRow {
  return {
    id: r.id as string,
    key: r.key as string,
    name: r.name as string,
    kind: (r.kind as VoiceKind) ?? "synthetic",
    elevenVoiceId: (r.eleven_voice_id as string | null) ?? null,
    personName: (r.person_name as string | null) ?? null,
    isDefault: Boolean(r.is_default),
    sortOrder: (r.sort_order as number | null) ?? 0,
    settings: cleanVoiceSettings({
      stability: r.stability,
      similarity: r.similarity,
      style: r.style,
      speed: r.speed,
      speakerBoost: r.speaker_boost,
    }),
  };
}

export function voiceInfoOf(v: Pick<VoiceRow, "name" | "kind" | "personName"> | null): VoiceInfo | null {
  return v ? { name: v.name, kind: v.kind, personName: v.personName } : null;
}

export async function getVoices(): Promise<VoiceRow[]> {
  const db = createServiceClient();
  const q = (cols: string) =>
    db.from("tts_voices").select(cols).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
  let { data, error } = await q(`${BASE_COLS}, ${SETTING_COLS}`);
  if (error) ({ data, error } = await q(BASE_COLS));
  return ((data as unknown as Record<string, unknown>[] | null) ?? []).map(toVoiceRow);
}

export async function getDefaultVoice(): Promise<VoiceRow | null> {
  return pickDefaultVoice(await getVoices());
}

export async function getVoiceById(id: string): Promise<VoiceRow | null> {
  if (!id) return null;
  const db = createServiceClient();
  let { data, error } = await db.from("tts_voices").select(`${BASE_COLS}, ${SETTING_COLS}`).eq("id", id).maybeSingle();
  if (error) ({ data, error } = await db.from("tts_voices").select(BASE_COLS).eq("id", id).maybeSingle());
  return data ? toVoiceRow(data as unknown as Record<string, unknown>) : null;
}

/** Die ElevenLabs-ID dieser Stimme, oder null (echte Aufnahme, oder noch keine ID). */
export function elevenIdForVoice(v: VoiceRow): string | null {
  return elevenIdOf(v, { ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID });
}

/** Wo jede Stimme in Gebrauch ist. Zwei kleine Tabellen, deshalb einmal lesen und zaehlen. */
export async function voiceUsageAll(): Promise<Record<string, VoiceUsage>> {
  const db = createServiceClient();
  // nav_prompt_files (0077) zaehlt als Dateien mit: Die ElevenLabs-ID einer Stimme mit
  // Ansagen ist genauso unveraenderlich, und sie laesst sich nicht loeschen. Fehlt die Tabelle
  // noch, kommt data = null und es zaehlt nichts.
  const [tours, files, navFiles] = await Promise.all([
    db.from("tours").select("voice_id"),
    db.from("tour_point_voice_files").select("voice_id"),
    db.from("nav_prompt_files").select("voice_id"),
  ]);
  const out: Record<string, VoiceUsage> = {};
  const bump = (id: unknown, k: keyof VoiceUsage) => {
    if (typeof id !== "string") return;
    (out[id] ??= { tours: 0, files: 0 })[k]++;
  };
  for (const t of (tours.data as { voice_id: string }[] | null) ?? []) bump(t.voice_id, "tours");
  for (const f of (files.data as { voice_id: string }[] | null) ?? []) bump(f.voice_id, "files");
  for (const f of (navFiles.data as { voice_id: string }[] | null) ?? []) bump(f.voice_id, "files");
  return out;
}

/**
 * Die Stimme der gesprochenen Navigations-Ansagen (tts_voices.is_nav, Migration 0077), oder
 * null. Eigene Abfrage statt BASE_COLS: Ohne die Migration darf die Stimmenliste nicht
 * ausfallen, hier kommt dann einfach null.
 */
export async function getNavVoiceId(): Promise<string | null> {
  const r = await getNavVoiceState();
  return r.ok ? r.id : null;
}

/**
 * Wie getNavVoiceId, aber ein Datenbankfehler ist KEIN "keine Stimme": Die Manifest-Route
 * muss ihn von "nichts aktiv" unterscheiden, sonst löscht die App bei einem Aussetzer ihren
 * Satz. Nur die fehlende Spalte (Migration noch nicht eingespielt, 42703 / PGRST204) gilt als
 * "keine Stimme".
 */
export async function getNavVoiceState(): Promise<{ ok: true; id: string | null } | { ok: false }> {
  const { data, error } = await createServiceClient().from("tts_voices").select("id").eq("is_nav", true).maybeSingle();
  if (error) {
    const code = (error as { code?: string }).code;
    return code === "42703" || code === "PGRST204" ? { ok: true, id: null } : { ok: false };
  }
  return { ok: true, id: data ? (data as { id: string }).id : null };
}

export async function voiceUsage(id: string): Promise<VoiceUsage> {
  return (await voiceUsageAll())[id] ?? { tours: 0, files: 0 };
}
