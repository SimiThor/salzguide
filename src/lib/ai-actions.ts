"use server";

// Server-Actions rund um den KI-Verlauf. Lesen läuft über den Session-Client
// (RLS -> nur die eigenen Konversationen). Geschrieben wird der Verlauf in der
// Chat-Route (Service-Client), hier nur der Abruf beim Öffnen des Sheets.
//
// Die eigentlichen Abfragen stehen in ai-history.ts: Die App liest denselben Verlauf über
// /api/app/v1/toni/conversations, mit dem Bearer- statt dem Cookie-Client.
import { createClient } from "./supabase/server";
import { listConversations, loadConversation, loadLatestConversation } from "./ai-history";
import type { AiConversationMeta, AiHistory } from "./ai-types";

// KEIN `export type { … }` hier: Ein "use server"-Modul darf nur async-Funktionen exportieren,
// der Actions-Lader von Next hält einen Typ-Re-Export sonst für eine Funktion und bricht jede
// Seite mit „AiConversationMeta is not defined“ (gesehen 21.11.2026). Die Typen stehen in
// ai-types.ts.

// Letzten Chat-Verlauf des eingeloggten Users laden (für „weitermachen"). Gast
// oder Fehler (z.B. Tabelle vor Migration 0015) -> null / leer, App bleibt heil.
export async function loadAiHistory(): Promise<AiHistory | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return loadLatestConversation(supabase);
}

// Liste der gespeicherten Chats des eingeloggten Users (für „alte Chats ansehen").
// RLS -> nur eigene. Gast/Fehler -> [].
export async function listAiConversations(): Promise<AiConversationMeta[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  return listConversations(supabase);
}

// Einen bestimmten gespeicherten Chat laden (RLS stellt Eigentum sicher).
export async function loadAiConversation(id: string): Promise<AiHistory | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return loadConversation(supabase, id);
}
