// Die EINE Quelle für „Gut zu wissen" (/gut-zu-wissen): welche Blöcke die Seite trägt, in
// welcher Reihenfolge, mit welchem Symbol und welche Fragen darin stehen. Die Seite
// rendert stur diese Listen — kein Block wird von Hand ins JSX getippt, sonst driften
// Seite, Übersetzungen und Prüfskript auseinander (dieselbe Begründung wie bei
// lib/nav.ts und lib/home-fields.ts).
//
// WO DIE TEXTE LIEGEN — UND WARUM NICHT IN messages/*.json:
// app/[locale]/layout.tsx gibt den GANZEN Nachrichtenbaum an den NextIntlClientProvider
// weiter. Alles, was in messages/ steht, liefert also JEDE Seite der App mit aus: die
// Karte, jeder Spot, jeder Seitenaufruf. messages/de.json ist heute ~30 KB; die Texte
// dieser einen Seite brächten grob 20 KB dazu, für Leute, die sie nie öffnen.
// Deshalb eigene Inhaltsdateien unter src/content/travel-info/, die nur diese eine
// Server-Seite lädt (Vorbild: lib/facts-i18n.json und lib/mail-i18n.ts, beides
// Übersetzungstabellen neben messages/, beide von npm run i18n:check geprüft).
//
// In messages/*.json steht von dieser Seite nur, was ANDERE Bauteile brauchen:
// Nav.info (Burger + PC-„Mehr"-Menü rendern client-seitig) und die Meta-Texte.
import { DEFAULT_LOCALE } from "@/i18n/locales";
import de from "../content/travel-info/de.json";

// ── Notruf ──────────────────────────────────────────────────────────────────────────
//
// Die Nummern stehen HIER und nicht in den dreizehn Inhaltsdateien. Eine Nummer, die
// dreizehnmal getippt wird, ist dreizehnmal die Gelegenheit für einen Zahlendreher — in
// genau der Zeile, die im Ernstfall funktionieren muss. Übersetzt wird nur „Rettung",
// nie die 144.
//
// Alle Nummern gelten österreichweit, ohne Vorwahl, kostenlos.
export type EmergencyNumber = {
  /** Wie man sie wählt. Zugleich das Ziel des tel:-Links. */
  number: string;
  /** Schlüssel der Beschriftung in src/content/travel-info/<locale>.json. */
  key: string;
};

/**
 * Die drei, die gross stehen: der eine Euro-Notruf, der für Fremde funktioniert, wenn
 * sie sonst nichts wissen, plus Rettung und Bergrettung. Letztere ist in einem Land aus
 * Bergen keine Fussnote: 144 schickt einen Rettungswagen auf eine Strasse, 140 schickt
 * Leute an einen Hang.
 */
export const EMERGENCY_PRIMARY: readonly EmergencyNumber[] = [
  { number: "112", key: "euro" },
  { number: "144", key: "ambulance" },
  { number: "140", key: "mountain" },
];

/** Die restlichen, kleiner darunter. */
export const EMERGENCY_MORE: readonly EmergencyNumber[] = [
  { number: "133", key: "police" },
  { number: "122", key: "fire" },
  { number: "141", key: "doctor" },
  { number: "1450", key: "health" },
];

// ── „Auf einen Blick" ───────────────────────────────────────────────────────────────
//
// Sechs Kacheln, die man liest, ohne zu lesen. Beschriftung UND Wert kommen aus den
// Inhaltsdateien: „Deutsch" heisst auf Englisch „German", und „230 V, Typ F" heisst
// „230 V, type F" — auch der scheinbar neutrale Wert ist Text.
export const GLANCE_ITEMS: readonly { key: string; emoji: string }[] = [
  { key: "currency", emoji: "💶" },
  { key: "language", emoji: "💬" },
  { key: "power", emoji: "🔌" },
  { key: "water", emoji: "🚰" },
  { key: "time", emoji: "🕐" },
  // Der „Sonntag zu"-Reflex ist die häufigste Überraschung für Gäste und gehört deshalb
  // nach ganz oben, nicht in ein Ausklapp-Menü.
  { key: "sunday", emoji: "🛒" },
];

// ── Die sieben Themenblöcke ─────────────────────────────────────────────────────────
//
// Reihenfolge = die Reihenfolge der Reise: erst herkommen, dann rumkommen, dann zahlen,
// dann raus in die Berge, dann der Alltag drumherum, dann der Fall, dass etwas ist, und
// zuletzt das Packen (das man ohnehin als Letztes macht).
//
// Emoji statt gezeichneter Symbole ist die Hausregel für Section-Icons (CLAUDE.md).
// Keine Flaggen-Emoji: Windows zeigt statt der Flagge die zwei Buchstaben „AT".
export type TravelItem = {
  /** Schlüssel in den Inhaltsdateien (dort liegen Frage und Antwort). */
  key: string;
  /**
   * Weiterweg in die App, als kleiner Link unter der Antwort.
   *
   * Die ADRESSE steht hier im Code, nur die Beschriftung wird übersetzt: Ein Pfad, der
   * dreizehnmal getippt wird, ist dreizehnmal die Gelegenheit für einen toten Link, und
   * ein toter Link fällt in einer Sprache auf, die niemand von uns liest, nie auf.
   * Nur interne Ziele — die Seite verlinkt nichts Fremdes.
   */
  href?: string;
};

export type TravelBlock = {
  /** Schlüssel in den Inhaltsdateien. */
  key: string;
  emoji: string;
  /** Die Fragen dieses Blocks, in dieser Reihenfolge. */
  items: readonly TravelItem[];
};

export const TRAVEL_BLOCKS: readonly TravelBlock[] = [
  {
    key: "arrival",
    emoji: "✈️",
    items: [{ key: "plane" }, { key: "train" }, { key: "car" }, { key: "bus" }],
  },
  {
    key: "around",
    emoji: "🚌",
    items: [
      { key: "guestcard" },
      { key: "transit" },
      { key: "taxi" },
      { key: "bike" },
      { key: "carfree", href: "/explore" },
    ],
  },
  {
    key: "money",
    emoji: "💶",
    items: [{ key: "cash" }, { key: "tipping" }, { key: "atm" }, { key: "touristtax" }],
  },
  {
    key: "mountains",
    emoji: "⛰️",
    items: [
      { key: "weather" },
      { key: "rescue" },
      { key: "huts" },
      { key: "lakes", href: "/wasser" },
      { key: "winter" },
    ],
  },
  {
    key: "everyday",
    emoji: "🥨",
    items: [
      { key: "sunday" },
      { key: "greeting" },
      { key: "water" },
      { key: "power" },
      { key: "roaming" },
    ],
  },
  {
    key: "health",
    emoji: "🏥",
    items: [{ key: "doctor" }, { key: "pharmacy" }, { key: "insurance" }, { key: "ticks" }],
  },
  {
    key: "packing",
    emoji: "🎒",
    items: [{ key: "always" }, { key: "summer" }, { key: "winter" }],
  },
];

// ── Inhalt laden ────────────────────────────────────────────────────────────────────

export type TravelInfoContent = {
  title: string;
  intro: string;
  emergency: { title: string; note: string; labels: Record<string, string> };
  glance: { title: string; items: Record<string, { label: string; value: string }> };
  blocks: Record<
    string,
    {
      title: string;
      hint: string;
      /** `link` steht nur bei den Fragen, die in TRAVEL_BLOCKS ein `href` tragen. */
      items: Record<string, { q: string; a: string; link?: string }>;
    }
  >;
  outro: { title: string; body: string; ai: string; cta: string };
};

const BASE = de as TravelInfoContent;

/**
 * Zielsprache über Deutsch legen. Dasselbe Netz wie in i18n/request.ts, aus demselben
 * Grund: Fehlt ein Schlüssel, soll die Seite den deutschen Satz zeigen und nicht ein
 * Loch oder einen rohen Schlüsselpfad. Das ist ein NETZ, kein Ersatz für Übersetzungen —
 * die Lücken findet npm run i18n:check, das genau diese Dateien mitprüft.
 *
 * Bewusst nicht aus request.ts importiert: Diese Datei führt beim Import
 * getRequestConfig() aus; ein lib-Modul darf das nicht anstossen.
 */
type Json = Record<string, unknown>;
function mergeWithBase(base: Json, override: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const prev = out[key];
    out[key] =
      prev && typeof prev === "object" && !Array.isArray(prev) &&
      value && typeof value === "object" && !Array.isArray(value)
        ? mergeWithBase(prev as Json, value as Json)
        : value;
  }
  return out;
}

// Ergebnis je Sprache behalten: Beide Seiten des Merges stehen zur Bauzeit fest, das
// Ergebnis kann sich zur Laufzeit nicht ändern. Höchstens dreizehn Einträge.
const cache = new Map<string, TravelInfoContent>();

/** Die Texte der Seite in dieser Sprache. Nur serverseitig aufrufen. */
export async function getTravelInfo(locale: string): Promise<TravelInfoContent> {
  if (locale === DEFAULT_LOCALE) return BASE;
  const hit = cache.get(locale);
  if (hit) return hit;

  // Relativer Pfad mit Platzhalter, wie in i18n/request.ts: So bündelt der Packer alle
  // dreizehn Dateien und lädt zur Laufzeit nur die angefragte.
  //
  // Das try/catch ist kein Zierrat: Fehlt die Datei einer Sprache, WIRFT das import() und
  // die ganze Seite fällt auf den Fehlerschirm — gemessen beim Bauen, /ko lieferte
  // „Etwas ist schiefgelaufen" statt der Seite. Eine neue Sprache soll nicht durch eine
  // vergessene Datei eine kaputte Seite bekommen, sondern eine deutsche. Dass es die
  // Datei überhaupt gibt, ist Sache von npm run i18n:check, nicht der Laufzeit.
  let merged = BASE;
  try {
    const translated = (await import(`../content/travel-info/${locale}.json`)).default as Json;
    merged = mergeWithBase(BASE as unknown as Json, translated) as unknown as TravelInfoContent;
  } catch {
    // absichtlich still: Deutsch ist eine gültige Antwort, ein Fehlerschirm nicht.
  }
  cache.set(locale, merged);
  return merged;
}
