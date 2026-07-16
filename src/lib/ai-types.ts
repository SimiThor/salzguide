// Client-sichere Typen für den KI-Assistenten (KEIN Server-Import) -> dürfen im
// Browser-Bundle landen (Chat-Sheet, Verlauf). EventItem kommt aus events-format
// (ebenfalls client-sicher).
import type { EventItem } from "./events-format";

export type AiSpotCard = {
  slug: string;
  title: string;
  shortDesc: string | null;
  emoji: string | null;
  imageUrl: string | null;
  type: "activity" | "food";
};

// Aktuelle Wassertemperatur eines Sees (aus unseren offiziellen Datenquellen).
export type WaterReading = { name: string; slug: string; tempC: number; at: string };

// Anfahrts-Widget: fertige Google-Maps-Links (Auto/Öffis) zu einem Spot.
export type AiDirections = {
  slug: string;
  name: string;
  recommendation: "auto" | "oeffis" | "beides";
  carUrl: string | null;
  transitUrl: string | null;
};

// Wetter-Widget: nur die relevanten Tage (heute/morgen) für einen Spot.
export type AiWeatherDay = {
  date: string;
  code: number; // WMO-Wettercode
  maxC: number;
  minC: number;
  rainProbPct: number;
};
export type AiWeather = { slug: string | null; name: string; days: AiWeatherDay[] };

// Öffnungszeiten-Widget: aktueller Status + heutige Zeiten (gecacht). source =
// 'google' -> „Powered by Google"-Attribution nötig; 'manual' -> ohne.
export type AiOpening = {
  slug: string;
  name: string;
  openNow: boolean;
  todayHours: string;
  source: "google" | "manual";
};

// Karten/Widgets, die Toni zu einer Antwort zeigt.
export type AiCards = {
  spots: AiSpotCard[];
  events: EventItem[];
  water?: WaterReading[];
  directions?: AiDirections;
  weather?: AiWeather;
  opening?: AiOpening;
};

// Eine reine Textnachricht (Verlauf an die KI geschickt).
export type AiChatMessage = { role: "user" | "assistant"; content: string };

// Eine Nachricht, wie sie das UI rendert (Text + zugehörige Karten).
export type AiUiMessage = {
  role: "user" | "assistant";
  text: string;
  cards: AiCards;
};

// Merk-Status + Callbacks, die der Chat an die Karten reicht (nur clientseitig,
// nie serialisiert) -> Karten zeigen den ECHTEN Speicher-Zustand, auch nach Reopen.
export type SavedApi = {
  spots: Set<string>;
  events: Set<string>;
  onSpot: (slug: string, saved: boolean) => void;
  onEvent: (id: string, saved: boolean) => void;
};
