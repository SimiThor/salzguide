// Übersetzungs-Kern für die Startseiten-Texte (KEIN "use server" -> normal importierbar).
// Deutsch ist die Quelle, übersetzt wird in alle Ziel-Locales parallel: EIN Aufruf pro
// Sprache mit allen Feldern, statt 40 Aufrufe pro Sprache.
//
// Aufgebaut wie event-translate.ts, mit einem Unterschied, den es dort nicht gibt: Die
// Startseite hat einen Platzhalter ({count}), und der muss die Übersetzung überleben.
// Siehe keepsPlaceholders() unten.
import { fetchWithRetry } from "./ai-fetch";
import { stripEmDash } from "./em-dash";
import { hashTexts } from "./spot-hash";
import { localeMeta } from "@/i18n/locales";
import { routing } from "@/i18n/routing";
import { HOME_GROUPS, HOME_KEYS, homeTextParts, type HomeTexts } from "./home-fields";

export type HomeTranslateResult = {
  ok: boolean;
  translations?: Record<string, HomeTexts>;
  sourceHash?: string;
  /** Sprachen, die komplett fehlgeschlagen sind. */
  failed?: string[];
  /** Einzelne Felder, die verworfen wurden (Platzhalter verloren): "en.trustSpotsTitle". */
  rejected?: string[];
  error?: string;
};

const AI_HEADERS = (key: string) => ({
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
});

// Der Gedankenstrich-Satz steht hier im Klartext und nicht nur in BRAND_VOICE: Dieser
// Prompt ist englisch und knapp, BRAND_VOICE ist ein langer deutscher Stil-Text fürs
// Texten. Die Regel ist dieselbe (brand-voice.ts). Verlassen tun wir uns nicht darauf,
// sondern auf stripEmDash() weiter unten: Ein Prompt ist eine Bitte.
const NO_EM_DASH =
  'NEVER use the em dash ("—"). It is the clearest giveaway of machine-written text and we cannot ship it. Use a comma, a period or a colon instead. Only Chinese is exempt: there "——" is normal punctuation.';

// Platzhalter im Text: {count}. Muss Zeichen für Zeichen erhalten bleiben, sonst steht die
// Klammer später wörtlich auf der Seite oder die Zahl fehlt.
function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

// Hat die Übersetzung alle Platzhalter der Quelle behalten?
function keepsPlaceholders(src: string, out: string): boolean {
  return placeholders(src).join("|") === placeholders(out).join("|");
}

// Kurzbeschreibung je Feld für das Modell: Ohne sie übersetzt es „Kostprobe" oder
// „Herzensprojekt" ins Blaue, weil es nicht weiss, ob das eine Überschrift, ein Knopf
// oder eine Fussnote ist. Kommt aus derselben Quelle wie das Admin-Formular.
function fieldNotes(): string {
  return HOME_GROUPS.flatMap((g) =>
    g.fields.map((f) => `- ${f.key} (${g.title}): ${f.label}${f.hint ? ". " + f.hint : ""}`),
  ).join("\n");
}

function homeVoice(langName: string): string {
  return `You translate the homepage of salzguide.com from German into natural ${langName}.

SalzGuide is a map of curated spots in the Salzburg region, Austria, made by two locals,
Anton and Simon. Audience: 18-45, travellers and locals, allergic to tourism marketing.

STYLE: casual, direct, short sentences, informal address. Translate the MEANING, never
word-for-word. Keep proper nouns exactly: SalzGuide, Salzburg, Salzburger Land, Anton,
Simon, Toni, Fuschlsee, Pro, Google, ChatGPT. Keep emoji exactly where they are.
Avoid travel-brochure clichés and empty superlatives.
${NO_EM_DASH}

LENGTH: this is display copy on a landing page. Several of these render at 40-68px. A
translation much longer than the German breaks the layout. Shorter is better than faithful.

PLACEHOLDERS: {count} must be kept EXACTLY as it is, including the braces. It is replaced
with a real number at runtime. Never translate it, never remove it, never rename it.

RULES: translate ONLY what is given, invent nothing, claim nothing the German does not.
Empty source -> empty string.

WHAT EACH FIELD IS:
${fieldNotes()}`;
}

async function translateHomeTo(
  src: HomeTexts,
  targetLocale: string,
  key: string,
): Promise<{ texts: HomeTexts; rejected: string[] } | null> {
  const langName = localeMeta(targetLocale).english;
  // Nur die Felder schicken, die wirklich Text haben.
  const payload: HomeTexts = {};
  for (const k of HOME_KEYS) if ((src[k] ?? "").trim()) payload[k] = src[k].trim();
  if (Object.keys(payload).length === 0) return null;

  const props: Record<string, unknown> = {};
  for (const k of Object.keys(payload)) props[k] = { type: "string" };

  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: AI_HEADERS(key),
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          system: homeVoice(langName),
          messages: [
            {
              role: "user",
              content: `Translate these German homepage fields into ${langName} and return every one of them via the tool "home_texts".\n\n${JSON.stringify(
                payload,
                null,
                2,
              )}`,
            },
          ],
          tools: [
            {
              name: "home_texts",
              description: `${langName} translation of the homepage fields.`,
              input_schema: {
                type: "object",
                properties: props,
                required: Object.keys(payload),
              },
            },
          ],
          tool_choice: { type: "tool", name: "home_texts" },
        }),
      },
      2,
      90000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "home_texts",
    ) as { input?: Record<string, string> } | undefined;
    const t = block?.input;
    if (!t) return null;

    const texts: HomeTexts = {};
    const rejected: string[] = [];
    for (const [k, de] of Object.entries(payload)) {
      // Gedankenstrich raus, BEVOR gespeichert wird. targetLocale mitgeben: zh behält „——".
      const out = stripEmDash((t[k] ?? "").trim(), targetLocale);
      if (!out) {
        rejected.push(k);
        continue;
      }
      // Platzhalter verloren -> Feld verwerfen. Lieber die deutsche Zeile stehen lassen
      // (das Auffangnetz in home-content.ts greift dann) als „{count}" auf der Seite oder
      // eine Kachel ohne Zahl. Ein stiller Fehler in acht Sprachen wäre teuer.
      if (!keepsPlaceholders(de, out)) {
        rejected.push(k);
        continue;
      }
      texts[k] = out;
    }
    if (Object.keys(texts).length === 0) return null;
    return { texts, rejected };
  } catch {
    return null;
  }
}

/**
 * Übersetzt die deutschen Startseiten-Texte in ALLE Ziel-Locales.
 * Nicht gegatet: Der Aufrufer stellt sicher, dass er darf (Admin-Action).
 */
export async function translateHomeTextsWith(
  de: HomeTexts,
  key: string,
): Promise<HomeTranslateResult> {
  if (!Object.values(de).some((v) => (v ?? "").trim())) return { ok: false, error: "empty" };

  const targets = routing.locales.filter((l) => l !== "de");
  const results = await Promise.all(
    targets.map(async (l) => [l, await translateHomeTo(de, l, key)] as const),
  );

  const translations: Record<string, HomeTexts> = {};
  const failed: string[] = [];
  const rejected: string[] = [];
  for (const [l, r] of results) {
    if (!r) {
      failed.push(l);
      continue;
    }
    translations[l] = r.texts;
    for (const k of r.rejected) rejected.push(`${l}.${k}`);
  }
  if (Object.keys(translations).length === 0) return { ok: false, error: "all_failed" };

  return {
    ok: true,
    translations,
    // Der Hash gehört zu GENAU diesem deutschen Stand. Ändert Anton danach ein Wort,
    // weicht er ab und der Admin zeigt „veraltet".
    sourceHash: hashTexts(homeTextParts(de)),
    failed: failed.length ? failed : undefined,
    rejected: rejected.length ? rejected : undefined,
  };
}
