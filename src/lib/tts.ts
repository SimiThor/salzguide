import { createServiceClient } from "./supabase/service";
import { IMMUTABLE_CACHE_SECONDS } from "./storage";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Sprechtext -> MP3. Die EINE Stelle, die ElevenLabs anspricht.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Herausgezogen aus tour-pool-actions.ts, weil die Runden nicht mehr nur im Admin entstehen:
// Eine Radrunde hat sieben Punkte, und jeder braucht in dreizehn Sprachen ZWEI Dateien, die
// volle Geschichte und die Kostprobe. Das sind 182 Dateien. Der Weg über den Admin, Punkt
// fuer Punkt und Knopf fuer Knopf, ist dafuer kein Weg mehr.
//
// Die Datei landet im PRIVATEN tour-audio-Bucket, und zurueck kommt nur der Objekt-PFAD.
// Ausgeliefert wird weiterhin ausschliesslich ueber kurzlebige Signed-URLs an Hoerer, die
// sie bekommen duerfen (lib/tour-audio-gate.ts entscheidet, welche der beiden Dateien).
//
// RECHTLICH: Die Stimme ist synthetisch und faellt unter Art. 50 EU AI Act. Die Offenlegung
// steht in docs/39 und erscheint sichtbar im Player (Tours.aiVoice). Wer hier eine neue
// Aufrufstelle baut, prueft das mit.

const ELEVEN_MODEL = "eleven_multilingual_v2"; // EINE Stimme spricht ALLE Sprachen

function elevenVoiceId(lang: string): string {
  // Optional pro Sprache überschreibbar via ELEVENLABS_VOICE_ID_<LANG> (z. B. _EN, _FR).
  const base = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  // `trim()` erst NACH der Prüfung: Eine Variable, die nur aus Leerzeichen besteht, ergäbe
  // sonst eine leere Stimmen-ID und damit eine kaputte Adresse. So faellt sie auf die Basis
  // zurueck, wie in der urspruenglichen Fassung.
  const perLang = process.env[`ELEVENLABS_VOICE_ID_${lang.toUpperCase()}`]?.trim();
  return perLang || base;
}

/**
 * Zahl aus einer Umgebungsvariable, mit Grenzen und Standardwert.
 *
 * DER LEERE STRING IST DER GANZE PUNKT. `Number("")` ist 0, nicht NaN, und
 * `Number.isFinite(0)` ist wahr. Eine Variable, die in .env.local zwar dasteht, aber ohne
 * Wert (`ELEVENLABS_SPEED=`), kam damit als 0 an, und der Standardwert griff nie.
 *
 * Gehört hat man das sofort: stability 0 statt 0,55 laesst die Stimme driften und stocken,
 * similarity 0 statt 0,75 heisst, sie haelt sich gar nicht an die geklonte Stimme, und
 * speed wurde auf die Untergrenze 0,7 geklemmt statt auf 0,9. Zu langsam, fremder Akzent,
 * mitten im Satz die Sprache gewechselt. Eine leere Variable ist NICHT GESETZT.
 */
function clampNum(v: string | undefined, fallback: number, lo: number, hi: number): number {
  const roh = v?.trim();
  if (!roh) return fallback;
  const n = Number(roh);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
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

export type VoiceResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; error: string };

/**
 * Text vertonen und im privaten Bucket ablegen. Gibt den OBJEKT-PFAD zurueck, nie eine URL.
 *
 * `kind` landet im Dateinamen und trennt die volle Geschichte von der Kostprobe. Das ist
 * kein Schoenheitsdetail: Beide liegen im selben Bucket, und wer sie am Namen nicht
 * auseinanderhaelt, signiert irgendwann die falsche.
 */
export async function synthesizeVoice(input: {
  text: string;
  lang: string;
  kind?: "voll" | "kostprobe";
}): Promise<VoiceResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Kein Text zum Vertonen." };
  if (text.length > 5000) return { ok: false, error: "Text zu lang (max. 5000 Zeichen)." };
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, error: "ELEVENLABS_API_KEY fehlt, bitte in .env.local eintragen" };
  const lang = (input.lang || "de").toLowerCase();

  try {
    // 96 kbps statt 128: für gesprochene Stimme nicht unterscheidbar, ein Viertel weniger
    // Storage und Datenverkehr pro Guide-Punkt. Der Bestand wurde am 10.08.2026 auf
    // 80 kbps mono umkodiert; neue Dateien kommen mit diesem Format schon sparsam an.
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${elevenVoiceId(lang)}?output_format=mp3_44100_96`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: elevenVoiceSettings() }),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `ElevenLabs ${res.status}: ${t.slice(0, 160)}` };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return { ok: false, error: "Leere Audio-Antwort von ElevenLabs." };

    const teil = input.kind === "kostprobe" ? "kostprobe" : "point";
    const path = `${teil}-${lang}-${crypto.randomUUID()}.mp3`;
    const { error } = await createServiceClient()
      .storage.from("tour-audio")
      .upload(path, bytes, {
        contentType: "audio/mpeg",
        upsert: false,
        cacheControl: IMMUTABLE_CACHE_SECONDS,
      });
    if (error) return { ok: false, error: "Upload der Stimme fehlgeschlagen." };
    return { ok: true, path, bytes: bytes.length };
  } catch {
    return { ok: false, error: "TTS gerade nicht erreichbar, bitte nochmal versuchen." };
  }
}
