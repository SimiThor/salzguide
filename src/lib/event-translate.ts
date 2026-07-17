// Geteilter Event-Übersetzungs-Kern (KEIN "use server" -> normal importierbar).
// Wird von der Admin-Action (event-actions.ts, mit Admin-Gate) UND von der
// KI-Wochenrecherche (event-research.ts, Service-Role/Cron) genutzt -> EINE Quelle,
// keine doppelten Prompts. Deutsch = Quelle; übersetzt in alle Ziel-Locales parallel.
import { fetchWithRetry } from "./ai-fetch";
import { stripEmDash } from "./em-dash";
import { localeMeta } from "@/i18n/locales";
import { routing } from "@/i18n/routing";
import { hashTexts } from "./spot-hash";

export type EventTexts = { title: string; description: string };

export type EventTranslateAllResult = {
  ok: boolean;
  translations?: Record<string, EventTexts>;
  sourceHash?: string;
  failed?: string[];
  error?: string;
};

const AI_HEADERS = (key: string) => ({
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
});

// Der Gedankenstrich-Satz steht hier im Klartext und nicht nur in BRAND_VOICE: Diese
// Prompts sind englisch und knapp, BRAND_VOICE ist ein langer deutscher Stil-Text fürs
// Texten. Die Regel selbst ist dieselbe (siehe brand-voice.ts) — verlassen tun wir uns
// aber nicht darauf, sondern auf stripEmDash() weiter unten: Ein Prompt ist eine Bitte.
const NO_EM_DASH =
  'NEVER use the em dash ("—"). It is the clearest giveaway of machine-written text and we cannot ship it. Use a comma, a period or a colon instead: not "30 tabs — and the hut is closed." but "30 tabs, and the hut is closed." Only Chinese is exempt: there "——" is normal punctuation.';

function eventVoice(langName: string): string {
  return `You translate SalzGuide event texts from German into natural ${langName} (Salzburg region, Austria).
STYLE: casual, direct, short sentences. Translate meaning, not word-for-word. Keep proper nouns, place names, dates and numbers exactly. Avoid travel-brochure clichés.
${NO_EM_DASH}
RULES: translate ONLY what is given, invent nothing. Empty source -> empty string.`;
}

export async function translateEventTo(
  src: EventTexts,
  targetLocale: string,
  key: string,
): Promise<EventTexts | null> {
  const langName = localeMeta(targetLocale).english;
  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: AI_HEADERS(key),
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 800,
          system: eventVoice(langName),
          messages: [
            {
              role: "user",
              content: `Translate these German event fields into ${langName} and return them via the tool "event_texts". Keep empty fields empty.\n\n${JSON.stringify(
                { title: src.title.trim(), description: src.description.trim() },
                null,
                2,
              )}`,
            },
          ],
          tools: [
            {
              name: "event_texts",
              description: `${langName} translation of the event fields.`,
              input_schema: {
                type: "object",
                properties: { title: { type: "string" }, description: { type: "string" } },
                required: ["title", "description"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "event_texts" },
        }),
      },
      2,
      60000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "event_texts",
    ) as { input?: Record<string, string> } | undefined;
    const t = block?.input;
    if (!t) return null;
    // Gedankenstrich raus, BEVOR das gespeichert wird. Der Prompt oben bittet darum,
    // hier wird es erzwungen. targetLocale mitgeben: Chinesisch behält sein „——".
    return {
      title: stripEmDash(t.title?.trim() || src.title.trim(), targetLocale),
      description: src.description.trim()
        ? stripEmDash((t.description ?? "").trim(), targetLocale)
        : "",
    };
  } catch {
    return null;
  }
}

// EFFIZIENT für Batches (KI-Wochenrecherche): EIN Claude-Call übersetzt ein Event in ALLE
// Ziel-Sprachen auf einmal (statt 1 Call je Sprache). Spart Calls/Zeit/Rate-Limit bei vielen
// Events. Deutsch = Quelle. Rückgabe wie translateEventTextsWith (translations + sourceHash).
export async function translateEventAllLangsOneShot(
  input: EventTexts,
  key: string,
): Promise<EventTranslateAllResult> {
  if (!input.title.trim()) return { ok: false, error: "empty" };
  const targets = routing.locales.filter((l) => l !== "de");
  const langList = targets.map((l) => `"${l}" = ${localeMeta(l).english}`).join(", ");
  const props: Record<string, unknown> = {};
  for (const l of targets) {
    props[l] = {
      type: "object",
      properties: { title: { type: "string" }, description: { type: "string" } },
      required: ["title", "description"],
    };
  }
  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: AI_HEADERS(key),
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2500,
          system: `You translate a SalzGuide event (Salzburg region, Austria) from German into MULTIPLE languages at once.
STYLE: casual, direct, short sentences. Translate meaning, not word-for-word. Keep proper nouns, place names, dates and numbers exactly. Avoid travel-brochure clichés.
${NO_EM_DASH}
RULES: translate ONLY the given fields, invent nothing. If a field is empty, return an empty string. Return EVERY requested language via the tool "event_texts_all".
Language keys: ${langList}.`,
          messages: [
            {
              role: "user",
              content: `Translate this German event into ALL requested languages and return them via the tool "event_texts_all".\n\n${JSON.stringify(
                { title: input.title.trim(), description: input.description.trim() },
                null,
                2,
              )}`,
            },
          ],
          tools: [
            {
              name: "event_texts_all",
              description: "Translations of the event, one object per language key.",
              input_schema: { type: "object", properties: props, required: targets },
            },
          ],
          tool_choice: { type: "tool", name: "event_texts_all" },
        }),
      },
      2,
      90000,
    );
    if (!res.ok) return { ok: false, error: "all_failed" };
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) =>
        b.type === "tool_use" && b.name === "event_texts_all",
    ) as { input?: Record<string, { title?: string; description?: string }> } | undefined;
    const out = block?.input;
    if (!out) return { ok: false, error: "all_failed" };
    const translations: Record<string, EventTexts> = {};
    const failed: string[] = [];
    for (const l of targets) {
      const tx = out[l];
      // Wie oben: erzwingen statt hoffen. `l` ist die Ziel-Locale, Chinesisch bleibt heil.
      const title = stripEmDash((tx?.title ?? "").trim(), l);
      if (tx && title) {
        translations[l] = {
          title,
          description: input.description.trim()
            ? stripEmDash((tx.description ?? "").trim(), l)
            : "",
        };
      } else {
        failed.push(l);
      }
    }
    if (Object.keys(translations).length === 0) return { ok: false, error: "all_failed" };
    return {
      ok: true,
      translations,
      sourceHash: hashTexts([input.title, input.description]),
      failed: failed.length ? failed : undefined,
    };
  } catch {
    return { ok: false, error: "all_failed" };
  }
}

// Nicht-gegatet: übersetzt EIN Event (Titel + Beschreibung) in ALLE Ziel-Locales (parallel).
// Der Aufrufer stellt sicher, dass er dazu berechtigt ist (Admin-Gate ODER Service-Role/Cron).
export async function translateEventTextsWith(
  input: EventTexts,
  key: string,
): Promise<EventTranslateAllResult> {
  if (!input.title.trim()) return { ok: false, error: "empty" };
  const targets = routing.locales.filter((l) => l !== "de");
  const results = await Promise.all(
    targets.map(async (l) => [l, await translateEventTo(input, l, key)] as const),
  );
  const translations: Record<string, EventTexts> = {};
  const failed: string[] = [];
  for (const [l, tx] of results) {
    if (tx) translations[l] = tx;
    else failed.push(l);
  }
  if (Object.keys(translations).length === 0) return { ok: false, error: "all_failed" };
  return {
    ok: true,
    translations,
    sourceHash: hashTexts([input.title, input.description]),
    failed: failed.length ? failed : undefined,
  };
}
