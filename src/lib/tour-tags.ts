// Gemeinsames Themen-Tag-Vokabular: Interessen-Chips im KI-Runden-Builder (öffentlich,
// Labels via i18n Tours.chip.*) UND Punkt-Tags im Admin (Labels via TAG_LABELS_DE).
// Ein Ort -> Punkt-Tags und Interessen matchen sauber zusammen. Client-safe (keine
// Server-Imports), damit sowohl Client-Komponenten als auch Server-Actions es nutzen.
export const TAG_KEYS = [
  "history",
  "mozart",
  "legends",
  "architecture",
  "hidden",
  "food",
  "views",
  "art",
] as const;

export type TagKey = (typeof TAG_KEYS)[number];

export const TAG_LABELS_DE: Record<TagKey, string> = {
  history: "Geschichte",
  mozart: "Mozart & Musik",
  legends: "Sagen & Legenden",
  architecture: "Architektur",
  hidden: "Versteckte Ecken",
  food: "Kulinarik",
  views: "Aussicht",
  art: "Kunst",
};

// Emoji je Thema -> Chips (Builder & Admin) wirken sofort verständlich, iOS-verspielt.
export const TAG_EMOJI: Record<TagKey, string> = {
  history: "🏛️",
  mozart: "🎼",
  legends: "🐉",
  architecture: "🏰",
  hidden: "🔍",
  food: "🥨",
  views: "🌄",
  art: "🎨",
};
