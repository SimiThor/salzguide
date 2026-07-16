// Geräte-lokaler Zwischenspeicher des aktuellen Toni-Chats (localStorage).
// Zweck: Der Chat ist beim Wieder-Öffnen SOFORT da (kein Flackern, kein Laden des
// Standard-Screens). Rein funktional/notwendig für den vom Nutzer aktiv genutzten
// Dienst (wie ein offener Warenkorb) -> kein Tracking, kein Consent-Banner nötig.
// Nichts verlässt das Gerät; „Neuer Chat" und Logout löschen es.
import type { AiUiMessage } from "./ai-types";

const KEY = "sg_toni_chat_v1";
const MAX_MESSAGES = 50;
const MAX_BYTES = 200_000;

export type ToniChat = { conversationId: string | null; messages: AiUiMessage[] };

export function readToniChat(): ToniChat | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ToniChat;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    const messages = parsed.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
      .map((m) => ({
        role: m.role,
        text: m.text,
        cards: {
          spots: Array.isArray(m.cards?.spots) ? m.cards.spots : [],
          events: Array.isArray(m.cards?.events) ? m.cards.events : [],
          water: Array.isArray(m.cards?.water) ? m.cards.water : undefined,
          directions:
            m.cards?.directions && typeof m.cards.directions === "object"
              ? m.cards.directions
              : undefined,
          weather:
            m.cards?.weather && Array.isArray(m.cards.weather.days)
              ? m.cards.weather
              : undefined,
          opening:
            m.cards?.opening && typeof m.cards.opening === "object"
              ? m.cards.opening
              : undefined,
        },
      }));
    return { conversationId: parsed.conversationId ?? null, messages };
  } catch {
    return null;
  }
}

export function writeToniChat(chat: ToniChat): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed: ToniChat = {
      conversationId: chat.conversationId ?? null,
      messages: chat.messages.slice(-MAX_MESSAGES),
    };
    const raw = JSON.stringify(trimmed);
    if (raw.length > MAX_BYTES) return; // zu groß -> lieber nicht speichern
    window.localStorage.setItem(KEY, raw);
  } catch {
    /* Speicher voll/blockiert -> ignorieren */
  }
}

export function clearToniChat(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
