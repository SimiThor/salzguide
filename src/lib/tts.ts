import { createServiceClient } from "./supabase/service";
import { IMMUTABLE_CACHE_SECONDS } from "./storage";
import { ELEVEN_DEFAULT_SETTINGS, cleanVoiceSettings, type AudioKind, type VoiceSettings } from "./tts-rules";
import { LOUDNESS_TARGET_LUFS, normalizeSpeechMp3 } from "./loudness";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Sprechtext -> MP3. Die EINE Stelle, die ElevenLabs anspricht.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Herausgezogen aus tour-pool-actions.ts, weil die Runden nicht mehr nur im Admin entstehen:
// Eine Radrunde hat sieben Punkte, und jeder braucht in dreizehn Sprachen ZWEI Dateien, die
// volle Geschichte und die Kostprobe. Das sind 182 Dateien je Stimme.
//
// WELCHE STIMME SPRICHT, entscheidet nicht mehr diese Datei. Bis 09/2026 stand die Stimme in
// der ENV (ELEVENLABS_VOICE_ID, mit hart kodiertem Fallback auf eine ElevenLabs-Vorlage und
// einem Sprach-Override je Locale). Seit Migration 0068 stehen die Stimmen in tts_voices,
// jede Runde trägt eine, und der Aufrufer reicht die ElevenLabs-ID herein (lib/tts-voices.ts
// löst sie auf, lib/tts-files.ts entscheidet, ob überhaupt vertont werden muss). Ein
// Fallback gibt es hier absichtlich nicht: Eine still falsche Stimme ist genau der Fehler,
// gegen den das gebaut ist.
//
// Die Datei landet im PRIVATEN tour-audio-Bucket, und zurueck kommt nur der Objekt-PFAD.
// Ausgeliefert wird weiterhin ausschliesslich ueber kurzlebige Signed-URLs an Hoerer, die
// sie bekommen duerfen (lib/tour-audio-gate.ts entscheidet, welche der beiden Dateien).
//
// RECHTLICH: Synthetische und geklonte Stimmen fallen unter Art. 50 EU AI Act. Die
// Offenlegung steht in docs/39 und erscheint sichtbar im Player (VoiceDisclosure.tsx, aus
// der Stimm-Art). Wer hier eine neue Aufrufstelle baut, prueft das mit.
//
// KEIN ops-Import in dieser Datei: scripts/seed-runde-a.ts laedt sie direkt, und lib/ops.ts
// zieht die halbe Server-Welt nach. Gemeldet wird in der Action-Schicht (tts-actions.ts).

const ELEVEN_API = "https://api.elevenlabs.io/v1";
const ELEVEN_MODEL = "eleven_multilingual_v2"; // EINE Stimme spricht ALLE Sprachen, auch Klone
// 96 kbps statt 128: für gesprochene Stimme nicht unterscheidbar, ein Viertel weniger
// Storage und Datenverkehr pro Guide-Punkt. Der Bestand wurde am 10.08.2026 auf 80 kbps
// mono umkodiert; neue Dateien kommen mit diesem Format schon sparsam an. Konstante
// Bitrate, deshalb kann tts-rules.ts die Dauer aus der Dateigroesse rechnen.
const OUTPUT_FORMAT = "mp3_44100_96";
const MAX_CHARS = 5000;
const BUCKET = "tour-audio";

/**
 * Objekt-Pfad einer Sprachdatei: Art, Sprache und Stimme im Namen, dann eine UUID. Das ist
 * kein Schoenheitsdetail: Volldatei und Kostprobe liegen im selben Bucket, und wer sie am
 * Namen nicht auseinanderhaelt, signiert irgendwann die falsche. Und wer den Bucket von Hand
 * durchsieht, soll erkennen, welche Stimme in einer Datei spricht, statt vor lauter UUIDs
 * zu stehen. `tag` nennt eine andere Herkunft als ElevenLabs ("upload": angeglichene
 * Hand-Uploads, lib/tts-files.ts). Muss guardAudioPath (lib/audio-path.ts) passieren.
 */
export function speechObjectPath(input: { kind?: AudioKind; lang: string; voiceKey: string; tag?: string }): string {
  const lang = (input.lang || "de").toLowerCase();
  const teil = input.kind === "kostprobe" ? "kostprobe" : "point";
  const key = input.voiceKey.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || "voice";
  return `${[teil, lang, key, input.tag, crypto.randomUUID()].filter(Boolean).join("-")}.mp3`;
}

/** Fertige MP3-Bytes unter diesem Pfad in den privaten Bucket legen (nie ueberschreiben). */
export async function storeSpeech(path: string, bytes: Uint8Array): Promise<boolean> {
  const { error } = await createServiceClient()
    .storage.from(BUCKET)
    .upload(path, bytes, { contentType: "audio/mpeg", upsert: false, cacheControl: IMMUTABLE_CACHE_SECONDS });
  return !error;
}

/**
 * Die Sprech-Einstellungen kommen JE STIMME aus tts_voices (Migration 0069), nicht mehr aus
 * der ENV. Bis 15.09.2026 galt fuer alle Stimmen Tempo 0,9 und Stabilitaet 0,55 (einst fuer
 * Tonis Erzaehlton gewaehlt), und Simons Klon klang damit weniger nach Simon als in
 * ElevenLabs direkt, wo jede Stimme ihre eigene Empfehlung hat. Der leere-String-Fehler
 * der alten ENV-Werte (`Number("")` ist 0) ist damit Geschichte; cleanVoiceSettings zwingt.
 */
function elevenVoiceSettings(s: VoiceSettings) {
  const c = cleanVoiceSettings(s);
  return {
    stability: c.stability,
    similarity_boost: c.similarity,
    style: c.style,
    use_speaker_boost: c.speakerBoost,
    speed: c.speed,
  };
}

/**
 * Modell und Settings als eine Zeile. Steht informativ an jeder Datei (tts_profile), damit
 * man spaeter weiss, womit sie entstand. BEWUSST keine Veraltet-Regel: siehe tts-rules.ts.
 */
export function ttsProfile(settings: VoiceSettings = ELEVEN_DEFAULT_SETTINGS): string {
  const s = elevenVoiceSettings(settings);
  return [ELEVEN_MODEL, s.stability, s.similarity_boost, s.style, s.use_speaker_boost ? 1 : 0, s.speed].join("|");
}

/**
 * ElevenLabs antwortet mit JSON (`detail.code` / `detail.message`). Die haeufigen Faelle
 * bekommen einen deutschen Satz, der sagt, was zu tun ist; der Rest zeigt die Meldung
 * statt des rohen JSON-Anfangs, der am 15.09.2026 im Admin stand.
 */
function elevenErrorText(status: number, body: string): string {
  let code = "";
  let message = "";
  try {
    const d = (JSON.parse(body) as { detail?: unknown }).detail;
    if (d && typeof d === "object") {
      code = String((d as { code?: unknown }).code ?? "");
      message = String((d as { message?: unknown }).message ?? "");
    } else if (typeof d === "string") message = d;
  } catch {
    // kein JSON, unten steht der Rohtext
  }
  if (code === "subscription_required")
    return "ElevenLabs: Diese Stimme ist ein Professional Voice Clone und braucht mindestens den Creator-Tarif unseres Kontos.";
  if (code === "quota_exceeded")
    return "ElevenLabs: Das Zeichen-Kontingent des Kontos ist aufgebraucht.";
  if (code === "voice_not_found") return "bad_voice_id";
  if (status === 401) return "ElevenLabs: Der API-Schlüssel wurde abgelehnt (ELEVENLABS_API_KEY und seine Berechtigungen prüfen).";
  return `ElevenLabs ${status}: ${(message || body).slice(0, 160)}`;
}

export type Loudness = { inputLufs: number; outputLufs: number; gainDb: number; normalized: boolean };

export type SpeakResult =
  | { ok: true; bytes: Uint8Array; loudness: Loudness }
  | { ok: false; error: string; status?: number };

/**
 * Nur der Aufruf: Text und Stimme rein, MP3-Bytes raus. Nichts wird gespeichert.
 *
 * Die Bytes kommen LAUTHEITSGLEICH zurueck (lib/loudness.ts, -16 LUFS wie bei Apple):
 * Jede Stimme, jede Sprache, jede Kostprobe gleich laut, und der Player muss nichts
 * wissen. Innerhalb der Toleranz bleibt die ElevenLabs-Datei bytegleich.
 */
export async function elevenSpeak(input: {
  text: string;
  elevenVoiceId: string;
  settings: VoiceSettings;
}): Promise<SpeakResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Kein Text zum Vertonen." };
  if (text.length > MAX_CHARS) return { ok: false, error: `Text zu lang (max. ${MAX_CHARS} Zeichen).` };
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, error: "ELEVENLABS_API_KEY fehlt, bitte in .env.local eintragen" };
  const voiceId = input.elevenVoiceId.trim();
  if (!voiceId) return { ok: false, error: "voice_not_synthesizable" };

  try {
    const res = await fetch(
      `${ELEVEN_API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: elevenVoiceSettings(input.settings) }),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!res.ok) {
      return { ok: false, error: elevenErrorText(res.status, await res.text()), status: res.status };
    }
    const raw = new Uint8Array(await res.arrayBuffer());
    if (!raw.length) return { ok: false, error: "Leere Audio-Antwort von ElevenLabs." };
    const n = await normalizeSpeechMp3(raw);
    return {
      ok: true,
      bytes: n.bytes,
      loudness: { inputLufs: n.inputLufs, outputLufs: n.outputLufs, gainDb: n.gainDb, normalized: n.changed },
    };
  } catch {
    return { ok: false, error: "TTS gerade nicht erreichbar, bitte nochmal versuchen." };
  }
}

export type VoiceResult =
  | { ok: true; path: string; bytes: number; profile: string; loudness: Loudness }
  | { ok: false; error: string; status?: number };

/**
 * Text vertonen und im privaten Bucket ablegen. Gibt den OBJEKT-PFAD zurueck, nie eine URL.
 * `kind` und `voiceKey` landen im Dateinamen (speechObjectPath).
 */
export async function synthesizeVoice(input: {
  text: string;
  lang: string;
  kind?: AudioKind;
  elevenVoiceId: string;
  voiceKey: string;
  settings: VoiceSettings;
}): Promise<VoiceResult> {
  const spoken = await elevenSpeak({ text: input.text, elevenVoiceId: input.elevenVoiceId, settings: input.settings });
  if (!spoken.ok) return spoken;
  const path = speechObjectPath({ kind: input.kind, lang: input.lang, voiceKey: input.voiceKey });
  if (!(await storeSpeech(path, spoken.bytes))) return { ok: false, error: "Upload der Stimme fehlgeschlagen." };
  return {
    ok: true,
    path,
    bytes: spoken.bytes.length,
    // Das Lautheits-Ziel steht mit im Profil: So sieht man einer Zeile an, ob sie schon
    // durch die Angleichung gegangen ist (Bestands-Skript, scripts/tts-normalize-stock.ts).
    profile: `${ttsProfile(input.settings)}|${input.elevenVoiceId.trim()}|lufs${LOUDNESS_TARGET_LUFS}`,
    loudness: spoken.loudness,
  };
}

/**
 * Die Empfehlung von ElevenLabs fuer eine Stimme (was das Web-Studio nimmt). Braucht die
 * Schluessel-Berechtigung voices_read; fehlt sie, kommt `unverified` und das Formular sagt es.
 */
export async function fetchElevenVoiceSettings(
  id: string,
): Promise<{ ok: true; settings: VoiceSettings } | { ok: false; error: string; status?: number }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, error: "ELEVENLABS_API_KEY fehlt, bitte in .env.local eintragen" };
  try {
    const res = await fetch(`${ELEVEN_API}/voices/${encodeURIComponent(id.trim())}/settings`, {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "unverified", status: res.status };
    if (res.status === 404) return { ok: false, error: "bad_voice_id", status: res.status };
    if (!res.ok) return { ok: false, error: elevenErrorText(res.status, await res.text()), status: res.status };
    const j = (await res.json()) as {
      stability?: number;
      similarity_boost?: number;
      style?: number;
      use_speaker_boost?: boolean;
      speed?: number;
    };
    return {
      ok: true,
      settings: cleanVoiceSettings({
        stability: j.stability,
        similarity: j.similarity_boost,
        style: j.style,
        speed: j.speed,
        speakerBoost: j.use_speaker_boost,
      }),
    };
  } catch {
    return { ok: false, error: "ElevenLabs gerade nicht erreichbar, bitte nochmal versuchen." };
  }
}

/**
 * Gibt es diese Stimme in unserem ElevenLabs-Konto? Kostet keine Zeichen. Wird beim
 * Speichern einer Stimme im Admin geprueft, damit ein Tippfehler in der ID nicht erst beim
 * 98-Dateien-Lauf auffaellt.
 *
 * `unverified`: Der Schluessel darf Stimmen nicht LESEN (ElevenLabs-Berechtigung
 * `voices_read`; unser Schluessel hat nur die Vertonung). Dann steht hier keine Antwort,
 * und das Speichern darf daran nicht scheitern: Die Formatpruefung bleibt, und Probehoeren
 * prueft die ID ueber die Vertonung selbst. Am 15.09.2026 stand sonst "ElevenLabs 401" im
 * Admin, obwohl der Schluessel fuer alles Noetige taugt.
 */
export async function validateElevenVoice(
  id: string,
): Promise<
  { ok: true; name: string } | { ok: false; error: "bad_voice_id" | "unverified" | string; status?: number }
> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, error: "ELEVENLABS_API_KEY fehlt, bitte in .env.local eintragen" };
  try {
    const res = await fetch(`${ELEVEN_API}/voices/${encodeURIComponent(id.trim())}`, {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404 || res.status === 400 || res.status === 422)
      return { ok: false, error: "bad_voice_id", status: res.status };
    if (res.status === 401 || res.status === 403) return { ok: false, error: "unverified", status: res.status };
    if (!res.ok) return { ok: false, error: elevenErrorText(res.status, await res.text()), status: res.status };
    const j = (await res.json()) as { name?: string };
    return { ok: true, name: j.name ?? "" };
  } catch {
    return { ok: false, error: "ElevenLabs gerade nicht erreichbar, bitte nochmal versuchen." };
  }
}
