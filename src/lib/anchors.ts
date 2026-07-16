// Datenschicht für die Event-Anker (jährliche Pflicht-Highlights).
// - Research liest über den SERVICE-Client (umgeht RLS, läuft auch im Cron) mit
//   Fallback auf die eingebaute Konstante (falls die Tabelle noch nicht migriert ist).
// - Das Admin-Panel liest über den Session-Client (RLS: nur Admin).

import { createClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";
import {
  ANCHOR_EVENTS,
  anchorsForMonths,
  type AnchorEvent,
} from "./event-anchors";
import type { EventCategory } from "./events-format";

const FREE = new Set(["ja", "nein", "teils"]);

type AnchorRow = {
  name?: string;
  category?: string;
  region?: string;
  months?: number[];
  timing?: string;
  url?: string;
  free?: string;
  why?: string;
  note?: string | null;
};

function rowToAnchor(r: AnchorRow): AnchorEvent {
  return {
    key: "",
    name: (r.name ?? "").trim(),
    category: (r.category as EventCategory) ?? "kultur",
    region: (r.region ?? "").trim() || "ganzes Land",
    months: Array.isArray(r.months) ? r.months : [],
    timing: (r.timing ?? "").trim(),
    url: (r.url ?? "").trim(),
    free: FREE.has(r.free ?? "") ? (r.free as AnchorEvent["free"]) : "nein",
    why: (r.why ?? "").trim(),
    note: r.note ? r.note.trim() : undefined,
  };
}

// Aktive Anker, deren Monats-Zeitfenster einen der Zielwochen-Monate berührt.
// Fällt auf die eingebaute Liste zurück, wenn die Tabelle (noch) fehlt/Fehler wirft
// -> der Anker-Check funktioniert auch schon VOR der Migration.
export async function getActiveAnchorsForMonths(
  months: number[],
): Promise<AnchorEvent[]> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("event_anchors")
      .select("name, category, region, months, timing, url, free, why, note")
      .eq("active", true)
      .overlaps("months", months)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) return anchorsForMonths(months); // Tabelle fehlt -> Fallback
    return (data ?? []).map(rowToAnchor);
  } catch {
    return anchorsForMonths(months);
  }
}

// Admin-Liste: ALLE Anker (auch inaktive), für die Verwaltung im Panel.
export type AdminAnchorRow = {
  id: string;
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

export async function getAdminAnchors(): Promise<AdminAnchorRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_anchors")
    .select(
      "id, key, name, category, region, months, timing, url, free, why, note, active, sort_order",
    )
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  // Tabelle noch nicht migriert -> leere Liste (Admin zeigt Hinweis).
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    category: (r.category as EventCategory) ?? "kultur",
    region: r.region ?? "",
    months: Array.isArray(r.months) ? r.months : [],
    timing: r.timing ?? "",
    url: r.url ?? "",
    free: FREE.has(r.free) ? (r.free as "ja" | "nein" | "teils") : "nein",
    why: r.why ?? "",
    note: r.note ?? "",
    active: Boolean(r.active),
  }));
}

// Zählt die Anker (um im Admin einen „Standard-Set laden"-Hinweis zu steuern).
export function defaultAnchorCount(): number {
  return ANCHOR_EVENTS.length;
}
