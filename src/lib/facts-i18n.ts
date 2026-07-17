// Übersetzung der Quick-Fact-Werte (feste Admin-Auswahllisten) in ALLE Sprachen.
// Die Übersetzungstabelle liegt in facts-i18n.json (deutscher Wert = Schlüssel -> {locale: Wert}).
// Robust: Deutsch = der Schlüssel selbst; unbekannte/eigene Werte bleiben unverändert (kein
// Verschlucken). Neue Sprache = Spalte in facts-i18n.json ergänzen. Preisniveau (€/€€/€€€) ist
// sprachneutral und bleibt unübersetzt. Ortsnamen (area) werden aus der festen Gebietsliste (AREA)
// übersetzt: Gattungswörter wie „Altstadt“ lokalisiert, echte Ortsnamen 1:1, in nichtlateinischen
// Schriften (zh/ko) lautschriftlich. Frei getippte Gegenden ohne Eintrag bleiben Deutsch.
import facts from "./facts-i18n.json";

type LangMap = Record<string, string>;
const DATA = facts as Record<string, Record<string, LangMap>>;

// Deutsche Access-Labels (der JSON-Schlüssel ist der Code, nicht der deutsche Text).
const ACCESS_DE: Record<string, string> = {
  oeffis: "Öffis",
  auto: "Auto",
  beides: "Öffis & Auto",
};

function pick(cat: string, v: string | null | undefined, locale: string): string | null {
  if (v == null || v.trim() === "") return null;
  if (locale === "de") return v; // deutscher Wert = Anzeige
  const map = DATA[cat] ?? {};
  const key = v.trim();
  let entry = map[key];
  if (!entry) {
    const lower = key.toLowerCase();
    for (const k in map) if (k.toLowerCase() === lower) { entry = map[k]; break; }
  }
  return entry?.[locale] ?? v; // Sprache -> Übersetzung, sonst deutscher Wert (kein Verschlucken)
}

export const factDifficulty = (v: string | null | undefined, locale: string) =>
  pick("DIFFICULTY", v, locale);
export const factSeason = (v: string | null | undefined, locale: string) =>
  pick("SEASON", v, locale);
export const factFame = (v: string | null | undefined, locale: string) =>
  pick("FAME", v, locale);
export const factSubtype = (v: string | null | undefined, locale: string) =>
  pick("SUBTYPE", v, locale);
// Gegend/Ortsname (feste Gebietsliste, siehe SpotForm AREAS). Unbekannte Werte -> Deutsch.
export const factArea = (v: string | null | undefined, locale: string) =>
  pick("AREA", v, locale);

// Dauer: "3 Std" -> "3 h", "30 Min" -> "30 min", "1,5 Std" -> "1.5 h". Für alle Nicht-DE-
// Sprachen (h/min sind international gebräuchlich; Deutsch behält "Std"/"Min").
export function factDuration(
  v: string | null | undefined,
  locale: string,
): string | null {
  if (v == null || v.trim() === "") return null;
  if (locale === "de") return v;
  return v
    .replace(/,(\d)/g, ".$1") // Dezimalkomma -> Punkt
    .replace(/\bStd\b\.?/gi, "h")
    .replace(/\bMin\b\.?/gi, "min");
}

// Anreise-Code (oeffis/auto/beides) sprachabhängig beschriften.
export function factAccess(
  code: string | null | undefined,
  locale: string,
): string | null {
  if (!code) return null;
  if (locale === "de") return ACCESS_DE[code] ?? null;
  return DATA.ACCESS?.[code]?.[locale] ?? ACCESS_DE[code] ?? null;
}
