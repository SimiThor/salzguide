import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithRetry } from "./ai-fetch";
import { stripEmDash } from "./em-dash";
import { localeMeta } from "@/i18n/locales";
import {
  SPOKEN_PROMPT_VERSION,
  needsSpokenForm,
  spokenSourceHash,
  spokenTextAcceptable,
} from "./spoken-rules";
import type { AudioKind } from "./tts-rules";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Die Sprechfassung eines Textes holen: aus der Zeile, sonst einmal vom Modell.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Warum ein Sprachmodell und keine Zahl-zu-Wort-Bibliothek: Jahreszahlen ("neunzehnhundert-
// fuenfundvierzig", "nineteen forty-five", "mille neuf cent quarante-cinq"), Ordnungszahlen
// in Daten ("fuenfzehnten Mai"), gebeugte Zahlwoerter im Polnischen, Tschechischen und
// Slowakischen ("w dwa tysiace dziewietnastym roku") und die ziffernweise Lesung im
// Koreanischen und Chinesischen sind in 13 Sprachen keine Tabelle, sondern Grammatik. Keine
// Bibliothek kann das fuer alle unsere Sprachen; Slowakisch fehlt ueberall. ElevenLabs
// empfiehlt fuer genau diesen Fall den Weg ueber ein LLM.
//
// Der Waechter in spoken-rules.ts haelt das Modell an der Leine. Was er nicht durchlaesst,
// wird nicht gespeichert, und vertont wird dann der Originaltext wie bisher.
//
// KEIN ops-Import hier (wie in tts.ts): scripts/seed-runde-a.ts laedt lib/tts-files.ts und
// damit diese Datei direkt in Node, und lib/ops.ts zieht die Sprachdateien nach. Der Grund
// einer Ablehnung wandert deshalb im Ergebnis nach oben; die Action-Schicht meldet ihn.

const MODEL = "claude-opus-5";
const TOOL = "spoken_text";

const spokenCols = (kind: AudioKind) =>
  kind === "kostprobe"
    ? { text: "teaser_text", spoken: "teaser_spoken", hash: "teaser_spoken_hash" } as const
    : { text: "audio_text", spoken: "audio_spoken", hash: "audio_spoken_hash" } as const;

function systemPrompt(langName: string): string {
  return `You prepare the narration of an audio-guide stop for text-to-speech. The input is the WRITTEN ${langName} text. Return the SPOKEN form of exactly the same text: identical wording and sentence order, where only the things a reader would say differently are written out as they are spoken in ${langName}:
- numbers and quantities (15.000 -> fifteen thousand in the language's own words; decimals, percentages, currency, units such as km, m, kg, h, Uhr)
- YEARS in the natural spoken form of ${langName}. German: 1945 = neunzehnhundertfünfundvierzig, 2021 = zweitausendeinundzwanzig, 1806 = achtzehnhundertsechs. English: 1945 = nineteen forty-five, 2021 = twenty twenty-one, 2005 = two thousand and five. French: mille neuf cent quarante-cinq. Italian/Spanish/Portuguese/Dutch: the full number as a year is normally said. Polish, Czech, Slovak, Hungarian: use the case and ordinal the sentence requires (Polish "w 2019 roku" -> "w dwa tysiące dziewiętnastym roku"). Korean and Chinese: the usual reading of a year, digit by digit where that is customary, keeping the year word.
- dates and ordinals (German "15. Mai" -> "fünfzehnten Mai", English "3rd" -> "third"), times (10:30), centuries, Roman numerals in names (Ludwig XIV. -> Ludwig der Vierzehnte)
- abbreviations a reader expands aloud (z. B. -> zum Beispiel, Nr. -> Nummer, St. -> Sankt, ca. -> circa, bzw. -> beziehungsweise); keep well-known spoken acronyms as they are.
Strict rules: do not add, remove, reorder, shorten or rephrase any other word. Keep every proper noun and place name exactly. Keep the punctuation of the sentences. No digit may remain in the output. Never use em dashes. Return only the spoken text via the tool "${TOOL}".`;
}

async function askModel(text: string, lang: string, retryHint: string | null): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const langName = localeMeta(lang).english;
  const user =
    `${retryHint ? `Your previous answer was rejected: ${retryHint}. Follow the rules exactly this time.\n\n` : ""}` +
    `Write the spoken ${langName} form of this text and return it via the tool "${TOOL}":\n\n${text}`;
  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          // Ein Umformen, kein Nachdenken: mittlerer Aufwand reicht und haelt die Latenz kurz.
          output_config: { effort: "medium" },
          system: systemPrompt(langName),
          messages: [{ role: "user", content: user }],
          tools: [
            {
              name: TOOL,
              description: `The spoken ${langName} form of the text, numbers written out.`,
              input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
            },
          ],
          tool_choice: { type: "tool", name: TOOL },
        }),
      },
      2,
      90000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === TOOL,
    ) as { input?: { text?: string } } | undefined;
    const out = block?.input?.text?.trim();
    return out ? stripEmDash(out, lang) : null;
  } catch {
    return null;
  }
}

export type SpokenResult = {
  /** Was an ElevenLabs geht: die Sprechfassung, oder der Originaltext, wenn keine entstand. */
  text: string;
  /** Wahr, wenn eine Sprechfassung benutzt wird (gespeichert oder frisch). */
  derived: boolean;
  /** Wahr, wenn dafuer gerade ein Modell-Aufruf noetig war. */
  generated: boolean;
  /** Gesetzt, wenn das Modell zweimal abgelehnt wurde: dann ist `text` der Originaltext. */
  failedReason?: string;
};

/**
 * Sprechfassung fuer (Punkt, Sprache, Art) zum gegebenen geschriebenen Text.
 *
 * Reihenfolge: ohne Ziffern ist der Text seine eigene Sprechfassung (kein Aufruf); passt die
 * gespeicherte Marke, kommt die gespeicherte Fassung; sonst ein Modell-Aufruf mit einem
 * zweiten Versuch, wenn der Waechter den ersten ablehnt. Scheitert auch der, wird der
 * Originaltext zurueckgegeben und ins Logbuch geschrieben: Die Stimme spricht dann wie
 * bisher, nur die Jahreszahlen klingen komisch.
 */
export async function getSpokenText(
  db: SupabaseClient,
  input: { pointId: string; lang: string; kind: AudioKind; text: string },
): Promise<SpokenResult> {
  const text = input.text.trim();
  if (!needsSpokenForm(text)) return { text, derived: false, generated: false };
  const c = spokenCols(input.kind);
  const want = spokenSourceHash(text);

  const { data } = await db
    .from("tour_point_audio")
    .select(`${c.spoken}, ${c.hash}`)
    .eq("point_id", input.pointId)
    .eq("lang", input.lang)
    .maybeSingle();
  const row = (data as Record<string, string | null> | null) ?? null;
  const cached = row?.[c.spoken];
  if (cached && row?.[c.hash] === want) return { text: cached, derived: true, generated: false };

  const gen = await generateSpokenText(text, input.lang);
  if (gen.ok) {
    // Zeile fehlt nur, wenn jemand ohne Text vertont; dann faellt das Update ins Leere und
    // die Fassung wird beim naechsten Mal eben noch einmal erzeugt.
    await db
      .from("tour_point_audio")
      .update({ [c.spoken]: gen.text, [c.hash]: want })
      .eq("point_id", input.pointId)
      .eq("lang", input.lang);
    return { text: gen.text, derived: true, generated: true };
  }
  return { text, derived: false, generated: false, failedReason: `${gen.reason} (prompt v${SPOKEN_PROMPT_VERSION})` };
}

/**
 * Nur erzeugen und pruefen, ohne Datenbank: zwei Versuche, der zweite mit dem Grund der
 * Ablehnung. Fuer getSpokenText und fuer Skripte, die das Modell einmal probehalber fragen.
 */
export async function generateSpokenText(
  text: string,
  lang: string,
): Promise<{ ok: true; text: string; attempts: number } | { ok: false; reason: string; attempts: number }> {
  let reason: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const candidate = await askModel(text, lang, reason);
    if (!candidate) {
      reason = "no answer";
      continue;
    }
    const verdict = spokenTextAcceptable(text, candidate);
    if (verdict.ok) return { ok: true, text: candidate, attempts: attempt };
    reason =
      verdict.reason === "digits"
        ? "digits were left in the text"
        : verdict.reason === "words_changed"
          ? "words other than numbers were changed, dropped or reordered"
          : verdict.reason === "length"
            ? "the text became far too long"
            : "the text was empty";
  }
  return { ok: false, reason: reason ?? "unbekannt", attempts: 2 };
}
