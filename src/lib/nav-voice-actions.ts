"use server";

import { requireAdmin } from "./admin-guard";
import { logOps } from "./ops";
import { createServiceClient } from "./supabase/service";
import { getVoiceById } from "./tts-voices";
import { ensureNavPromptFile, planNavPrompts } from "./nav-voice-files";
import { isNavLang, isNavPromptKey, navVoiceGate, type NavPlan } from "./nav-voice-rules";

// Server-Actions der Navigations-Ansagen. Jede Funktion hier ist ein eigener POST-Endpunkt,
// deshalb: NUR async Actions exportieren (keine Typen, keine Konstanten), und jede beginnt
// mit requireAdmin(). Die Typen kommen aus nav-voice-rules.ts.

const BUCKET = "tour-audio";

export async function navVoicePlan(
  voiceId: string,
): Promise<{ ok: boolean; plan?: NavPlan; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const voice = await getVoiceById(String(voiceId ?? ""));
  if (!voice) return { ok: false, error: "not_found" };
  return { ok: true, plan: await planNavPrompts(voice.id) };
}

/** Eine Datei je Aufruf (bleibt unter der Vercel-Zeitgrenze), die Schleife macht der Browser. */
export async function voiceNavPrompt(input: {
  voiceId: string;
  key: string;
  lang: string;
  force?: boolean;
}): Promise<{ ok: boolean; skipped?: boolean; chars?: number; previewUrl?: string; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input || typeof input !== "object") return { ok: false, error: "invalid" };
  if (!isNavPromptKey(input.key) || !isNavLang(input.lang)) return { ok: false, error: "invalid" };
  const voice = await getVoiceById(String(input.voiceId ?? ""));
  if (!voice) return { ok: false, error: "not_found" };

  const r = await ensureNavPromptFile({ key: input.key, lang: input.lang, voice, force: input.force === true });
  if (!r.ok) {
    // Nie der Text im Log, nur Art, Sprache und Zeichenzahl.
    await logOps("tts_failed", {
      message: r.error,
      group: "tts",
      detail: { status: r.status ?? null, voiceKey: voice.key, lang: input.lang, kind: "nav" },
    });
    return { ok: false, error: r.error };
  }
  const { data } = await createServiceClient().storage.from(BUCKET).createSignedUrl(r.path, 30 * 60);
  return { ok: true, skipped: r.skipped, chars: r.chars, previewUrl: data?.signedUrl };
}

/** Diese Stimme spricht ab jetzt die Ansagen. Prüft das Gate auf dem Server noch einmal. */
export async function setNavVoice(voiceId: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const voice = await getVoiceById(String(voiceId ?? ""));
  if (!voice) return { ok: false, error: "not_found" };
  if (!navVoiceGate(await planNavPrompts(voice.id))) return { ok: false, error: "nav_voice_incomplete" };
  // Ein Schritt in der Datenbank (set_nav_voice, Migration 0077): löschen und setzen in
  // einer Transaktion, nie ein Fenster ohne Stimme.
  const { error } = await gate.supabase.rpc("set_nav_voice", { p_voice: voice.id });
  if (error) return { ok: false, error: "db" };
  await logOps("admin_action", { message: "Ansage-Stimme gesetzt", group: "voices", detail: { key: voice.key } });
  return { ok: true };
}

/** Ansagen wieder auf die System-Stimme des Handys stellen. */
export async function clearNavVoice(): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { error } = await gate.supabase.from("tts_voices").update({ is_nav: false }).eq("is_nav", true);
  if (error) return { ok: false, error: "db" };
  await logOps("admin_action", { message: "Ansage-Stimme entfernt", group: "voices" });
  return { ok: true };
}
