import { appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppNavVoice } from "@/lib/app-api-types";
import { loadNavTexts, readNavFiles } from "@/lib/nav-voice-files";
import { NAV_PROMPT_KEYS, navVoiceVersion } from "@/lib/nav-voice-rules";
import { createServiceClient } from "@/lib/supabase/service";
import { ttsTextHash } from "@/lib/tts-rules";
import { getNavVoiceId, getVoiceById, voiceInfoOf } from "@/lib/tts-voices";

export const runtime = "nodejs";

const BUCKET = "tour-audio";
const LINK_SECONDS = 60 * 60;

// Gesprochene Navigations-Ansagen der Wanderführung (Migration 0077). Anmeldung nicht nötig:
// Die Sätze sind kein Pro-Inhalt. Trotzdem liegen die Dateien im privaten Bucket und gehen nur
// über signierte Links raus, denn eine geklonte Stimme ist das Abbild einer echten Person.
// Kein Cache (no-store), weil die Links ablaufen.
export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const none: AppNavVoice = { lang: ctx.lang, version: "none", voice: null, prompts: [] };
    const voiceId = await getNavVoiceId();
    const voice = voiceId ? await getVoiceById(voiceId) : null;
    if (!voice) return appJson(none, "no-store");

    const db = createServiceClient();
    const [texts, files] = await Promise.all([loadNavTexts([ctx.lang]), readNavFiles(db, voice.id)]);
    const current = files.filter((f) => {
      if (f.lang !== ctx.lang) return false;
      const text = texts[ctx.lang]?.[f.promptKey];
      return (NAV_PROMPT_KEYS as readonly string[]).includes(f.promptKey) && Boolean(text) && f.textHash === ttsTextHash(text!);
    });
    if (!current.length) return appJson({ ...none, voice: voiceInfoOf(voice) }, "no-store");

    const { data } = await db.storage.from(BUCKET).createSignedUrls(
      current.map((f) => f.audioPath),
      LINK_SECONDS,
    );
    const urlOf = new Map<string, string>();
    for (const s of data ?? []) if (!s.error && s.path && s.signedUrl) urlOf.set(s.path, s.signedUrl);
    const ready = current.filter((f) => urlOf.has(f.audioPath));

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
