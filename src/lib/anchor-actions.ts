"use server";

import { createClient } from "./supabase/server";
import { ANCHOR_EVENTS } from "./event-anchors";
import { EVENT_CATEGORIES, type EventCategory } from "./events-format";
import { fetchWithRetry, safeJsonParse } from "./ai-fetch";

const ANCHOR_REGIONS = [
  "Stadt Salzburg",
  "Flachgau",
  "Tennengau",
  "Pongau",
  "Pinzgau",
  "Lungau",
  "ganzes Land",
];

export type AnchorInput = {
  id?: string;
  key: string;
  name: string;
  category: EventCategory;
  region: string;
  months: number[];
  timing: string;
  url: string;
  free: "ja" | "nein" | "teils";
  why: string;
  note: string;
  active: boolean;
};

export type AnchorResult = { ok: boolean; id?: string; error?: string };

// Admin-Gate (wie in event-actions): eingeloggt + Rolle admin.
async function requireAdmin(): Promise<
  { supabase: Awaited<ReturnType<typeof createClient>> } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "auth" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { error: "forbidden" };
  return { supabase };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const cleanMonths = (m: number[]): number[] =>
  Array.from(new Set((m ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12))).sort(
    (a, b) => a - b,
  );

export async function saveAnchor(input: AnchorInput): Promise<AnchorResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { supabase } = gate;

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name fehlt" };
  const category: EventCategory = EVENT_CATEGORIES.includes(input.category)
    ? input.category
    : "kultur";
  const free = ["ja", "nein", "teils"].includes(input.free) ? input.free : "nein";
  const key = (input.key.trim() || slugify(name)) || `anchor-${Date.now()}`;

  const row = {
    key,
    name,
    category,
    region: input.region.trim() || "ganzes Land",
    months: cleanMonths(input.months),
    timing: input.timing.trim(),
    url: input.url.trim(),
    free,
    why: input.why.trim(),
    note: input.note.trim() || null,
    active: Boolean(input.active),
  };

  if (input.id) {
    const { error } = await supabase
      .from("event_anchors")
      .update(row)
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: input.id };
  }
  const { data, error } = await supabase
    .from("event_anchors")
    .insert(row)
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

export async function deleteAnchor(id: string): Promise<AnchorResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { error } = await gate.supabase.from("event_anchors").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function toggleAnchorActive(
  id: string,
  active: boolean,
): Promise<AnchorResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { error } = await gate.supabase
    .from("event_anchors")
    .update({ active })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

// Standard-Anker (eingebaute Liste) in die DB laden – überspringt vorhandene Keys.
// Nützlich, falls die Tabelle leer ist (z.B. nur Schema migriert, kein Seed).
export async function seedDefaultAnchors(): Promise<
  AnchorResult & { inserted?: number }
> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const rows = ANCHOR_EVENTS.map((a, i) => ({
    key: a.key,
    name: a.name,
    category: a.category,
    region: a.region,
    months: a.months,
    timing: a.timing,
    url: a.url,
    free: a.free,
    why: a.why,
    note: a.note ?? null,
    active: true,
    sort_order: i,
  }));
  const { data, error } = await gate.supabase
    .from("event_anchors")
    .upsert(rows, { onConflict: "key", ignoreDuplicates: true })
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, inserted: data?.length ?? 0 };
}

// ---- KI: Anker-Formular aus dem NAMEN automatisch ausfüllen -------------------
// Recherchiert das jährliche Event und füllt Kategorie/Region/Monate/Zeitfenster/
// Quelle/Eintritt/Warum/Hinweis. Der Admin prüft & speichert -> nichts Blindes.
export type AnchorDraft = {
  category: EventCategory;
  region: string;
  months: number[];
  timing: string;
  url: string;
  free: "ja" | "nein" | "teils";
  why: string;
  note: string;
};
export type AnchorDraftResult = { ok: boolean; draft?: AnchorDraft; error?: string };

const AI_HEADERS = (key: string) => ({
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
});

function coerceRegion(v: unknown): string {
  return typeof v === "string" && ANCHOR_REGIONS.includes(v) ? v : "ganzes Land";
}
function coerceCategory(v: unknown): EventCategory {
  return EVENT_CATEGORIES.includes(v as EventCategory) ? (v as EventCategory) : "kultur";
}
function coerceFree(v: unknown): "ja" | "nein" | "teils" {
  return v === "ja" || v === "teils" ? v : "nein";
}

// Schritt 1: Web-Recherche zum jährlichen Event (Server-Tool web_search).
async function researchAnchor(name: string, key: string): Promise<string | null> {
  const system = `Du recherchierst EIN jährlich wiederkehrendes Event/Fest/Festival im Land Salzburg (Österreich): „${name}". Finde belegte Fakten über das Web:
- worum es geht (kurz), und zu welcher Kategorie es passt: Party/Musik/Club, Tradition/Brauchtum/Volksfest, Kultur (Theater/Film/Jazz/Klassik/Comedy/Museum/queer), Sport (ALLES Sportliche/Outdoor: Motorsport/Läufe/Trail/Marathon/Rad/Ski/Fußball), oder Kinder/Familie.
- in welcher Salzburger REGION: Stadt Salzburg, Flachgau, Tennengau, Pongau, Pinzgau, Lungau oder ganzes Land.
- in welchen MONATEN es typischerweise stattfindet (NICHT das exakte Datum – das variiert jährlich).
- ein kurzes Zeitfenster in Worten (z.B. „Ende September", „erstes Dezember-Wochenende").
- die OFFIZIELLE Veranstalter-/Location-Seite (KEINE Aggregatoren wie meinbezirk, oeticket, ticketmaster, eventbrite, facebook).
- ob der Eintritt gratis ist (ja / nein / teilweise).
- Vorbehalte: läuft es nur alle paar Jahre? Wechselt der Ort? Ist es ein durchgehender Markt?
Nur Belegtes; wenn etwas unklar ist, sag es offen. Antworte in knappen deutschen Stichpunkten mit der offiziellen Quelle.`;

  let messages: { role: string; content: unknown }[] = [
    { role: "user", content: `Recherchiere dieses jährliche Event: ${name}` },
  ];
  let last: { stop_reason?: string; content?: { type: string; text?: string }[] } | null = null;
  try {
    for (let guard = 0; guard < 4; guard++) {
      const res = await fetchWithRetry(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: AI_HEADERS(key),
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1500,
            system,
            messages,
            tools: [
              {
                type: "web_search_20250305",
                name: "web_search",
                max_uses: 4,
                user_location: {
                  type: "approximate",
                  country: "AT",
                  region: "Salzburg",
                  city: "Salzburg",
                  timezone: "Europe/Vienna",
                },
              },
            ],
          }),
        },
        1,
        90000,
      );
      if (!res.ok) return null;
      last = await res.json();
      if (last?.stop_reason === "pause_turn") {
        messages = [...messages, { role: "assistant", content: last.content }];
        continue;
      }
      break;
    }
  } catch {
    return null;
  }
  const research = (last?.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  return research || null;
}

export async function generateAnchorDraft(name: string): Promise<AnchorDraftResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const q = name.trim();
  if (!q) return { ok: false, error: "Bitte zuerst einen Namen eingeben." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  const research = await researchAnchor(q, key);
  if (!research)
    return {
      ok: false,
      error: "Keine belegten Infos gefunden – Namen präzisieren oder Anthropic-Guthaben prüfen.",
    };

  const system = `AUFGABE: Extrahiere aus der Recherche die Anker-Felder für ein jährliches Event und gib sie AUSSCHLIESSLICH über das Tool "anchor_fields" zurück.
- category: beste Einordnung. WICHTIG: ALLES Sportliche/Outdoor (Motorsport/Läufe/Trail/Marathon/Rad/Ski/Fußball) IMMER "sport", NIE "party"/"kultur".
- region: GENAU eine aus [Stadt Salzburg, Flachgau, Tennengau, Pongau, Pinzgau, Lungau, ganzes Land].
- months: ALLE Monate (Zahlen 1–12), in denen es typischerweise stattfindet.
- timing: kurzes Zeitfenster in WORTEN (KEIN festes Datum, das variiert jährlich).
- url: die OFFIZIELLE Veranstalter-/Location-Seite (kein Aggregator, kein reines Tourismus-Portal wenn vermeidbar).
- free: "ja" | "nein" | "teils".
- why: EIN knapper Satz (Kumpel-Ton, keine Reiseführer-Floskeln), warum die junge Zielgruppe (18–40) das nicht verpassen will.
- note: Vorbehalt, falls nötig (z.B. „nur alle 2 Jahre", „Ort wechselt jährlich", „Dauer-Markt: nicht pro Tag listen"); sonst leer.
GROUNDING: nur belegte Fakten aus der Recherche, nichts erfinden.`;

  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: AI_HEADERS(key),
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 900,
          system,
          messages: [{ role: "user", content: `RECHERCHE:\n${research}` }],
          tools: [
            {
              name: "anchor_fields",
              description: "Die strukturierten Felder eines jährlichen Anker-Events.",
              input_schema: {
                type: "object",
                properties: {
                  category: { type: "string", enum: ["party", "tradition", "kultur", "sport", "kids"] },
                  region: { type: "string", enum: ANCHOR_REGIONS },
                  months: { type: "array", items: { type: "integer" } },
                  timing: { type: "string" },
                  url: { type: "string" },
                  free: { type: "string", enum: ["ja", "nein", "teils"] },
                  why: { type: "string" },
                  note: { type: "string" },
                },
                required: ["category", "region", "months", "timing", "url", "free", "why"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "anchor_fields" },
        }),
      },
      2,
      60000,
    );
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Claude ${res.status}: ${txt.slice(0, 160)}` };
    }
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "anchor_fields",
    ) as { input?: unknown } | undefined;
    let raw: unknown = block?.input;
    if (typeof raw === "string") raw = safeJsonParse(raw);
    const t = raw as Record<string, unknown> | undefined;
    if (!t) return { ok: false, error: "Keine Felder erhalten" };

    const months = Array.isArray(t.months)
      ? Array.from(
          new Set(
            (t.months as unknown[])
              .map((n) => Math.trunc(Number(n)))
              .filter((n) => n >= 1 && n <= 12),
          ),
        ).sort((a, b) => a - b)
      : [];

    const draft: AnchorDraft = {
      category: coerceCategory(t.category),
      region: coerceRegion(t.region),
      months,
      timing: String(t.timing ?? "").trim(),
      url: String(t.url ?? "").trim(),
      free: coerceFree(t.free),
      why: String(t.why ?? "").trim(),
      note: String(t.note ?? "").trim(),
    };
    return { ok: true, draft };
  } catch {
    return { ok: false, error: "KI-Dienst gerade nicht erreichbar – bitte nochmal versuchen." };
  }
}
