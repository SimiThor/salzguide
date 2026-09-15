import { hashTexts } from "./spot-hash";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Sprechfassung: die Regeln, ohne Server-Imports (Editor, Server, Pruef-Skript).
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Der geschriebene Text hat Ziffern ("1945", "15.000 Stueck"); die Stimme bekommt eine
// Fassung mit Woertern ("neunzehnhundertfuenfundvierzig", "fuenfzehntausend Stueck"). Die
// Fassung schreibt ein Sprachmodell (lib/spoken-text.ts). Weil ein Sprachmodell auch mal
// mehr aendert, als es soll, steht hier ein WAECHTER, der nichts von der Sprache wissen muss:
//
//   1. Keine Ziffer darf uebrig bleiben.
//   2. Jedes WORT des Originals muss als ganzes Wort in derselben Reihenfolge in der
//      Sprechfassung vorkommen. Einfuegen ist erlaubt (Zahlwoerter, "zum Beispiel" fuer
//      "z. B."), Loeschen, Umstellen und Umformulieren nicht ("starb" -> "verstarb" faellt
//      durch). Verschwinden duerfen nur: Zahl-Token, roemische Zahlen, Abkuerzungen mit Punkt
//      und kurze Einheiten direkt neben einer Zahl ("km", "Uhr", "%"), denn genau die werden
//      ja ausgeschrieben. Schriften ohne Leerzeichen (Chinesisch) werden auf Buchstabenebene
//      geprueft, mit derselben Regel.
//   3. Die Laenge bleibt plausibel (hoechstens das Dreifache).
//
// Faellt der Waechter, wird der Originaltext vertont wie bisher. Vertonen scheitert daran nie.

/**
 * Fassung des Prompts. Hochzaehlen, wenn sich die Anweisungen an das Modell aendern: Dann
 * gelten gespeicherte Sprechfassungen als veraltet und entstehen beim naechsten Vertonen neu
 * (die Dateien selbst bleiben; ihr Hash haengt am geschriebenen Text).
 */
export const SPOKEN_PROMPT_VERSION = "1";

/** Marke, die an der gespeicherten Sprechfassung steht: Textstand + Prompt-Fassung. */
export function spokenSourceHash(text: string): string {
  return hashTexts([`spoken-v${SPOKEN_PROMPT_VERSION}`, text]);
}

const DIGIT = /\p{Nd}/u;
/** Ein Zahl-Token: 1945, 15.000, 3,5, 10:30, 1/2, 2019er */
const NUMBER_TOKEN = /\p{Nd}[\p{Nd}.,:/]*\p{Nd}|\p{Nd}/gu;
/** Roemische Zahl als eigenes Wort (Ludwig XIV., Karl V.). */
const ROMAN = /^[IVXLCDM]{1,6}$/;
/** Randzeichen eines Tokens, die kein Buchstabe und keine Ziffer sind (Anfuehrungen, Kommas). */
const EDGE = /^[^\p{L}\p{Nd}]+|[^\p{L}\p{Nd}]+$/gu;

/** Braucht der Text eine Sprechfassung? Ohne Ziffern kostet er keinen Aufruf. */
export function needsSpokenForm(text: string): boolean {
  return DIGIT.test(text);
}

/** Nur Buchstaben, klein, ohne Zahl-Token: das Skelett fuer Schriften ohne Leerzeichen. */
export function letterSkeleton(text: string, dropNumbers: boolean): string[] {
  let t = text.normalize("NFC");
  if (dropNumbers) t = t.replace(NUMBER_TOKEN, " ").replace(/(?<![\p{L}])[IVXLCDM]{1,6}\.?(?![\p{L}])/gu, " ");
  const out: string[] = [];
  for (const ch of t.toLowerCase()) if (/\p{L}/u.test(ch)) out.push(ch);
  return out;
}

/** Abkuerzungen, die auch am Satzende welche sind (dort folgt kein Kleinbuchstabe). */
const KNOWN_ABBR = new Set(["usw", "etc", "bzw", "ca", "vgl", "ggf", "evtl", "inkl", "approx", "no", "nr"]);
/** Dreibuchstabige Einheiten hinter einer Zahl. Kuerzere (km, m, h, kg) sind immer frei; "Mai" nicht. */
const KNOWN_UNITS = new Set(["uhr", "min", "std", "sek", "sec", "mio", "mrd", "tsd", "eur", "usd", "chf", "gbp", "mph", "kmh", "pct", "sqm", "sqf", "lbs"]);

/**
 * Die Woerter eines Textes, klein und ohne Randzeichen. Mit `dropNumbers` fallen die Token
 * weg, die eine Sprechfassung ersetzen darf:
 *   - Zahl-Token und roemische Zahlen,
 *   - Abkuerzungen mit Punkt: ein oder zwei Buchstaben ("z. B.", "St."), laengere nur, wenn
 *     der Satz danach klein oder mit einer Zahl weitergeht ("ca. 2", "bzw. das") oder sie
 *     bekannt sind ("usw."). Ein kurzes Wort am SATZENDE ("zu tun.") bleibt so pruefbar.
 *   - Einheiten direkt NACH einer Zahl ("9,05 km", "10:30 Uhr"): bis zwei Buchstaben frei,
 *     dreibuchstabige nur aus der bekannten Liste, damit "15. Mai" seinen Mai behaelt. Vor der
 *     Zahl steht in unseren Sprachen die Praeposition, und die muss bleiben ("am 15.").
 */
export function wordSkeleton(text: string, dropNumbers: boolean): string[] {
  const raw = text.normalize("NFC").split(/\s+/).filter(Boolean);
  const cores = raw.map((tok) => tok.replace(EDGE, ""));
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const core = cores[i];
    if (!core) continue;
    if (dropNumbers) {
      if (DIGIT.test(core)) continue;
      if (ROMAN.test(core)) continue;
      const dotted = /\.$/.test(raw[i].replace(/[)\]"'»“”‘’,;:]+$/u, ""));
      if (dotted && core.length <= 4) {
        const next = cores[i + 1] ?? "";
        const continues = /^[\p{Ll}\p{Nd}]/u.test(next);
        if (core.length <= 2 || continues || KNOWN_ABBR.has(core.toLowerCase())) continue;
      }
      if (DIGIT.test(cores[i - 1] ?? "") && (core.length <= 2 || KNOWN_UNITS.has(core.toLowerCase()))) continue;
    }
    out.push(core.toLowerCase());
  }
  return out;
}

/** Ist `a` eine Teilfolge von `b` (gleiche Reihenfolge, Luecken erlaubt)? */
export function isSubsequence(a: string[], b: string[]): boolean {
  let j = 0;
  for (let i = 0; i < b.length && j < a.length; i++) if (b[i] === a[j]) j++;
  return j === a.length;
}

/** Schrift mit Leerzeichen zwischen Woertern? Chinesisch und Japanisch haben keine. */
function hasWordBoundaries(text: string): boolean {
  const words = text.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return words.length >= 2;
}

export type SpokenVerdict = { ok: true } | { ok: false; reason: "digits" | "words_changed" | "length" | "empty" };

/** Der Waechter (siehe Kopf). */
export function spokenTextAcceptable(original: string, spoken: string): SpokenVerdict {
  const o = original.trim();
  const s = spoken.trim();
  if (!s) return { ok: false, reason: "empty" };
  if (DIGIT.test(s)) return { ok: false, reason: "digits" };
  if (s.length > o.length * 3 + 80) return { ok: false, reason: "length" };
  const intact = hasWordBoundaries(o)
    ? isSubsequence(wordSkeleton(o, true), wordSkeleton(s, false))
    : isSubsequence(letterSkeleton(o, true), letterSkeleton(s, false));
  if (!intact) return { ok: false, reason: "words_changed" };
  return { ok: true };
}
