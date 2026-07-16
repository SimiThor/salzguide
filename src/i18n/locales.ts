// ZENTRALE Sprach-Konfiguration — EINZIGE Quelle der Wahrheit für alle Sprachen der App.
// Neue Sprache hinzufügen = einen Eintrag hier ergänzen + `messages/<code>.json` anlegen
// (per Admin-KI-Übersetzung) + Spot-/Event-Inhalte übersetzen. Alles andere (Routing,
// Sprachwähler, hreflang, Sitemap, Datums-/Zahlenformat) leitet sich hieraus ab.
//
// Reihenfolge = Anzeige-Reihenfolge im Sprachwähler. Basis (Deutsch) zuerst.
// Sprachauswahl datenbasiert nach Salzburg-Tourismus (Nächtigungen nach Herkunft 2024).
export interface LocaleMeta {
  code: string; // ISO 639-1 (URL-Präfix, z. B. /de, /it)
  name: string; // Endonym (Eigenbezeichnung) — so heißt die Sprache im Wähler
  english: string; // Englischer Name (Admin/Tooltips)
  flag: string; // Emoji-Flagge
  bcp47: string; // BCP-47-Tag für Intl.* (Datum/Zahl/Währung)
  dir: "ltr" | "rtl"; // Textrichtung (rtl z. B. für künftiges Arabisch)
}

export const LOCALES: readonly LocaleMeta[] = [
  { code: "de", name: "Deutsch", english: "German", flag: "🇩🇪", bcp47: "de-AT", dir: "ltr" },
  { code: "en", name: "English", english: "English", flag: "🇬🇧", bcp47: "en-GB", dir: "ltr" },
  { code: "it", name: "Italiano", english: "Italian", flag: "🇮🇹", bcp47: "it-IT", dir: "ltr" },
  { code: "nl", name: "Nederlands", english: "Dutch", flag: "🇳🇱", bcp47: "nl-NL", dir: "ltr" },
  { code: "ko", name: "한국어", english: "Korean", flag: "🇰🇷", bcp47: "ko-KR", dir: "ltr" },
  { code: "fr", name: "Français", english: "French", flag: "🇫🇷", bcp47: "fr-FR", dir: "ltr" },
  { code: "zh", name: "简体中文", english: "Chinese (Simplified)", flag: "🇨🇳", bcp47: "zh-CN", dir: "ltr" },
  { code: "es", name: "Español", english: "Spanish", flag: "🇪🇸", bcp47: "es-ES", dir: "ltr" },
  { code: "pt", name: "Português", english: "Portuguese", flag: "🇵🇹", bcp47: "pt-PT", dir: "ltr" },
] as const;

export const LOCALE_CODES: readonly string[] = LOCALES.map((l) => l.code);
export const DEFAULT_LOCALE = "de";

// Basis-/Ausgangssprache für KI-Übersetzungen (zuerst generieren, dann in alle anderen).
export const SOURCE_LOCALE = "de";
export const TARGET_LOCALES: readonly string[] = LOCALE_CODES.filter((c) => c !== SOURCE_LOCALE);

const BY_CODE = new Map(LOCALES.map((l) => [l.code, l]));

export function localeMeta(code: string): LocaleMeta {
  return BY_CODE.get(code) ?? LOCALES[0];
}

// BCP-47-Tag für Intl.DateTimeFormat / NumberFormat — ersetzt die verstreuten
// `locale === "en" ? "en-GB" : "de-AT"`-Ternäre app-weit (skaliert auf N Sprachen).
export function bcp47(code: string): string {
  return localeMeta(code).bcp47;
}

export function localeDir(code: string): "ltr" | "rtl" {
  return localeMeta(code).dir;
}
