"use server";

import { requireAdmin } from "./admin-guard";
import { createServiceClient } from "./supabase/service";
import { logOps } from "./ops";
import { stripEmDash } from "./em-dash";
import { guardAudioPath } from "./audio-path";
import { getVoiceById } from "./tts-voices";
import { ensureVoiceFile, normalizeUploadedFile, planVoiceFiles, type VoicePlan } from "./tts-files";
import type { AudioKind } from "./tts-rules";
import { routing } from "@/i18n/routing";

// Server-Actions rund um die Audio-DATEIEN eines Punkts (tour_point_voice_files, 0068).
// Sie schreiben SOFORT, nicht erst mit "Speichern" des Punkt-Formulars: Eine Vertonung
// kostet Geld, und bis 09/2026 war eine vertonte, aber nicht gespeicherte Datei eine
// bezahlte Waise. Ausserdem kann so kein veralteter Formular-Zustand eine frisch an der
// Runde erzeugte Datei ueberschreiben.
//
// Muster wie ueberall: requireAdmin() als erste Zeile, Textzeilen ueber den Session-Client
// (RLS prueft die Admin-Rolle ein zweites Mal), Storage und Dateizeilen ueber den Kern in
// lib/tts-files.ts (Service-Client, weil er auch fuers Seed-Skript laeuft).

const LOCALES = routing.locales as readonly string[];
const isLang = (l: string): boolean => LOCALES.includes(l);
const isKind = (k: string): k is AudioKind => k === "voll" || k === "kostprobe";

export type VoiceFileResult = {
  ok: boolean;
  path?: string;
  previewUrl?: string | null;
  audioHash?: string | null;
  skipped?: boolean;
  error?: string;
};

/**
 * Eine Datei fuer (Punkt, Sprache, Stimme, Art) sicherstellen. Mit `text` wird der Sprechtext
 * vorher gespeichert, damit Text und Aufnahme nie auseinanderlaufen; ohne `text` gilt der
 * gespeicherte (so ruft "Vertonen" an der Runde). `force` erzwingt eine neue Aufnahme.
 */
export async function voicePointFile(input: {
  pointId: string;
  lang: string;
  kind: AudioKind;
  voiceId: string;
  text?: string;
  force?: boolean;
}): Promise<VoiceFileResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.pointId) return { ok: false, error: "save_first" };
  if (!isLang(input.lang) || !isKind(input.kind)) return { ok: false, error: "bad_input" };
  const voice = await getVoiceById(input.voiceId);
  if (!voice) return { ok: false, error: "not_found" };
  const textCol = input.kind === "kostprobe" ? "teaser_text" : "audio_text";

  let text: string;
  if (typeof input.text === "string") {
    text = stripEmDash(input.text, input.lang).trim();
    if (!text) return { ok: false, error: "required" };
    const { error } = await gate.supabase
      .from("tour_point_audio")
      .upsert({ point_id: input.pointId, lang: input.lang, [textCol]: text }, { onConflict: "point_id,lang" });
    if (error) return { ok: false, error: "db" };
  } else {
    const { data } = await gate.supabase
      .from("tour_point_audio")
      .select(textCol)
      .eq("point_id", input.pointId)
      .eq("lang", input.lang)
      .maybeSingle();
    text = ((data as Record<string, string | null> | null)?.[textCol] ?? "").trim();
    if (!text) return { ok: false, error: "required" };
  }

  const r = await ensureVoiceFile({
    pointId: input.pointId,
    lang: input.lang,
    kind: input.kind,
    voice,
    text,
    force: input.force === true,
  });
  if (!r.ok) {
    // Nie den Text ins Log: Der Sprechtext ist Pro-Ware. Status, Sprache, Stimme, Laenge reichen.
    await logOps("tts_failed", {
      message: r.error,
      group: "tts",
      detail: { status: r.status ?? null, lang: input.lang, voiceKey: voice.key, chars: text.length, kind: input.kind },
    });
    return { ok: false, error: r.error };
  }
  // Vertont, aber mit Ziffern: Die Sprechfassung kam zweimal nicht durch den Waechter
  // (lib/spoken-rules.ts). Kein Fehler fuer den Admin, aber eine Zeile im Logbuch.
  if (r.spokenFailed) {
    await logOps("tts_spoken_failed", {
      message: `Sprechfassung abgelehnt: ${r.spokenFailed}`,
      group: "tts",
      detail: { lang: input.lang, kind: input.kind, voiceKey: voice.key, chars: text.length },
    });
  }
  // Kurzlebige Signed-URL zum sofortigen Probehoeren im Admin (privater Bucket).
  const { data: signed } = await createServiceClient()
    .storage.from("tour-audio")
    .createSignedUrl(r.path, 60 * 30);
  return { ok: true, path: r.path, previewUrl: signed?.signedUrl ?? null, audioHash: r.hash, skipped: r.skipped };
}

/** Eine selbst hochgeladene MP3 (Browser -> Bucket) an (Punkt, Sprache, Stimme) haengen. */
export async function attachManualFile(input: {
  pointId: string;
  lang: string;
  voiceId: string;
  path: string;
}): Promise<VoiceFileResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.pointId) return { ok: false, error: "save_first" };
  if (!isLang(input.lang)) return { ok: false, error: "bad_input" };
  const g = guardAudioPath(input.path);
  if (!g.ok || !g.path) return { ok: false, error: "bad_url" };
  const voice = await getVoiceById(input.voiceId);
  if (!voice) return { ok: false, error: "not_found" };
  // Erst gleich laut wie die KI-Stimmen (und damit: existiert die Datei, ist sie eine MP3,
  // wie lang ist sie), dann erst eine Zeile darauf. Der Pfad kann dabei ein neuer werden.
  const file = await normalizeUploadedFile({ path: g.path, lang: input.lang, voiceKey: voice.key });
  if (!file.ok) return { ok: false, error: file.error };
  // Die Datei-Zeile haengt per FK an der Textzeile; ohne Text gibt es sie trotzdem (leer).
  const { error: eText } = await gate.supabase
    .from("tour_point_audio")
    .upsert({ point_id: input.pointId, lang: input.lang }, { onConflict: "point_id,lang", ignoreDuplicates: true });
  if (eText) return { ok: false, error: "db" };
  const { error } = await gate.supabase.from("tour_point_voice_files").upsert(
    {
      point_id: input.pointId,
      lang: input.lang,
      voice_id: voice.id,
      audio_url: file.path,
      audio_hash: null, // manuell: kein Text-Hash, gilt als aktuell (tts-rules.ts)
      tts_profile: file.profile,
    },
    { onConflict: "point_id,lang,voice_id" },
  );
  if (error) return { ok: false, error: "db" };
  await gate.supabase
    .from("tour_point_audio")
    .update({ duration_sec: file.seconds })
    .eq("point_id", input.pointId)
    .eq("lang", input.lang);
  const { data: signed } = await createServiceClient()
    .storage.from("tour-audio")
    .createSignedUrl(file.path, 60 * 30);
  return { ok: true, path: file.path, previewUrl: signed?.signedUrl ?? null, audioHash: null };
}

/** Eine Datei aus der Zuordnung nehmen. Das Objekt bleibt fuer den Waisen-Sweep liegen. */
export async function removeVoiceFile(input: {
  pointId: string;
  lang: string;
  voiceId: string;
  kind: AudioKind;
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isLang(input.lang) || !isKind(input.kind)) return { ok: false, error: "bad_input" };
  const urlCol = input.kind === "kostprobe" ? "teaser_url" : "audio_url";
  const hashCol = input.kind === "kostprobe" ? "teaser_hash" : "audio_hash";
  const base = { point_id: input.pointId, lang: input.lang, voice_id: input.voiceId };
  const { error } = await gate.supabase
    .from("tour_point_voice_files")
    .update({ [urlCol]: null, [hashCol]: null })
    .match(base);
  if (error) return { ok: false, error: "db" };
  // Beide Pfade leer -> Zeile weg, sonst zaehlt sie als "Stimme vorhanden".
  await gate.supabase
    .from("tour_point_voice_files")
    .delete()
    .match(base)
    .is("audio_url", null)
    .is("teaser_url", null);
  return { ok: true };
}

/** Was fuer diese Punkte mit dieser Stimme noch fehlt oder veraltet ist, samt Zeichen. */
export async function revoicePlan(input: {
  pointIds: string[];
  voiceId: string;
}): Promise<{ ok: boolean; plan?: VoicePlan; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const voice = await getVoiceById(input.voiceId);
  if (!voice) return { ok: false, error: "not_found" };
  const pointIds = [...new Set((input.pointIds ?? []).filter((x) => typeof x === "string" && x))].slice(0, 200);
  const plan = await planVoiceFiles({ pointIds, voiceId: voice.id });
  return { ok: true, plan };
}
