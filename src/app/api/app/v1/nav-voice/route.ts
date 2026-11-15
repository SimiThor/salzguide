import { appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppNavVoice } from "@/lib/app-api-types";
import { loadNavTexts, readNavFiles } from "@/lib/nav-voice-files";
import { NAV_PROMPT_KEYS, navVoiceVersion } from "@/lib/nav-voice-rules";
import { createServiceClient } from "@/lib/supabase/service";
import { ttsTextHash } from "@/lib/tts-rules";
import { getNavVoiceState, getVoiceById, voiceInfoOf } from "@/lib/tts-voices";
import { after } from "next/server";
import { logOps } from "@/lib/ops";

export const runtime = "nodejs";

const BUCKET = "tour-audio";
const LINK_SECONDS = 60 * 60;

// Eine Meldung je Sprache und Stunde und Instanz; logOps drosselt zusätzlich über den Katalog
// (Ruhefenster). Die Route ist heiss, deshalb in after() und vorab im Speicher entdoppelt.
const warned = new Map<string, number>();
function warnIncomplete(lang: string, ready: number) {
  const last = warned.get(lang) ?? 0;
  if (Date.now() - last < 60 * 60 * 1000) return;
  warned.set(lang, Date.now());
  after(() =>
    logOps("nav_voice_incomplete", {
      message: `Ansagen unvollständig (${lang}): ${ready} von ${NAV_PROMPT_KEYS.length}`,
      group: "nav-voice",
      path: "/api/app/v1/nav-voice",
    }),
  );
}

// Gesprochene Navigations-Ansagen der Wanderführung (Migration 0077). Anmeldung nicht nötig:
// Die Sätze sind kein Pro-Inhalt. Trotzdem liegen die Dateien im privaten Bucket und gehen nur
// über signierte Links raus, denn eine geklonte Stimme ist das Abbild einer echten Person.
// Kein Cache (no-store), weil die Links ablaufen.
export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const none: AppNavVoice = { lang: ctx.lang, version: "none", voice: null, prompts: [] };
    // Ein Datenbank- oder Storage-Fehler ist KEIN "keine Stimme": Er wirft, die Route
    // antwortet 503, und die App behält ihren gespeicherten Satz.
    const state = await getNavVoiceState();
    if (!state.ok) throw new Error("nav voice lookup failed");
    if (!state.id) return appJson(none, "no-store");
    const voice = await getVoiceById(state.id);
    if (!voice) throw new Error("active nav voice not readable");

    const db = createServiceClient();
    const [texts, files] = await Promise.all([loadNavTexts([ctx.lang]), readNavFiles(db, voice.id)]);
    const current = files.filter((f) => {
      if (f.lang !== ctx.lang) return false;
      const text = texts[ctx.lang]?.[f.promptKey];
      return (NAV_PROMPT_KEYS as readonly string[]).includes(f.promptKey) && Boolean(text) && f.textHash === ttsTextHash(text!);
    });
    if (!current.length) {
      warnIncomplete(ctx.lang, 0);
      return appJson({ ...none, voice: voiceInfoOf(voice) }, "no-store");
    }

    const { data, error } = await db.storage.from(BUCKET).createSignedUrls(
      current.map((f) => f.audioPath),
      LINK_SECONDS,
    );
    if (error || !data) throw new Error("nav clip signing failed");
    const urlOf = new Map<string, string>();
    for (const s of data ?? []) if (!s.error && s.path && s.signedUrl) urlOf.set(s.path, s.signedUrl);
    const ready = current.filter((f) => urlOf.has(f.audioPath));
    if (ready.length < NAV_PROMPT_KEYS.length) warnIncomplete(ctx.lang, ready.length);

    const body: AppNavVoice = {
      lang: ctx.lang,
      version: navVoiceVersion(
        voice.id,
        ctx.lang,
        ready.map((f) => ({ key: f.promptKey, path: f.audioPath })),
      ),
      voice: voiceInfoOf(voice),
      prompts: ready
        .map((f) => ({ key: f.promptKey, hash: f.textHash, url: urlOf.get(f.audioPath)!, durationMs: f.durationMs }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
