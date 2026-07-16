import { cache } from "react";
import { createClient } from "./supabase/server";
import { routing } from "@/i18n/routing";
import { hashTexts, jsonbTranslationStatus, type TranslationState } from "./spot-hash";
import {
  startOfViennaDayIso,
  type EventCategory,
  type EventItem,
} from "./events-format";

// Reine Helfer (Typen, Gruppierung, Formatierung, Zeitzone) liegen in
// events-format.ts (client-sicher). Hier nur die serverseitigen DB-Reads.
export type { EventCategory, EventItem, EventDay } from "./events-format";
export { EVENT_CATEGORIES, groupByDay } from "./events-format";

type EventRow = {
  id: string;
  title: string;
  title_en: string | null;
  description: string | null;
  description_en: string | null;
  emoji: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location_name: string | null;
  category: EventCategory;
  is_highlight: boolean;
  is_free: boolean | null;
  source_url: string | null;
  image_url: string | null;
  translations?: Record<string, { title?: string; description?: string }> | null;
};

// "*" (statt fester Spaltenliste) -> robust, falls die translations-Spalte (0032) noch nicht
// existiert: sie fehlt dann einfach im Ergebnis, der Read fällt auf title/title_en zurück.
const SELECT = "*";

// Vor der Migration 0009 existiert die Tabelle noch nicht -> das ist KEIN echter
// Fehler, nur "noch nicht eingerichtet". Dann still `[]` liefern (kein Dev-Overlay).
function isTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

function mapEvent(row: EventRow, locale: string): EventItem {
  // Übersetzung aus translations[locale]; sonst alte EN-Spalte (Altdaten); sonst Deutsch.
  const t = (row.translations ?? {})[locale];
  const title =
    t?.title?.trim() || (locale === "en" ? row.title_en?.trim() : "") || row.title;
  const description =
    t?.description?.trim() ||
    (locale === "en" ? row.description_en?.trim() : "") ||
    row.description;
  return {
    id: row.id,
    title,
    description,
    emoji: row.emoji,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    locationName: row.location_name,
    category: row.category,
    isHighlight: row.is_highlight,
    isFree: Boolean(row.is_free),
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
  };
}

// ---- Öffentliche Wochenansicht ----------------------------------------------
// Veröffentlichte Events, die noch NICHT VORBEI sind (Auto-Ablauf, docs/29 §3) —
// vorbei = für den User sinnlos, verschwindet sofort:
//   - Event MIT Endzeit -> sichtbar bis ends_at (verschwindet direkt nach dem Ende).
//   - Event OHNE Endzeit / ganztägig -> Ende unbekannt, bleibt bis Tagesende
//     (startet heute oder später), fällt um Mitternacht (Wiener Zeit) raus.
//   - Mehrtägig -> bis zum letzten Tag (ends_at in der Zukunft).
// Rein serverseitig gefiltert -> kein Aufräum-Job, lädt schlank. Nichts wird gelöscht.
export const getUpcomingEvents = cache(async function getUpcomingEvents(
  locale: string,
): Promise<EventItem[]> {
  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const startOfToday = startOfViennaDayIso(now);

  const { data, error } = await supabase
    .from("events")
    .select(SELECT)
    .eq("status", "published")
    .or(`ends_at.gte.${nowIso},and(ends_at.is.null,starts_at.gte.${startOfToday})`)
    .order("starts_at", { ascending: true });

  if (error) {
    if (!isTableMissing(error)) console.error("getUpcomingEvents:", error.message);
    return [];
  }
  return (data ?? []).map((r) => mapEvent(r as EventRow, locale));
});

// ---- Gespeicherte Events (User-Merkliste, eigene Tabelle saved_events) -------
// IDs der gespeicherten Events + Login-Status (für den Bookmark-Zustand in der Liste).
export async function getSavedEventIds(): Promise<{
  loggedIn: boolean;
  ids: string[];
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { loggedIn: false, ids: [] };
  const { data, error } = await supabase
    .from("saved_events")
    .select("event_id");
  if (error) {
    if (!isTableMissing(error)) console.error("getSavedEventIds:", error.message);
    return { loggedIn: true, ids: [] };
  }
  return { loggedIn: true, ids: (data ?? []).map((r) => r.event_id) };
}

// Gespeicherte, NOCH nicht vergangene Events des Users (null = nicht eingeloggt).
// Gleicher Auto-Ablauf-Filter wie die öffentliche Ansicht -> vergangene fallen
// automatisch aus der Merkliste. Events erscheinen NICHT auf der Karte.
export async function getSavedEvents(
  locale: string,
): Promise<EventItem[] | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: items, error: itemsErr } = await supabase
    .from("saved_events")
    .select("event_id");
  if (itemsErr) {
    if (!isTableMissing(itemsErr)) console.error("getSavedEvents:", itemsErr.message);
    return [];
  }
  const ids = (items ?? []).map((i) => i.event_id);
  if (ids.length === 0) return [];

  const now = new Date();
  const nowIso = now.toISOString();
  const startOfToday = startOfViennaDayIso(now);
  // Gleiche Regel wie die öffentliche Ansicht: vorbei -> raus aus der Merkliste.
  const { data, error } = await supabase
    .from("events")
    .select(SELECT)
    .in("id", ids)
    .eq("status", "published")
    .or(`ends_at.gte.${nowIso},and(ends_at.is.null,starts_at.gte.${startOfToday})`)
    .order("starts_at", { ascending: true });
  if (error) {
    if (!isTableMissing(error)) console.error("getSavedEvents:", error.message);
    return [];
  }
  return (data ?? []).map((r) => mapEvent(r as EventRow, locale));
}

// ---- Admin-Reads (alle Status; RLS-Admin erlaubt) ---------------------------
export type AdminEventRow = {
  id: string;
  title: string;
  category: EventCategory;
  isHighlight: boolean;
  status: "draft" | "published";
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  locationName: string | null;
  isPast: boolean; // Tag vorbei? (gleiche Regel wie die öffentliche Auto-Ablauf-Logik)
  whenLabel: string; // server-seitig vorformatiert (kein Intl im Client -> kein Hydration-Mismatch)
  trPresent: number;
  trTotal: number;
  trState: TranslationState;
};

// Datums-/Zeit-Label serverseitig formatieren (de-AT, Wien). Bewusst hier statt im
// Client: Node- und Browser-ICU liefern bei weekday:"short" leicht anders ("Mo.," vs "Mo.").
const adminDayFmt = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});
const adminTimeFmt = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  hour: "2-digit",
  minute: "2-digit",
});
function adminWhenLabel(startsAt: string, allDay: boolean): string {
  const d = new Date(startsAt);
  const base = adminDayFmt.format(d);
  return allDay ? `${base} · ganztägig` : `${base} · ${adminTimeFmt.format(d)}`;
}

// Liste fürs Admin-Dashboard: chronologisch, letzte 30 Tage + alles Zukünftige
// (bleibt relevant & bounded, egal wie viel Historie in der DB liegt). Zeigt
// bewusst auch Drafts (KI-Wochenrecherche) + jüngst vergangene Events zur Kontrolle.
// Pro Event isPast (server-berechnet -> mismatch-frei) für die Trennung
// „kommend" vs. „vorbei" in der Admin-Liste.
export async function getAdminEvents(): Promise<AdminEventRow[]> {
  const supabase = await createClient();
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
  // "*" -> robust vor Migration 0032 (translations/source_hash-Spalten fehlen dann einfach).
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .gte("starts_at", cutoff)
    .order("starts_at", { ascending: true });
  if (error) {
    if (!isTableMissing(error)) console.error("getAdminEvents:", error.message);
    return [];
  }

  const targets = routing.locales.filter((l) => l !== "de");
  const nowMs = now.getTime();
  const startOfTodayMs = Date.parse(startOfViennaDayIso(now));
  return (data ?? []).map((r) => {
    // Identisch zur öffentlichen Ansicht (Admin „vorbei" = live ausgeblendet):
    //  - mit Endzeit: sichtbar bis ends_at · ohne Endzeit: bis Tagesende.
    const upcoming =
      r.ends_at != null
        ? Date.parse(r.ends_at) >= nowMs
        : Date.parse(r.starts_at) >= startOfTodayMs;
    return {
      id: r.id,
      title: r.title,
      category: r.category,
      isHighlight: r.is_highlight,
      status: r.status,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      allDay: r.all_day,
      locationName: r.location_name,
      isPast: !upcoming,
      whenLabel: adminWhenLabel(r.starts_at, r.all_day),
      ...(() => {
        const deHash = hashTexts([r.title, r.description]);
        const st = jsonbTranslationStatus(r.translations, r.source_hash, deHash, targets);
        return { trPresent: st.present, trTotal: st.total, trState: st.state };
      })(),
    };
  });
}

// Log der KI-Wochenrecherche (welche Kalenderwoche wurde wann gesucht).
export type ResearchLogRow = {
  weekStart: string; // Montag (YYYY-MM-DD)
  researchedAt: string; // ISO
  inserted: number;
  skipped: number;
};

export async function getResearchLog(): Promise<ResearchLogRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_research_log")
    .select("week_start, researched_at, inserted, skipped")
    .order("week_start", { ascending: true });
  if (error) {
    if (!isTableMissing(error)) console.error("getResearchLog:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    weekStart: r.week_start,
    researchedAt: r.researched_at,
    inserted: r.inserted,
    skipped: r.skipped,
  }));
}

// Ein Event zum Bearbeiten laden (Rohdaten inkl. Übersetzungen + Status).
export type EventEditRow = EventRow & {
  status: "draft" | "published";
  source_hash?: string | null;
};

export async function getEventForEdit(id: string): Promise<EventEditRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as EventEditRow;
}
