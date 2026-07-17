"use server";

import { fetchWithRetry, safeJsonParse } from "./ai-fetch";
import { BRAND_VOICE } from "./brand-voice";
import { stripEmDashFields } from "./em-dash";
import { routing } from "@/i18n/routing";
import { hashTexts, translationsPublishable } from "./spot-hash";
import { runWeekResearch, type WeekResult } from "./event-research";
import {
  EVENT_CATEGORIES,
  viennaDayKey,
  type EventCategory,
} from "./events-format";
import {
  translateEventTextsWith,
  translateEventTo,
  type EventTexts,
  type EventTranslateAllResult,
} from "./event-translate";
import { requireAdmin } from "./admin-guard";

export type { EventTexts, EventTranslateAllResult } from "./event-translate";
export type EventInput = {
  id?: string;
  title: string;
  description: string;
  // Übersetzungen je Sprache (locale -> {title, description}); DE bleibt in title/description.
  translations: Record<string, EventTexts>;
  translationsSourceHash?: string;
  emoji: string;
  startsAt: string; // ISO (UTC)
  endsAt: string | null; // ISO (UTC) oder null
  allDay: boolean;
  locationName: string;
  category: EventCategory;
  isHighlight: boolean;
  isFree: boolean;
  sourceUrl: string;
  imageUrl: string;
  status: "draft" | "published";
};

export type EventSaveResult = { ok: boolean; id?: string; error?: string };

const e = (v: string) => (v.trim() === "" ? null : v.trim());


const isoOrNull = (v: string | null): string | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export async function saveEvent(input: EventInput): Promise<EventSaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  if (!input.title.trim()) return { ok: false, error: "required" };
  // Übersetzungen sind optional (fehlende Sprache fällt öffentlich auf Deutsch zurück).
  const startsAt = isoOrNull(input.startsAt);
  if (!startsAt) return { ok: false, error: "start_required" };
  const endsAt = isoOrNull(input.endsAt);
  // Endzeit darf nicht vor dem Start liegen (sonst ignorieren -> null).
  const endClean = endsAt && Date.parse(endsAt) >= Date.parse(startsAt) ? endsAt : null;

  // Übersetzungen (nur Sprachen mit Inhalt). EN zusätzlich in die Alt-Spalten (Rückwärts-
  // kompatibel, falls Migration 0032 noch nicht eingespielt ist).
  const translations: Record<string, EventTexts> = {};
  for (const [l, tx] of Object.entries(input.translations ?? {})) {
    if (l === "de" || !tx) continue;
    const title = (tx.title ?? "").trim();
    const description = (tx.description ?? "").trim();
    if (title || description) translations[l] = { title, description };
  }
  const enTx = input.translations?.en;

  // Veröffentlichen-Gate (Anti-Chaos): live gehen darf ein Event NUR, wenn es in ALLE Sprachen
  // übersetzt UND aktuell ist. Geprüft wird NUR der Übergang Entwurf->Veröffentlicht – ein bereits
  // live Event bleibt frei editierbar. Entwurf speichern ist immer erlaubt.
  if (input.status === "published") {
    let wasPublished = false;
    if (input.id) {
      const { data: cur } = await supabase
        .from("events")
        .select("status")
        .eq("id", input.id)
        .maybeSingle();
      wasPublished = (cur as { status?: string } | null)?.status === "published";
    }
    if (!wasPublished) {
      const targets = routing.locales.filter((l) => l !== "de");
      const deHashGate = hashTexts([input.title, input.description]);
      if (!translationsPublishable(translations, input.translationsSourceHash, deHashGate, targets))
        return { ok: false, error: "translations_incomplete" };
    }
  }

  const row = {
    title: input.title.trim(),
    title_en: e(enTx?.title ?? ""),
    description: e(input.description),
    description_en: e(enTx?.description ?? ""),
    emoji: e(input.emoji),
    starts_at: startsAt,
    ends_at: endClean,
    all_day: input.allDay,
    location_name: e(input.locationName),
    category: input.category,
    is_highlight: input.isHighlight,
    is_free: input.isFree,
    source_url: e(input.sourceUrl),
    image_url: e(input.imageUrl),
    status: input.status,
  };

  let eventId = input.id;
  if (eventId) {
    const { error } = await supabase.from("events").update(row).eq("id", eventId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabase.from("events").insert(row).select("id").single();
    if (error) return { ok: false, error: error.message };
    eventId = data.id;
  }

  // translations (JSONB) + source_hash NACHTRÄGLICH & fehlertolerant (Migration 0032):
  // existieren die Spalten noch nicht, scheitert nur DAS – nicht das Event.
  {
    const deHash = hashTexts([input.title, input.description]);
    const { error: te } = await supabase
      .from("events")
      .update({ translations, source_hash: input.translationsSourceHash ?? deHash })
      .eq("id", eventId);
    if (te) {
      console.warn("event translations übersprungen – Migration 0032 nötig?", te.message);
      // Beim VERÖFFENTLICHEN darf kein Event live+unübersetzt zurückbleiben -> auf Entwurf zurück.
      if (input.status === "published") {
        await supabase.from("events").update({ status: "draft" }).eq("id", eventId);
        return { ok: false, error: "translations_persist_failed" };
      }
    }
  }
  return { ok: true, id: eventId };
}

export async function deleteEvent(id: string): Promise<EventSaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { error } = await gate.supabase.from("events").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// 1-Klick veröffentlichen / zurück auf Entwurf (Admin-Liste).
export async function setEventStatus(
  id: string,
  status: "draft" | "published",
): Promise<EventSaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  // Veröffentlichen-Gate AUCH hier (dieser Weg umgeht sonst saveEvent!): live NUR mit
  // vollständigen, aktuellen Übersetzungen. Wir lesen dafür das Event neu. Fail-closed:
  // im Zweifel NICHT veröffentlichen.
  if (status === "published") {
    const withTr = await gate.supabase
      .from("events")
      .select("title, description, translations, source_hash")
      .eq("id", id)
      .maybeSingle();
    if (withTr.error) {
      // Fehlen die Übersetzungs-Spalten (vor Migration 0032), ist das Gate nicht anwendbar
      // (Events sind dann ohnehin nur DE/EN) -> überspringen. JEDER andere Fehler: fail-closed.
      const code = (withTr.error as { code?: string }).code;
      const missingCols =
        code === "42703" || /column .* does not exist/i.test(withTr.error.message ?? "");
      if (!missingCols) return { ok: false, error: "check_failed" };
    } else if (!withTr.data) {
      return { ok: false, error: "not_found" };
    } else {
      const ev = withTr.data as {
        title?: string;
        description?: string | null;
        translations?: Record<string, { title?: string }> | null;
        source_hash?: string | null;
      };
      const targets = routing.locales.filter((l) => l !== "de");
      const deHash = hashTexts([ev.title ?? "", ev.description ?? ""]);
      if (!translationsPublishable(ev.translations, ev.source_hash, deHash, targets))
        return { ok: false, error: "translations_incomplete" };
    }
  }

  const { error } = await gate.supabase
    .from("events")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id };
}

// Manueller Auslöser der Wochenrecherche aus dem Admin (Admin-gated).
// weekOffset: 0 = aktuelle, 1 = nächste, 2 = übernächste Woche.
export async function runWeekResearchNow(
  weekOffset: number,
): Promise<WeekResult> {
  const gate = await requireAdmin();
  if (!gate.ok)
    return { ok: false, inserted: 0, skipped: 0, weekStart: "", error: gate.error };
  return runWeekResearch(weekOffset);
}

// ---- KI: Einzel-Event recherchieren & Felder füllen (docs/29 §4) ------------
// Datetime-local ("YYYY-MM-DDTHH:mm", Wiener Wandzeit) sauber normalisieren.
function normWall(v: unknown): string {
  if (typeof v !== "string") return "";
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : "";
}
function coerceCategory(v: unknown): EventCategory {
  return EVENT_CATEGORIES.includes(v as EventCategory)
    ? (v as EventCategory)
    : "kultur";
}

export type EventDraft = {
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  category: EventCategory;
  emoji: string;
  startsAt: string; // "YYYY-MM-DDTHH:mm" (Wiener Wandzeit, datetime-local)
  endsAt: string; // dito oder ""
  allDay: boolean;
  isFree: boolean;
  locationName: string;
  sourceUrl: string;
};
export type EventDraftResult = {
  ok: boolean;
  draft?: EventDraft;
  sources?: string[];
  error?: string;
};

const AI_HEADERS = (key: string) => ({
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
});

// Schritt 1: Web-Recherche zu EINEM Event (Server-Tool web_search).
async function researchEvent(
  query: string,
  today: string,
  key: string,
): Promise<{ research: string; sources: string[] } | null> {
  const system = `Du recherchierst EIN konkretes Event/Veranstaltung im Land Salzburg (Österreich). Heute ist ${today}. Suche im Web nach belegten Fakten: exakter Titel, exaktes Datum + KONKRETE Uhrzeit (Beginn, ggf. Ende) – NICHT nur "ganztägig", such gezielt nach der Startzeit. Bei MEHRTÄGIGEN Events (Festivals): alle Tage von–bis + die Uhrzeiten (volle Spanne). Ort/Location (Name, ggf. Adresse/Ort), worum es geht, Kategorie (Party/Tradition/Kultur/Kids) und die OFFIZIELLE Quelle-URL.
QUELLE: Finde die KONKRETE Event-/Detailseite (die eigene Unterseite genau DIESES Events beim Veranstalter/der Location – mit Datum, Programm, Tickets/Infos). NICHT eine allgemeine Veranstaltungskalender-/Übersichts-/Startseite (z.B. NICHT die Kalender-Startseite von salzburg.info, stadt-salzburg.at, salzburgerland.com) und NICHT Fremd-Eventkalender/Aggregatoren (wasmachma.at, meinbezirk.at, eventfinder, regiondo, ticketmaster, oeticket, eventbrite, facebook). Steht das Event nur in einem Kalender, nimm den DEEP-LINK zum einzelnen Event-Eintrag. Wenn eine URL gegeben ist, beziehe dich primär darauf.
Fasse NUR Belegtes knapp in deutschen Stichpunkten zusammen (mit offizieller Quelle). Erfinde nichts. Findest du Datum/Uhrzeit nicht sicher, sag das offen.`;

  let messages: { role: string; content: unknown }[] = [
    { role: "user", content: `Recherchiere dieses Event: ${query}` },
  ];
  let last: {
    stop_reason?: string;
    content?: {
      type: string;
      text?: string;
      url?: string;
      content?: { url?: string }[];
    }[];
  } | null = null;

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
  if (!last) return null;

  const research = (last.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  const sources: string[] = [];
  for (const b of last.content ?? []) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) sources.push(r.url);
    }
  }
  if (!research) return null;
  return { research, sources: [...new Set(sources)] };
}

export async function generateEventDraft(
  query: string,
): Promise<EventDraftResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  if (!query.trim())
    return { ok: false, error: "Bitte einen Link oder ein Stichwort eingeben." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  const today = viennaDayKey(new Date().toISOString());
  const r = await researchEvent(query.trim(), today, key);
  if (!r)
    return {
      ok: false,
      error:
        "Keine belegten Infos gefunden – Link/Stichwort präzisieren oder Anthropic-Guthaben prüfen.",
    };

  const system = `${BRAND_VOICE}

AUFGABE: Extrahiere aus der Recherche die Felder EINES Events und gib sie AUSSCHLIESSLICH über das Tool "event_draft" zurück.
- title: exakter Event-Titel.
- description: 1–2 Sätze im SalzGuide-Ton, worum es geht (nur belegte Fakten).
- title_en, description_en: natürliche ENGLISCHE Übersetzung (kurz, sinngemäß, Eigennamen behalten).
- category: party | tradition | kultur | sport | kids (beste Einordnung; ALLES Sportliche/Outdoor/Motorsport/Läufe/Ski = sport).
- is_free: true NUR, wenn der Eintritt nachweislich GRATIS ist; bei Ticket/Startgeld/teilweise-frei false. Im Zweifel false.
- emoji: EIN passendes Emoji.
- start / end: "YYYY-MM-DDTHH:mm" in WIENER Zeit. Heute ist ${today}. Verwende IMMER die KONKRETE Uhrzeit (Beginn; wenn bekannt Ende). Bei MEHRTÄGIGEN Events die VOLLE Spanne: start = erster Tag + Startzeit, end = letzter Tag + Endzeit.
- all_day: FAST IMMER false. Nur true bei einem ECHTEN Ganztags-Format OHNE Anfangszeit (Markt/Ausstellung). Konzert/Kino/Vorstellung/Party MIT Startzeit ist NIEMALS ganztägig -> konkrete Startzeit.
- location_name: Location/Ort (z. B. "Residenzplatz, Salzburg").
- source_url: die KONKRETE Event-/Detailseite (eigene Unterseite genau dieses Events beim Veranstalter/der Location, mit Datum/Programm/Tickets) – NICHT eine allgemeine Veranstaltungskalender-/Übersichts-/Startseite und KEIN Fremd-Eventkalender/Aggregator. Lieber die tiefe Event-Unterseite als eine generische Kalender-URL.
GROUNDING: NUR recherchierte Fakten. Datum/Uhrzeit nicht sicher? -> all_day=true bzw. Feld leer, nichts erfinden.`;

  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: AI_HEADERS(key),
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          system,
          messages: [
            {
              role: "user",
              content: `RECHERCHE (belegte Fakten):\n${r.research}\n\nGefundene Quellen:\n${r.sources.join("\n") || "—"}`,
            },
          ],
          tools: [
            {
              name: "event_draft",
              description: "Die strukturierten Felder eines Events.",
              input_schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  title_en: { type: "string" },
                  description: { type: "string" },
                  description_en: { type: "string" },
                  category: {
                    type: "string",
                    enum: ["party", "tradition", "kultur", "sport", "kids"],
                  },
                  emoji: { type: "string" },
                  start: { type: "string" },
                  end: { type: "string" },
                  all_day: { type: "boolean" },
                  is_free: { type: "boolean" },
                  location_name: { type: "string" },
                  source_url: { type: "string" },
                },
                required: [
                  "title",
                  "description",
                  "category",
                  "start",
                  "all_day",
                  "location_name",
                ],
              },
            },
          ],
          tool_choice: { type: "tool", name: "event_draft" },
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
      (b: { type: string; name?: string }) =>
        b.type === "tool_use" && b.name === "event_draft",
    ) as { input?: unknown } | undefined;
    // Das Modell liefert input gelegentlich als (fast-valides) JSON-String -> reparieren.
    let raw: unknown = block?.input;
    if (typeof raw === "string") raw = safeJsonParse(raw);
    const t = raw as Record<string, unknown> | undefined;
    if (!t) return { ok: false, error: "Keine Event-Felder erhalten" };

    const draft: EventDraft = {
      // Der Prompt verbietet den Gedankenstrich, aber ein Prompt ist eine Bitte. Hier wird
      // er zum Zwang, bevor der Entwurf ins Formular und damit in die DB geht (em-dash.ts).
      // Nur die Fliesstext-Felder: sourceUrl ist eine URL, an der nichts zu säubern ist.
      // Ohne Locale, weil hier Deutsch und Englisch nebeneinander stehen und für beide
      // dasselbe gilt (ausgenommen wäre nur Chinesisch, das hier nicht vorkommt).
      ...stripEmDashFields({
        title: String(t.title ?? "").trim(),
        titleEn: String(t.title_en ?? "").trim(),
        description: String(t.description ?? "").trim(),
        descriptionEn: String(t.description_en ?? "").trim(),
        locationName: String(t.location_name ?? "").trim(),
      }),
      category: coerceCategory(t.category),
      emoji: String(t.emoji ?? "").trim(),
      startsAt: normWall(t.start),
      endsAt: normWall(t.end),
      allDay: Boolean(t.all_day),
      isFree: Boolean(t.is_free),
      sourceUrl:
        String(t.source_url ?? "").trim() || r.sources[0] || "",
    };
    return { ok: true, draft, sources: r.sources };
  } catch {
    return {
      ok: false,
      error: "KI-Dienst gerade nicht erreichbar – bitte nochmal versuchen.",
    };
  }
}

// ---- KI: DE -> EN Übersetzung (Titel + Beschreibung) ------------------------
export type EventTranslateResult = {
  ok: boolean;
  titleEn?: string;
  descriptionEn?: string;
  error?: string;
};

const EN_VOICE = `You translate SalzGuide event texts from German to natural English (Salzburg region, Austria).
STYLE: casual, direct, short sentences. Translate meaning, not word-for-word. Keep proper nouns, place names, dates and numbers exactly. Avoid travel-brochure clichés ("breathtaking", "hidden gem", "vibrant", "a must").
RULES: translate ONLY what is given, invent nothing. Empty source -> empty string.`;

export async function translateEventTexts(input: {
  title: string;
  description: string;
}): Promise<EventTranslateResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  if (!input.title.trim())
    return { ok: false, error: "Bitte zuerst einen deutschen Titel eingeben." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  const src = {
    title: input.title.trim(),
    description: input.description.trim(),
  };

  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: AI_HEADERS(key),
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 800,
          system: EN_VOICE,
          messages: [
            {
              role: "user",
              content: `Translate these German event fields to English and return them via the tool "event_texts_en". Keep empty fields empty.\n\n${JSON.stringify(
                src,
                null,
                2,
              )}`,
            },
          ],
          tools: [
            {
              name: "event_texts_en",
              description: "English translation of the event fields.",
              input_schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                },
                required: ["title", "description"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "event_texts_en" },
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
      (b: { type: string; name?: string }) =>
        b.type === "tool_use" && b.name === "event_texts_en",
    ) as { input?: Record<string, string> } | undefined;
    const t = block?.input;
    if (!t) return { ok: false, error: "Keine Übersetzung erhalten" };
    return {
      ok: true,
      // Auch hier erzwingen statt hoffen: Modelle setzen den Strich gerade beim
      // Übersetzen besonders gern (em-dash.ts).
      ...stripEmDashFields(
        {
          titleEn: t.title?.trim() || input.title.trim(),
          descriptionEn: input.description.trim() ? (t.description ?? "").trim() : "",
        },
        "en",
      ),
    };
  } catch {
    return {
      ok: false,
      error: "KI-Dienst gerade nicht erreichbar – bitte nochmal versuchen.",
    };
  }
}

// ---- KI: „In ALLE Sprachen übersetzen" (Events) -----------------------------
// Admin-Action: Gate + Key-Check, dann geteilter Übersetzungs-Kern (event-translate.ts).
export async function translateEventTextsAll(input: EventTexts): Promise<EventTranslateAllResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.title.trim())
    return { ok: false, error: "Bitte zuerst einen deutschen Titel eingeben." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };
  const r = await translateEventTextsWith(input, key);
  if (!r.ok)
    return {
      ok: false,
      error:
        r.error === "all_failed" || r.error === "empty"
          ? "Übersetzung fehlgeschlagen – bitte nochmal versuchen."
          : r.error,
    };
  return r;
}

// EIN Event „auffüllen": übersetzt NUR die fehlenden ODER veralteten Zielsprachen aus dem
// aktuellen Deutsch. Für den Sammel-Button in der Admin-Liste (spart Klicken je Event).
export async function fillEventTranslations(
  eventId: string,
): Promise<{ ok: boolean; filled?: number; failed?: string[]; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY fehlt" };

  const { data } = await gate.supabase
    .from("events")
    .select("title, description, translations, source_hash")
    .eq("id", eventId)
    .maybeSingle();
  if (!data) return { ok: false, error: "not_found" };
  const title = ((data.title as string | null) ?? "").trim();
  const description = ((data.description as string | null) ?? "").trim();
  if (!title) return { ok: false, error: "no_de" };

  const deHash = hashTexts([title, description]);
  const existing = ((data.translations as Record<string, { title?: string; description?: string }> | null) ??
    {}) as Record<string, { title?: string; description?: string }>;
  // Einzige source_hash-Marke: weicht sie ab -> ALLE Übersetzungen veraltet (alle neu).
  const stale = ((data.source_hash as string | null) ?? null) !== deHash;
  const targets = routing.locales.filter((l) => l !== "de");
  const needed = targets.filter((l) => stale || !(existing[l]?.title ?? "").trim());

  if (needed.length === 0) {
    await gate.supabase.from("events").update({ source_hash: deHash }).eq("id", eventId);
    return { ok: true, filled: 0 };
  }

  const results = await Promise.all(
    needed.map(async (l) => [l, await translateEventTo({ title, description }, l, key)] as const),
  );
  const merged: Record<string, { title: string; description: string }> = {};
  // Bestehende (nicht-nötige) Sprachen behalten.
  for (const [l, tx] of Object.entries(existing))
    if (tx?.title?.trim()) merged[l] = { title: tx.title, description: tx.description ?? "" };
  const failed: string[] = [];
  let filled = 0;
  for (const [l, tx] of results) {
    if (tx) {
      merged[l] = tx;
      filled++;
    } else {
      // Fehlschlag: veraltete Sprache NICHT als aktuell markieren -> entfernen (fehlt dann,
      // wird beim nächsten Lauf erneut versucht). Kein falsch-„aktuell".
      delete merged[l];
      failed.push(l);
    }
  }
  const { error } = await gate.supabase
    .from("events")
    .update({ translations: merged, source_hash: deHash })
    .eq("id", eventId);
  if (error) return { ok: false, error: "db" };
  return { ok: true, filled, failed: failed.length ? failed : undefined };
}
