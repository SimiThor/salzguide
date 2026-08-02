// KI-Herkunft eines Bilds (EU AI Act, Art. 50; docs/39_RECHT_KI-Transparenz.md §2 + §5).
// DIE EINE QUELLE für die erlaubten Werte: DB-Spalte media.ai_origin (Migration 0062),
// Startseiten-Slots (landing-media.ts), Admin-Schalter und das sichtbare Badge
// (AiImageBadge.tsx, Labels in messages/*.json unter AiMedia.*).
//
// null/undefined heisst: ohne KI, kein Badge. Das ist der Normalfall und bewusst KEIN
// eigener Wert in der Liste, damit niemand "none" in die DB schreibt.
//
// Bewusst OHNE "server-only": wird auch client-seitig (Admin-Formulare, Badge) und von
// Skripten gebraucht.
export const AI_ORIGINS = ["generated", "edited", "extended"] as const;
export type AiOrigin = (typeof AI_ORIGINS)[number];

/** Unbekanntes (DB/jsonb/Formular) sicher einlesen: gültiger Wert oder null. */
export function parseAiOrigin(v: unknown): AiOrigin | null {
  return typeof v === "string" && (AI_ORIGINS as readonly string[]).includes(v)
    ? (v as AiOrigin)
    : null;
}
