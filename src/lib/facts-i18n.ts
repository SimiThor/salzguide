// Übersetzung der Quick-Fact-Werte (Admin-Auswahllisten) in ALLE Sprachen.
// Tabelle: facts-i18n.json — kanonischer deutscher Wert = Schlüssel -> {locale: Wert}.
//
// WARUM DIESE DATEI SO AUSSIEHT: Der Schlüssel ist deutscher Fliesstext, den ein Mensch im
// Admin eintippt. Jede Tippvariante verfehlt damit den Schlüssel, und die Notbremse „dann
// zeig halt Deutsch" verwandelt einen Datenfehler in stillen Mischmasch: In der koreanischen
// Ansicht stand „Cafe", „Mai–Oktober" und „Halbtag". Niemandem fällt das auf, weil nichts
// kaputtgeht — es steht nur die falsche Sprache da.
//
// Deshalb wird nicht mehr stur verglichen, sondern in vier Stufen aufgelöst (resolve()):
//   1. exakter Schlüssel
//   2. normalisiert — Akzente, Gross/Klein, Strich-Varianten, „&"/„und", Satzzeichen
//   3. ALIAS-Tabelle — bewusste Synonyme, die keine Normalisierung findet
//      („Mai–Oktober" -> „Mai bis Oktober", „See" -> „See & Baden")
//   4. Wortreihenfolge egal („Salzburg Stadt" -> „Stadt Salzburg")
// Erst danach bleibt der Wert unverändert stehen (kein Verschlucken).
//
// Das gilt AUCH für Deutsch: Ein aufgelöster Wert wird auf die kanonische Schreibweise
// gebracht, damit die Seite einheitlich bleibt, egal wer den Spot angelegt hat.
//
// Preisniveau ist sprachneutral (€/€€/€€€), wird aber normalisiert, weil Wort-Werte wie
// „mittel" in der Spalte gelandet sind — die sind auch auf Deutsch falsch.
//
// Neue Sprache = Spalte in facts-i18n.json ergänzen. `npm run i18n:check` erzwingt, dass
// jede Auswahlliste in jeder Sprache vollständig ist.
import facts from "./facts-i18n.json" with { type: "json" };

type LangMap = Record<string, string>;
type Table = Record<string, LangMap>;

const DATA = facts as unknown as {
  ALIAS: Record<string, Record<string, string>>;
} & Record<string, Table>;

// Deutsche Access-Labels (der JSON-Schlüssel ist der Code, nicht der deutsche Text).
const ACCESS_DE: Record<string, string> = {
  oeffis: "Öffis",
  auto: "Auto",
  beides: "Öffis & Auto",
};

// Vergleichsform: alles weg, was zwei Schreibweisen desselben Wortes unterscheidet.
// Nur auf deutsche Schlüssel angewendet — Zielsprachen laufen hier nie durch.
export function normalizeFact(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    // Umlaut-Umschrift VOR dem Akzent-Abbau. Sonst würde "Grödig" zu "grodig" und träfe die
    // verbreitete Tippweise "Groedig" nie. Der umgekehrte Weg (oe -> o) wäre falsch: der
    // zerlegte deutsche Wörter wie "Feuer" oder "Neukirchen".
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // restliche Akzente: "Café" = "Cafe"
    .replace(/\bsankt\b/g, "st") // "Sankt Gilgen" = "St. Gilgen"
    .replace(/[\u2010-\u2015]/g, "-") // –, —, ‒ = -
    .replace(/\s*&\s*/g, " und ") // "See & Baden" = "See und Baden"
    .replace(/[^\p{L}\p{N}]+/gu, " ") // Satzzeichen -> Trenner
    .trim()
    .replace(/\s+/g, " ");
}

// Wortreihenfolge ignorieren: "Salzburg Stadt" und "Stadt Salzburg" ergeben denselben Wert.
// Bewusst die LETZTE Stufe — sie darf nur greifen, wenn exakt dieselben Wörter vorkommen.
const sortedTokens = (s: string) => normalizeFact(s).split(" ").sort().join(" ");

// Index je Kategorie einmal bauen (Modul-Scope = einmal pro Prozess, nicht pro Aufruf).
const indexCache = new Map<string, { byNorm: Map<string, string>; bySorted: Map<string, string> }>();

function indexOf(cat: string) {
  let idx = indexCache.get(cat);
  if (idx) return idx;
  const byNorm = new Map<string, string>();
  const bySorted = new Map<string, string>();
  for (const key of Object.keys(DATA[cat] ?? {})) {
    byNorm.set(normalizeFact(key), key);
    // Erster Treffer gewinnt: eine echte Kollision wäre ein Fehler in der Tabelle,
    // den i18n-check meldet — hier still das Original behalten statt es zu überschreiben.
    const sorted = sortedTokens(key);
    if (!bySorted.has(sorted)) bySorted.set(sorted, key);
  }
  idx = { byNorm, bySorted };
  indexCache.set(cat, idx);
  return idx;
}

// Getippten Wert auf Tabelle + kanonischen Schlüssel bringen. null = kein Treffer.
//
// Ein Feld kann von mehreren Tabellen bedient werden (area: AREA + AREA_NAMES). Die Stufen
// laufen deshalb ÜBER ALLE Tabellen, bevor die nächste Stufe beginnt: Ein exakter Treffer in
// der zweiten Tabelle schlägt einen Wortreihenfolge-Treffer in der ersten. Der Alias-
// Namensraum ist immer die erste Tabelle (ALIAS.AREA gilt für AREA und AREA_NAMES).
function resolve(cats: string[], v: string): { cat: string; key: string } | null {
  const raw = v.trim();
  for (const cat of cats) if (DATA[cat]?.[raw]) return { cat, key: raw }; // 1. exakt

  const n = normalizeFact(raw);
  for (const cat of cats) {
    const hit = indexOf(cat).byNorm.get(n);
    if (hit) return { cat, key: hit }; // 2. normalisiert
  }

  const alias = DATA.ALIAS?.[cats[0]];
  if (alias) {
    for (const from in alias) {
      if (normalizeFact(from) !== n) continue;
      const target = alias[from];
      for (const cat of cats) if (DATA[cat]?.[target]) return { cat, key: target }; // 3. Alias
    }
  }

  const sorted = sortedTokens(raw);
  for (const cat of cats) {
    const hit = indexOf(cat).bySorted.get(sorted);
    if (hit) return { cat, key: hit }; // 4. Wortreihenfolge
  }
  return null;
}

// Fehlt die Sprache in der Zeile, gilt der kanonische deutsche Schlüssel — genau darauf baut
// AREA_NAMES (siehe factArea).
function pick(cats: string[], v: string | null | undefined, locale: string): string | null {
  if (v == null || v.trim() === "") return null;
  const hit = resolve(cats, v);
  if (!hit) return v.trim(); // unbekannt: unverändert stehen lassen, nichts verschlucken
  if (locale === "de") return hit.key; // kanonische Schreibweise, nicht die getippte
  return DATA[hit.cat]?.[hit.key]?.[locale] ?? hit.key;
}

// Welche Tabellen ein Feld bedienen. EINE Quelle für Anzeige, Admin-Warnung und Audit —
// sonst warnt das Formular vor etwas anderem, als die Seite später anzeigt.
const FIELD_CATS = {
  subtype: ["SUBTYPE"],
  area: ["AREA", "AREA_NAMES"],
  season: ["SEASON"],
  fame: ["FAME"],
  difficulty: ["DIFFICULTY"],
  duration: ["DURATION"],
} as const;

export type FactField = keyof typeof FIELD_CATS;

/**
 * Kennt die Übersetzungstabelle diesen Wert? false heisst: Er landet in JEDER Sprache
 * unverändert auf Deutsch. Das Admin-Formular warnt daraufhin beim Eintippen.
 * Leer = true, denn „nichts angegeben" ist kein Übersetzungsproblem.
 */
export function factIsKnown(field: FactField, v: string | null | undefined): boolean {
  if (v == null || v.trim() === "") return true;
  return resolve([...FIELD_CATS[field]], v.trim()) !== null;
}

/** Kanonische Schreibweise eines getippten Werts, oder null wenn unbekannt. */
export function factCanonical(field: FactField, v: string | null | undefined): string | null {
  if (v == null || v.trim() === "") return null;
  return resolve([...FIELD_CATS[field]], v.trim())?.key ?? null;
}

export const factDifficulty = (v: string | null | undefined, locale: string) =>
  pick(["DIFFICULTY"], v, locale);
export const factSeason = (v: string | null | undefined, locale: string) =>
  pick(["SEASON"], v, locale);
export const factFame = (v: string | null | undefined, locale: string) =>
  pick(["FAME"], v, locale);
export const factSubtype = (v: string | null | undefined, locale: string) =>
  pick(["SUBTYPE"], v, locale);

// Gegend: zwei Tabellen, weil Ortsangaben zwei verschiedene Dinge sind.
//   AREA       — enthält ein übersetzbares Gattungswort („Altstadt", „Zeller See",
//                „Nationalpark Hohe Tauern"). Volle 8 Sprachen.
//   AREA_NAMES — reiner Eigenname („Hallein", „Flachau"). Der heisst auf Spanisch wie auf
//                Deutsch; nur zh/ko bekommen eine Umschrift. Alle anderen Sprachen fallen
//                über das `?? key` in pick() auf den deutschen Namen zurück.
// Ohne diese Trennung stünden ~150 Ortsnamen achtmal identisch in der Tabelle — viel Fläche
// für Tippfehler, ohne eine einzige echte Übersetzung.
// Frei getippte Gegenden ohne Eintrag bleiben Deutsch; deshalb warnt das Admin-Formular.
export const factArea = (v: string | null | undefined, locale: string) =>
  pick(["AREA", "AREA_NAMES"], v, locale);

// Preisniveau: sprachneutral (€/€€/€€€), aber Wort-Werte („mittel") landeten in der Spalte.
// Die ALIAS-Tabelle bügelt das in JEDER Sprache aus, auch auf Deutsch.
export function factPrice(v: string | null | undefined): string | null {
  if (v == null || v.trim() === "") return null;
  const raw = v.trim();
  if (/^€{1,3}$/.test(raw)) return raw;
  const alias = DATA.ALIAS?.PRICE ?? {};
  const n = normalizeFact(raw);
  for (const from in alias) if (normalizeFact(from) === n) return alias[from];
  return raw;
}

// Dauer: "3 Std" -> "3 h", "30 Min" -> "30 min", "1,5 Std" -> "1.5 h" (h/min sind
// international gebräuchlich, Deutsch behält "Std"/"Min"). Wort-Dauern wie "Halbtag" haben
// keine Zahl und liefen früher ungefiltert in jede Sprache — die stehen jetzt in DURATION.
export function factDuration(
  v: string | null | undefined,
  locale: string,
): string | null {
  if (v == null || v.trim() === "") return null;
  const word = resolve(["DURATION"], v.trim());
  if (word) return locale === "de" ? word.key : DATA.DURATION?.[word.key]?.[locale] ?? word.key;
  if (locale === "de") return v.trim();
  return v
    .trim()
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
