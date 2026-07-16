"use server";

// Server-Actions rund um den KI-Verlauf. Lesen läuft über den Session-Client
// (RLS -> nur die eigenen Konversationen). Geschrieben wird der Verlauf in der
// Chat-Route (Service-Client), hier nur der Abruf beim Öffnen des Sheets.
import { createClient } from "./supabase/server";
import type { AiCards, AiUiMessage } from "./ai-types";

function normalizeCards(raw: unknown): AiCards {
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

export type AiHistory = {
  conversationId: string | null;
  messages: AiUiMessage[];
};

// Letzten Chat-Verlauf des eingeloggten Users laden (für „weitermachen"). Gast
// oder Fehler (z.B. Tabelle vor Migration 0015) -> null / leer, App bleibt heil.
export async function loadAiHistory(): Promise<AiHistory | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: convs, error: convErr } = await supabase
    .from("ai_conversations")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (convErr) return { conversationId: null, messages: [] };

  const conversationId = convs?.[0]?.id ?? null;
  if (!conversationId) return { conversationId: null, messages: [] };

  const { data: rows, error: msgErr } = await supabase
    .from("ai_messages")
    .select("role, content, cards")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (msgErr) return { conversationId, messages: [] };

  const messages: AiUiMessage[] = (rows ?? []).map((r) => ({
    role: r.role === "assistant" ? "assistant" : "user",
    text: (r.content as string) ?? "",
    cards: normalizeCards(r.cards),
  }));
  return { conversationId, messages };
}

export type AiConversationMeta = { id: string; title: string; updatedAt: string };

// Liste der gespeicherten Chats des eingeloggten Users (für „alte Chats ansehen").
// RLS -> nur eigene. Gast/Fehler -> [].
export async function listAiConversations(): Promise<AiConversationMeta[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) return [];
  return (data ?? []).map((c) => ({
    id: c.id as string,
    title: ((c.title as string | null) ?? "").trim() || "Chat",
    updatedAt: c.updated_at as string,
  }));
}

// Einen bestimmten gespeicherten Chat laden (RLS stellt Eigentum sicher).
export async function loadAiConversation(id: string): Promise<AiHistory | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Eigentum prüfen (RLS würde ohnehin schützen; explizit für saubere Rückgabe).
  const { data: conv } = await supabase
    .from("ai_conversations")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!conv) return null;

  const { data: rows } = await supabase
    .from("ai_messages")
    .select("role, content, cards")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  const messages: AiUiMessage[] = (rows ?? []).map((r) => ({
    role: r.role === "assistant" ? "assistant" : "user",
    text: (r.content as string) ?? "",
    cards: normalizeCards(r.cards),
  }));
  return { conversationId: id, messages };
}
