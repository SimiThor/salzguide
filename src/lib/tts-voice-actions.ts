"use server";

import { requireAdmin } from "./admin-guard";
import { logOps } from "./ops";
import { slugifyKey } from "./slug";
import { elevenSpeak, fetchElevenVoiceSettings, validateElevenVoice } from "./tts";
import { elevenIdForVoice, getVoiceById, getVoices, voiceUsage } from "./tts-voices";
import {
  ELEVEN_VOICE_ID_RE,
  VOICE_KINDS,
  cleanVoiceSettings,
  type VoiceKind,
  type VoiceSettings,
} from "./tts-rules";

// Server-Actions fuer die Stimmen selbst (tts_voices, Migration 0068): anlegen, aendern,
// Standard setzen, loeschen, probehoeren. Schreiben ueber den Session-Client unter RLS
// tts_voices_admin_all; jede Aenderung landet als admin_action im Logbuch (OWASP A09).

export type VoiceSaveInput = {
  id?: string;
  name: string;
  kind: VoiceKind;
  elevenVoiceId: string;
  personName: string;
  /** Sprech-Einstellungen (0069). Fehlen sie, gelten die ElevenLabs-Standardwerte. */
  settings?: Partial<VoiceSettings>;
};
export type VoiceActionResult = { ok: boolean; id?: string; error?: string };

export async function saveVoice(input: VoiceSaveInput): Promise<VoiceActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  const name = (input.name ?? "").trim().slice(0, 60);
  if (!name) return { ok: false, error: "required" };
  const kind: VoiceKind = VOICE_KINDS.includes(input.kind) ? input.kind : "synthetic";
  const personName = (input.personName ?? "").trim().slice(0, 60) || null;
  if (kind !== "synthetic" && !personName) return { ok: false, error: "person_required" };
  const elevenVoiceId = kind === "human" ? null : (input.elevenVoiceId ?? "").trim() || null;
  if (elevenVoiceId && !ELEVEN_VOICE_ID_RE.test(elevenVoiceId)) return { ok: false, error: "bad_voice_id" };

  const existing = input.id ? await getVoiceById(input.id) : null;
  if (input.id && !existing) return { ok: false, error: "not_found" };

  // Eine geaenderte ID unter derselben Stimme hiesse: Die Dateien im Bucket sprechen mit
  // einer anderen Stimme als die Zeile behauptet, und niemand saehe es. Neue Stimme anlegen.
  if (existing && existing.elevenVoiceId && elevenVoiceId !== existing.elevenVoiceId) {
    const usage = await voiceUsage(existing.id);
    if (usage.files > 0) return { ok: false, error: "voice_has_files" };
  }
  // Nur pruefen, was neu ist. Kostet keine Zeichen, faengt aber den Tippfehler, der sonst
  // erst beim 98-Dateien-Lauf auffiele. Darf der Schluessel Stimmen nicht lesen
  // (`unverified`, fehlende Berechtigung voices_read), wird trotzdem gespeichert:
  // Probehoeren prueft die ID dann ueber die Vertonung.
  let verified = false;
  if (elevenVoiceId && elevenVoiceId !== existing?.elevenVoiceId) {
    const v = await validateElevenVoice(elevenVoiceId);
    if (!v.ok && v.error !== "unverified") return { ok: false, error: v.error };
    verified = v.ok;
  }

  const s = cleanVoiceSettings(input.settings);
  const row = {
    name,
    kind,
    eleven_voice_id: elevenVoiceId,
    person_name: personName,
    stability: s.stability,
    similarity: s.similarity,
    style: s.style,
    speed: s.speed,
    speaker_boost: s.speakerBoost,
  };
  let id = existing?.id;
  if (id) {
    const { error } = await supabase.from("tts_voices").update(row).eq("id", id);
    if (error) return { ok: false, error: "db" };
  } else {
    const used = new Set((await getVoices()).map((v) => v.key));
    const base = slugifyKey(name) || "stimme";
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
    const isFirst = used.size === 0;
    const { data, error } = await supabase
      .from("tts_voices")
      .insert({ ...row, key, is_default: isFirst, sort_order: used.size })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: (error as { code?: string } | null)?.code === "23505" ? "key_taken" : "db" };
    id = (data as { id: string }).id;
  }
  await logOps("admin_action", {
    message: existing ? "Stimme geändert" : "Stimme angelegt",
    group: "voices",
    detail: { key: existing?.key ?? slugifyKey(name), kind, idVerified: verified },
  });
  return { ok: true, id };
}

export async function setDefaultVoice(id: string): Promise<VoiceActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const target = await getVoiceById(id);
  if (!target) return { ok: false, error: "not_found" };
  // Erst alle loeschen, dann eine setzen: Der Partial-Unique-Index laesst nur eine zu.
  // Zwischen den beiden Schritten faengt pickDefaultVoice() das Fenster ab.
  const { error: e1 } = await gate.supabase.from("tts_voices").update({ is_default: false }).eq("is_default", true);
  if (e1) return { ok: false, error: "db" };
  const { error: e2 } = await gate.supabase.from("tts_voices").update({ is_default: true }).eq("id", id);
  if (e2) return { ok: false, error: "db" };
  await logOps("admin_action", { message: "Standard-Stimme gesetzt", group: "voices", detail: { key: target.key } });
  return { ok: true, id };
}

export async function deleteVoice(id: string): Promise<VoiceActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const v = await getVoiceById(id);
  if (!v) return { ok: false, error: "not_found" };
  if (v.isDefault) return { ok: false, error: "voice_is_default" };
  const usage = await voiceUsage(id);
  if (usage.tours > 0 || usage.files > 0) return { ok: false, error: "voice_in_use" };
  const { error } = await gate.supabase.from("tts_voices").delete().eq("id", id);
  // 23503 = FK restrict: zwischen Zaehlen und Loeschen kam eine Datei dazu.
  if (error) return { ok: false, error: (error as { code?: string }).code === "23503" ? "voice_in_use" : "db" };
  await logOps("admin_action", { message: "Stimme gelöscht", group: "voices", detail: { key: v.key } });
  return { ok: true };
}

/**
 * Ein fester Satz mit dieser Stimme, als Base64 zurueck. Nichts wird gespeichert; es
 * kostet rund 50 Zeichen und beantwortet die Frage, ob die ID die richtige Stimme ist,
 * BEVOR eine Runde mit ihr vertont wird.
 *
 * Base64 statt data-URL: Die CSP erlaubt als Medienquelle `blob:` und Supabase, kein
 * `data:` (next.config.ts, media-src). Der Browser baut aus den Bytes eine Blob-URL; am
 * 15.09.2026 zeigte der Player mit einer data-URL nur "Fehler".
 */
export async function previewVoice(id: string): Promise<{ ok: boolean; audioBase64?: string; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const v = await getVoiceById(id);
  if (!v) return { ok: false, error: "not_found" };
  const elevenId = elevenIdForVoice(v);
  if (!elevenId) return { ok: false, error: "voice_not_synthesizable" };
  const who = v.personName ?? v.name;
  const r = await elevenSpeak({
    text: `Servus, ich bin ${who}. Schön, dass du da bist.`,
    elevenVoiceId: elevenId,
    settings: v.settings,
  });
  if (!r.ok) {
    await logOps("tts_failed", { message: r.error, group: "tts", detail: { status: r.status ?? null, voiceKey: v.key, kind: "probe" } });
    return { ok: false, error: r.error };
  }
  return { ok: true, audioBase64: Buffer.from(r.bytes).toString("base64") };
}

/**
 * Die Empfehlung von ElevenLabs fuer eine Stimme holen, damit sie hier klingt wie im
 * ElevenLabs-Studio. Braucht voices_read am Schluessel; sonst `unverified`.
 */
export async function recommendedVoiceSettings(
  elevenVoiceId: string,
): Promise<{ ok: boolean; settings?: VoiceSettings; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const id = (elevenVoiceId ?? "").trim();
  if (!ELEVEN_VOICE_ID_RE.test(id)) return { ok: false, error: "bad_voice_id" };
  const r = await fetchElevenVoiceSettings(id);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, settings: r.settings };
}
