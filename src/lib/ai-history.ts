import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiCards, AiConversationMeta, AiHistory, AiUiMessage } from "./ai-types";

// Toni-Verlauf lesen: EINE Quelle für Web (Server-Actions in ai-actions.ts, Cookie-Client) und
// App (/api/app/v1/toni/conversations, Bearer-Client). Beide übergeben den Client des
// Betrachters, die RLS (0015: ai_conversations_own / ai_messages_own) liefert nur eigene Chats.
// Geschrieben wird der Verlauf woanders (persistTurn in ai-chat-core.ts, Service-Client).

/** So viele Chats zeigt die Liste „Frühere Chats“. */
export const AI_HISTORY_LIST_LIMIT = 30;

/**
 * Gespeicherte Karten wieder in die Form von AiCards bringen. Die Spalte ist jsonb und hat
 * über die Zeit Felder dazubekommen (water, directions, weather, opening; seit 11/2026 auch
 * gesperrte Spot-Karten mit `locked`/`previewUrl`). Spot- und Event-Einträge gehen unverändert
 * durch, damit neue Felder nicht hier verloren gehen.
 */
export function normalizeCards(raw: unknown): AiCards {
  const c = (raw ?? {}) as {
    spots?: unknown;
    events?: unknown;
    water?: unknown;
    directions?: unknown;
    weather?: unknown;
    opening?: unknown;
  };
  const weather = c.weather as { days?: unknown } | null | undefined;
  return {
    spots: Array.isArray(c.spots) ? (c.spots as AiCards["spots"]) : [],
    events: Array.isArray(c.events) ? (c.events as AiCards["events"]) : [],
    water: Array.isArray(c.water) ? (c.water as AiCards["water"]) : undefined,
    directions:
      c.directions && typeof c.directions === "object"
        ? (c.directions as AiCards["directions"])
        : undefined,
    weather:
      weather && typeof weather === "object" && Array.isArray(weather.days)
        ? (weather as AiCards["weather"])
        : undefined,
    opening:
      c.opening && typeof c.opening === "object"
        ? (c.opening as AiCards["opening"])
        : undefined,
  };
}

/** Die letzten Chats, neueste zuerst. Fehler (etwa vor Migration 0015) -> leere Liste. */
export async function listConversations(db: SupabaseClient): Promise<AiConversationMeta[]> {
  const { data, error } = await db
    .from("ai_conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(AI_HISTORY_LIST_LIMIT);
  if (error) return [];
  return (data ?? []).map((c) => ({
    id: c.id as string,
    title: ((c.title as string | null) ?? "").trim() || "Chat",
    updatedAt: c.updated_at as string,
  }));
}

/** Die Nachrichten eines Chats in Reihenfolge. */
async function loadMessages(db: SupabaseClient, conversationId: string): Promise<AiUiMessage[]> {
  const { data, error } = await db
    .from("ai_messages")
    .select("role, content, cards")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []).map((r) => ({
    role: r.role === "assistant" ? "assistant" : "user",
    text: (r.content as string) ?? "",
    cards: normalizeCards(r.cards),
  }));
}

/**
 * Einen bestimmten Chat laden. null, wenn es ihn für diesen Betrachter nicht gibt (fremd,
 * gelöscht, kaputte ID). Die Eigentumsprüfung macht die RLS; die Abfrage vorher sorgt nur für
 * eine saubere Antwort statt einer leeren Nachrichtenliste.
 */
export async function loadConversation(
  db: SupabaseClient,
  id: string,
): Promise<AiHistory | null> {
  const { data: conv, error } = await db
    .from("ai_conversations")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error || !conv) return null;
  return { conversationId: id, messages: await loadMessages(db, id) };
}

/** Den jüngsten Chat laden (Web: „weitermachen“ beim Öffnen). */
export async function loadLatestConversation(db: SupabaseClient): Promise<AiHistory> {
  const { data, error } = await db
    .from("ai_conversations")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1);
  const conversationId = error ? null : (data?.[0]?.id as string | undefined) ?? null;
  if (!conversationId) return { conversationId: null, messages: [] };
  return { conversationId, messages: await loadMessages(db, conversationId) };
}
