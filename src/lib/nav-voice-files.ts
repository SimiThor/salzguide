import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase/service";
import { synthesizeVoice } from "./tts";
import { elevenIdForVoice } from "./tts-voices";
import { durationFromBytes, ttsTextHash, type VoiceRow } from "./tts-rules";
import {
  NAV_PROMPT_KEYS,
  isNavLang,
  isNavPromptKey,
  navPromptPlan,
  navTextOf,
  type NavFileRow,
  type NavPlan,
  type NavPromptKey,
} from "./nav-voice-rules";
import { LOCALE_CODES } from "@/i18n/locales";

// Der Kern der gesprochenen Navigations-Ansagen (Migration 0077). Gleiches Muster wie
// ensureVoiceFile in tts-files.ts: vertont nur, was fehlt oder veraltet ist, zweiter Blick
// nach dem Aufruf gegen Doppelklick, ersetzte Dateien werden NIE synchron gelöscht (der
// Waisen-Sweep räumt nach 48 Stunden, und nur, was keine Zeile mehr referenziert).
//
// Gesprochen wird der Text aus messages/<lang>.json, NUR aus der Sprachdatei selbst, ohne den
// Deutsch-Merge von i18n/request.ts: Fehlt der Text, ist das ein Fehler (missing_text), damit
// nie ein koreanischer Clip aus deutschem Text entsteht. Es gibt keinen Sprechfassungs-Schritt,
// die Sätze enthalten keine Ziffern.

const BUCKET = "tour-audio";
const TABLE = "nav_prompt_files";

type Row = {
  prompt_key: string;
  lang: string;
  voice_id: string;
  audio_path: string;
  text_hash: string;
  duration_ms: number | null;
};

const toFile = (r: Row): NavFileRow => ({
  promptKey: r.prompt_key,
  lang: r.lang,
  voiceId: r.voice_id,
  audioPath: r.audio_path,
  textHash: r.text_hash,
  durationMs: r.duration_ms,
});

const COLS = "prompt_key, lang, voice_id, audio_path, text_hash, duration_ms";

/** Rohe Texte aller Sprachen: texts[lang][key], null = fehlt in der Sprachdatei. */
export async function loadNavTexts(
  langs: readonly string[] = LOCALE_CODES,
): Promise<Record<string, Record<string, string | null>>> {
  const out: Record<string, Record<string, string | null>> = {};
  for (const lang of langs) {
    const messages = (await import(`../../messages/${lang}.json`)).default as unknown;
    out[lang] = Object.fromEntries(NAV_PROMPT_KEYS.map((k) => [k, navTextOf(messages, k)]));
  }
  return out;
}

export async function readNavFiles(db: SupabaseClient, voiceId: string): Promise<NavFileRow[]> {
  const { data, error } = await db.from(TABLE).select(COLS).eq("voice_id", voiceId);
  // Ein Lesefehler ist kein "keine Dateien": Er wirft, die Route antwortet 503.
  if (error) throw new Error("nav_prompt_files read failed");
  return ((data as Row[] | null) ?? []).map(toFile);
}

async function objectExists(db: SupabaseClient, path: string): Promise<boolean> {
  const { error } = await db.storage.from(BUCKET).createSignedUrl(path, 60);
  return !error;
}

/** Welche dieser Pfade liegen wirklich im Bucket? Ein Aufruf für alle. */
export async function existingNavPaths(db: SupabaseClient, paths: string[]): Promise<Set<string>> {
  const exists = new Set<string>();
  if (!paths.length) return exists;
  const { data } = await db.storage.from(BUCKET).createSignedUrls(paths, 60);
  for (const s of data ?? []) if (!s.error && s.path) exists.add(s.path);
  return exists;
}

/** Der Plan einer Stimme über alle Ansagen und Sprachen (Raster im Admin, Aktivier-Gate). */
export async function planNavPrompts(voiceId: string, db: SupabaseClient = createServiceClient()): Promise<NavPlan> {
  const [texts, files] = await Promise.all([loadNavTexts(), readNavFiles(db, voiceId)]);
  const exists = await existingNavPaths(db, files.map((f) => f.audioPath));
  return navPromptPlan({ langs: LOCALE_CODES, texts, files, exists });
}

export type EnsureNavResult =
  | { ok: true; path: string; skipped: boolean; chars: number }
  | { ok: false; error: string; status?: number };

export async function ensureNavPromptFile(input: {
  key: NavPromptKey;
  lang: string;
  voice: VoiceRow;
  force?: boolean;
  db?: SupabaseClient;
}): Promise<EnsureNavResult> {
  if (!isNavPromptKey(input.key) || !isNavLang(input.lang)) return { ok: false, error: "invalid" };
  const db = input.db ?? createServiceClient();
  const elevenId = elevenIdForVoice(input.voice);
  if (!elevenId) return { ok: false, error: "voice_not_synthesizable" };

  const messages = (await import(`../../messages/${input.lang}.json`)).default as unknown;
  const text = navTextOf(messages, input.key);
  if (!text) return { ok: false, error: "missing_text" };
  const hash = ttsTextHash(text);

  const look = async () => {
    const { data } = await db
      .from(TABLE)
      .select("audio_path, text_hash")
      .eq("prompt_key", input.key)
      .eq("lang", input.lang)
      .eq("voice_id", input.voice.id)
      .maybeSingle();
    const row = data as { audio_path: string; text_hash: string } | null;
    const exists = row ? await objectExists(db, row.audio_path) : false;
    return { path: row?.audio_path ?? null, current: Boolean(row && exists && row.text_hash === hash) };
  };

  const before = await look();
  if (!input.force && before.path && before.current)
    return { ok: true, path: before.path, skipped: true, chars: 0 };

  const r = await synthesizeVoice({
    text,
    lang: input.lang,
    elevenVoiceId: elevenId,
    voiceKey: input.voice.key,
    settings: input.voice.settings,
    part: "nav",
  });
  if (!r.ok) return r;

  // Zweiter Blick: Hat ein paralleler Lauf (Doppelklick, zwei Tabs) inzwischen geliefert,
  // die eigene Datei wieder wegräumen und seine nehmen.
  if (!input.force) {
    const after = await look();
    if (after.path && after.path !== before.path && after.current) {
      await db.storage.from(BUCKET).remove([r.path]);
      return { ok: true, path: after.path, skipped: true, chars: 0 };
    }
  }

  const { error } = await db.from(TABLE).upsert(
    {
      prompt_key: input.key,
      lang: input.lang,
      voice_id: input.voice.id,
      audio_path: r.path,
      text_hash: hash,
      duration_ms: durationFromBytes(r.bytes) * 1000,
      tts_profile: r.profile,
    },
    { onConflict: "prompt_key,lang,voice_id" },
  );
  if (error) return { ok: false, error: "db" };
  return { ok: true, path: r.path, skipped: false, chars: text.length };
}
