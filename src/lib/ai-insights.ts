// Anonyme KI-Chatbot-Auswertung (docs/34 §I).
//
// DATENSCHUTZ (Kern): Aus jeder Anfrage werden NUR geschlossene Codes abgeleitet
// (Intent/Kategorie/Region/„beantwortet?") und gespeichert — KEIN Rohtext, KEIN
// Nutzerbezug, KEINE Uhrzeit. Ergebnis = echt anonym (Recital 26, außerhalb DSGVO).
// Die Klassifikation nutzt Claude (billiges Haiku-Modell); die Nachricht geht dabei
// an denselben Auftragsverarbeiter, der ohnehin die Antwort erzeugt — es entsteht
// KEIN neuer Datenfluss und nichts Personenbezogenes wird persistiert.
import { getAdminUserId } from "./admin-guard";
import { LOCALE_CODES, localeMeta } from "@/i18n/locales";
import { routing } from "@/i18n/routing";
import { createServiceClient } from "./supabase/service";
import { fetchWithRetry } from "./ai-fetch";
import type { AiCards } from "./ai-types";
import type { LabeledValue, RangeKey } from "./analytics-queries";

const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001"; // billig + schnell, reicht für Codes

// ── Geschlossene Taxonomie (Codes + deutsche Anzeige-Labels) ─────────────────
export const INTENTS = [
  "spot_discovery", "itinerary", "food_drink", "event_search", "practical_info",
  "price_pro", "weather_season", "region_info", "smalltalk", "off_topic", "other",
] as const;
export const CATEGORIES = [
  "hiking", "swimming", "viewpoint", "nature", "food", "cafe", "nightlife",
  "family", "culture", "wellness", "winter_sport", "shopping", "event", "other",
] as const;
export const REGIONS = [
  "salzburg_stadt", "flachgau", "tennengau", "pongau", "pinzgau", "lungau",
  "outside_salzburg", "unknown",
] as const;
export const UNMET = [
  "no_matching_content", "missing_data", "out_of_scope", "none",
] as const;

export const INTENT_LABELS: Record<string, string> = {
  spot_discovery: "Spot/Ort finden", itinerary: "Tour/Reise planen",
  food_drink: "Essen & Trinken", event_search: "Events",
  practical_info: "Praktisches (Zeiten/Anfahrt)", price_pro: "Preis/Pro",
  weather_season: "Wetter/Saison", region_info: "Region allgemein",
  smalltalk: "Smalltalk", off_topic: "Themenfremd", other: "Sonstiges",
};
export const CATEGORY_LABELS: Record<string, string> = {
  hiking: "Wandern", swimming: "Baden/See", viewpoint: "Aussicht", nature: "Natur",
  food: "Restaurant", cafe: "Café", nightlife: "Nightlife", family: "Familie/Kinder",
  culture: "Kultur", wellness: "Wellness", winter_sport: "Wintersport",
  shopping: "Shopping", event: "Event", other: "Sonstiges",
};
export const REGION_LABELS: Record<string, string> = {
  salzburg_stadt: "Stadt Salzburg", flachgau: "Flachgau", tennengau: "Tennengau",
  pongau: "Pongau", pinzgau: "Pinzgau", lungau: "Lungau",
  outside_salzburg: "Außerhalb Salzburgs", unknown: "Unbekannt",
};
export const UNMET_LABELS: Record<string, string> = {
  no_matching_content: "Kein passender Inhalt (Content-Lücke)",
  missing_data: "Info fehlt beim Spot (Datenlücke)",
  out_of_scope: "Außerhalb/themenfremd", none: "—",
};

// Alle Sprachen aus der zentralen Config (Endonym) -> neue Sprache erscheint automatisch.
const LOCALE_LABELS: Record<string, string> = Object.fromEntries(
  routing.locales.map((l) => [l, localeMeta(l).name]),
);

// YYYY-MM-DD in Wiener Zeit.
function viennaYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(d);
}

function coerce<T extends readonly string[]>(
  v: unknown, allowed: T, fallback: T[number] | null,
): T[number] | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T[number])
    : fallback;
}

// ── Klassifikator-Tool (erzwungenes Tool-Use -> strukturierte Codes) ─────────
const CLASSIFY_TOOL = {
  name: "classify_query",
  description:
    "Ordne die Nutzeranfrage in feste Codes für eine ANONYME Produkt-Statistik ein. Wähle je Feld GENAU einen erlaubten Wert.",
  input_schema: {
    type: "object" as const,
    properties: {
      intent: { type: "string", enum: [...INTENTS] },
      category: { type: "string", enum: [...CATEGORIES] },
      region: { type: "string", enum: [...REGIONS] },
      answered: { type: "boolean" },
      unmet_reason: { type: "string", enum: [...UNMET] },
    },
    required: ["intent", "category", "region", "answered", "unmet_reason"],
  },
};

const CLASSIFY_SYSTEM = `Du klassifizierst eine einzelne Nutzeranfrage an den Reise-Chatbot „Toni" (Freizeit & Reise im Salzburger Land) in feste Codes für eine anonyme Produkt-Statistik. Es geht NICHT um eine Antwort an den Nutzer.
- Wähle je Feld GENAU einen der erlaubten Werte.
- category = das inhaltliche Thema des Wunsches (bei Events: 'event').
- region = grobe Region in Salzburg, sonst 'outside_salzburg' bzw. 'unknown'.
- answered = true, wenn der Bot den Wunsch mit den gezeigten Inhalten (siehe KONTEXT) erfüllen konnte; false, wenn nichts Passendes vorhanden war.
- unmet_reason: bei answered=true immer 'none'. Bei answered=false: 'no_matching_content' (so einen Spot/so ein Event gibt es bei uns nicht), 'missing_data' (Ort existiert, aber die gefragte Info fehlt) oder 'out_of_scope' (nicht Salzburg / themenfremd).
Antworte ausschließlich über das Tool.`;

// Eine Anfrage klassifizieren und ANONYM als Codes speichern. Best effort — darf
// nie den Chat beeinflussen. Prod-Gate + Betreiber-Ausschluss wie die übrige Analytik.
export async function recordAiInsight(input: {
  message: string;
  cards: AiCards;
  locale: string;
  isOperator: boolean;
}): Promise<void> {
  if (process.env.NODE_ENV !== "production") return; // kein Dev-Rauschen
  if (input.isOperator) return; // Betreiber (Admin) zählt nicht
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return;
  const message = (input.message ?? "").trim();
  if (!message) return;

  try {
    const spots = input.cards?.spots ?? [];
    const events = input.cards?.events ?? [];
    const spotTypes = Array.from(new Set(spots.map((s) => s.type).filter(Boolean))).slice(0, 6);
    const eventCats = Array.from(
      new Set(events.map((e) => e.category).filter(Boolean) as string[]),
    ).slice(0, 6);
    const context =
      `gezeigte_spots=${spots.length} (typen: ${spotTypes.join(", ") || "-"}); ` +
      `gezeigte_events=${events.length} (kategorien: ${eventCats.join(", ") || "-"})`;

    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: CLASSIFIER_MODEL,
          max_tokens: 200,
          system: CLASSIFY_SYSTEM,
          tools: [CLASSIFY_TOOL],
          tool_choice: { type: "tool", name: "classify_query" },
          messages: [
            { role: "user", content: `ANFRAGE:\n${message.slice(0, 500)}\n\nKONTEXT (was der Bot zeigte):\n${context}` },
          ],
        }),
      },
      1,
      15000,
    );
    if (!res.ok) return;
    const json = (await res.json()) as {
      content?: { type: string; name?: string; input?: Record<string, unknown> }[];
    };
    const tool = (json.content ?? []).find(
      (b) => b.type === "tool_use" && b.name === "classify_query",
    );
    if (!tool?.input) return;
    const inp = tool.input;

    const grounded = spots.length + events.length > 0;
    const intent = coerce(inp.intent, INTENTS, "other");
    const category = coerce(inp.category, CATEGORIES, null);
    const region = coerce(inp.region, REGIONS, "unknown");
    const answered = typeof inp.answered === "boolean" ? inp.answered : grounded;
    let unmet = coerce(inp.unmet_reason, UNMET, "none");
    if (answered) unmet = "none";
    else if (unmet === "none") unmet = "no_matching_content";

    // NUR Codes — kein Rohtext, kein Nutzerbezug, keine Uhrzeit.
    await createServiceClient().from("ai_insights").insert({
      day: viennaYmd(new Date()),
      intent,
      category,
      region,
      answered,
      unmet_reason: unmet,
      locale: (LOCALE_CODES as readonly string[]).includes(input.locale) ? input.locale : "de",
    });
  } catch {
    /* Analytik ist unkritisch -> Fehler schlucken */
  }
}

// ── Admin-Read (aggregiert, k-anonym) ────────────────────────────────────────
export type AiInsightsQuery = { range?: RangeKey; from?: string | null; to?: string | null };

export type AiInsightsData = {
  from: string;
  to: string;
  total: number;
  answered: number;
  unanswered: number;
  answerRate: number; // % beantwortet
  intents: LabeledValue[];
  categories: LabeledValue[];
  regions: LabeledValue[];
  locales: LabeledValue[];
  gaps: { category: string; region: string; reason: string; count: number }[];
  kMin: number;
};

const PRESET_DAYS: Record<RangeKey, number> = { "30d": 30, "3mo": 90, "6mo": 180, "12mo": 365 };
const K_MIN = 5; // k-Anonymität: kleinere Buckets werden ausgeblendet
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

export async function getAiInsights(q: AiInsightsQuery = {}): Promise<AiInsightsData | null> {
  const adminId = await getAdminUserId();
  if (!adminId) return null;

  const now = new Date();
  let fromDay: string;
  let toDay: string;
  if (q.from && q.to) {
    fromDay = q.from;
    toDay = q.to;
  } else {
    const days = PRESET_DAYS[q.range ?? "30d"] ?? 30;
    toDay = viennaYmd(now);
    fromDay = viennaYmd(new Date(now.getTime() - days * 86_400_000));
  }

  const svc = createServiceClient();
  const R = { p_from: fromDay, p_to: toDay };
  const bd = (col: string) =>
    svc.rpc("ai_insights_breakdown", { p_column: col, ...R, p_min: K_MIN });

  const [ov, intents, categories, regions, locales, gapsRes] = await Promise.all([
    svc.rpc("ai_insights_overview", R),
    bd("intent"),
    bd("category"),
    bd("region"),
    bd("locale"),
    svc.rpc("ai_insights_gaps", { ...R, p_min: K_MIN }),
  ]);

  const o = (ov.data?.[0] ?? {}) as Record<string, unknown>;
  const total = num(o.total);
  const answered = num(o.answered_count);
  const unanswered = num(o.unanswered_count);

  const toLabeled = (rows: unknown, labels?: Record<string, string>): LabeledValue[] =>
    ((rows ?? []) as { label: string; cnt: number }[]).map((r) => ({
      label: labels?.[r.label] ?? r.label,
      value: num(r.cnt),
    }));

  return {
    from: fromDay,
    to: toDay,
    total,
    answered,
    unanswered,
    answerRate: total ? Math.round((answered / total) * 100) : 0,
    intents: toLabeled(intents.data, INTENT_LABELS),
    categories: toLabeled(categories.data, CATEGORY_LABELS),
    regions: toLabeled(regions.data, REGION_LABELS),
    locales: toLabeled(locales.data, LOCALE_LABELS),
    gaps: ((gapsRes.data ?? []) as {
      category: string; region: string; unmet_reason: string; cnt: number;
    }[]).map((g) => ({
      category: CATEGORY_LABELS[g.category] ?? g.category,
      region: REGION_LABELS[g.region] ?? g.region,
      reason: UNMET_LABELS[g.unmet_reason] ?? g.unmet_reason,
      count: num(g.cnt),
    })),
    kMin: K_MIN,
  };
}
