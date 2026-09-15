import "server-only";
import { createServiceClient } from "./supabase/service";
import {
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

const COLS = "id, key, name, kind, eleven_voice_id, person_name, is_default, sort_order";

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
  };
}

export function voiceInfoOf(v: Pick<VoiceRow, "name" | "kind" | "personName"> | null): VoiceInfo | null {
  return v ? { name: v.name, kind: v.kind, personName: v.personName } : null;
}

export async function getVoices(): Promise<VoiceRow[]> {
  const { data } = await createServiceClient()
    .from("tts_voices")
    .select(COLS)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return ((data as Record<string, unknown>[] | null) ?? []).map(toVoiceRow);
}

export async function getDefaultVoice(): Promise<VoiceRow | null> {
  return pickDefaultVoice(await getVoices());
}

export async function getVoiceById(id: string): Promise<VoiceRow | null> {
  if (!id) return null;
  const { data } = await createServiceClient()
    .from("tts_voices")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  return data ? toVoiceRow(data as Record<string, unknown>) : null;
}

/** Die ElevenLabs-ID dieser Stimme, oder null (echte Aufnahme, oder noch keine ID). */
export function elevenIdForVoice(v: VoiceRow): string | null {
  return elevenIdOf(v, { ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID });
}

/** Wo jede Stimme in Gebrauch ist. Zwei kleine Tabellen, deshalb einmal lesen und zaehlen. */
export async function voiceUsageAll(): Promise<Record<string, VoiceUsage>> {
  const db = createServiceClient();
  const [tours, files] = await Promise.all([
    db.from("tours").select("voice_id"),
    db.from("tour_point_voice_files").select("voice_id"),
  ]);
  const out: Record<string, VoiceUsage> = {};
  const bump = (id: unknown, k: keyof VoiceUsage) => {
    if (typeof id !== "string") return;
    (out[id] ??= { tours: 0, files: 0 })[k]++;
  };
  for (const t of (tours.data as { voice_id: string }[] | null) ?? []) bump(t.voice_id, "tours");
  for (const f of (files.data as { voice_id: string }[] | null) ?? []) bump(f.voice_id, "files");
  return out;
}

export async function voiceUsage(id: string): Promise<VoiceUsage> {
  return (await voiceUsageAll())[id] ?? { tours: 0, files: 0 };
}
