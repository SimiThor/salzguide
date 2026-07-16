// Der Gedankenstrich (—, U+2014) ist bei SalzGuide verboten: Er ist die auffälligste
// Verräter-Zeichensetzung von KI-Text, und die Marke ist auf „zwei echte Locals, kein
// Marketing" gebaut. Die Regel selbst steht in BRAND_VOICE (brand-voice.ts).
//
// WARUM ES DIESE DATEI GIBT, OBWOHL DIE REGEL SCHON IM PROMPT STEHT:
// Ein Prompt ist eine Bitte. Sprachmodelle setzen diesen Strich trotzdem gern, besonders
// beim Übersetzen. Erst diese Funktion macht daraus einen Zwang. Sie läuft, BEVOR
// KI-Text gespeichert oder ausgeliefert wird — die letzte Stelle, an der wir es noch
// in der Hand haben.
//
// Sie verhält sich absichtlich EXAKT wie scripts/i18n-check.mjs, das dieselbe Regel für
// messages/*.json erzwingt: nur U+2014, nicht der normale Bindestrich (-) und nicht der
// Halbgeviertstrich (–). Laufen die beiden auseinander, meldet der Check Texte, die
// diese Säuberung durchgelassen hat. Ändert sich hier etwas, muss es dort auch.

const EM_DASH = "—";

// Chinesisch: Das doppelte „——" ist das 破折号 (Po-Zhe-Hao), reguläre Zeichensetzung.
// Blind ersetzen würde die Sprache kaputtmachen. Gleiche Liste wie im Check.
const DASH_OK_LOCALES = new Set(["zh"]);

// Ein Wert, der NUR aus Strichen besteht, ist ein Platzhalter für „keine Angabe"
// (z.B. Öffnungszeiten ohne Info) und kein Fliesstext.
const isDashPlaceholder = (s: string) => /^[\s—–-]+$/.test(s);

// Steht der Strich noch drin? Für Tests und Prüfungen.
export function hasEmDash(text: string, locale?: string): boolean {
  if (!text || !text.includes(EM_DASH)) return false;
  if (locale && DASH_OK_LOCALES.has(locale)) return false;
  return !isDashPlaceholder(text);
}

// Ersetzt den Gedankenstrich so, wie BRAND_VOICE es vorschreibt:
// „30 Tabs — und die Hütte hat zu." -> „30 Tabs, und die Hütte hat zu."
//
// `locale` ist der Ziel-Sprachcode (z.B. "de", "en", "zh"). Ohne Angabe wird gesäubert.
export function stripEmDash(text: string, locale?: string): string {
  if (!text || !text.includes(EM_DASH)) return text;
  if (locale && DASH_OK_LOCALES.has(locale)) return text;
  if (isDashPlaceholder(text)) return text;

  let out = text;

  // 1. Zwischen Zahlen ist er ein Bis-Strich: „10 — 12 Uhr" -> „10-12 Uhr".
  out = out.replace(/(\d)[ \t]*—[ \t]*(\d)/g, "$1-$2");

  // 2. Am Zeilenanfang ist er ein Aufzählungszeichen. Nur [ \t], nie \s: sonst frisst
  //    das Muster den Zeilenumbruch und die Liste wird zu einem Fliesstext-Klumpen.
  out = out.replace(/^[ \t]*—[ \t]+/gm, "- ");

  // 3. Ohne Leerzeichen verbindet er zwei Wörter: „Salzburg—München" -> „Salzburg-München".
  out = out.replace(/(\S)—(\S)/g, "$1-$2");

  // 4. Mit Leerzeichen ist er eine Pause, und dafür steht im Deutschen das Komma.
  //    Wieder [ \t] statt \s, damit Zeilenumbrüche stehen bleiben.
  out = out.replace(/[ \t]*—[ \t]*/g, (match, offset: number, whole: string) => {
    const before = whole.slice(0, offset).trimEnd();
    const after = whole.slice(offset + match.length).trimStart();
    if (!before || !after) return ""; // Strich ganz am Anfang oder Ende: weg damit
    // Steht schon ein Satzzeichen davor, ersetzt er nur sich selbst. Sonst entstünde
    // „fertig., und weiter".
    if (/[,.:;!?–-]$/.test(before)) return " ";
    return ", ";
  });

  // 5. Aufräumen: „a, , b" kann entstehen, wenn zwei Striche aufeinandertreffen.
  out = out.replace(/,[ \t]*,/g, ",");

  return out;
}

// Säubert alle String-Felder eines KI-Rückgabe-Objekts auf einmal.
//
// Warum das hier steht und nicht an jeder Aufrufstelle einzeln: Die KI liefert ihre Texte
// als Objekt mit vielen Feldern (title, short_desc, general, insider_tip …). Jedes Feld von
// Hand durchzuschicken heisst, beim nächsten neuen Feld genau eines zu vergessen. Genau so
// ist die Regel schon dreimal durchgerutscht.
//
// `locale` ist die ZIEL-Sprache des Textes, damit die Chinesisch-Ausnahme greift.
export function stripEmDashFields<T extends Record<string, unknown>>(
  obj: T,
  locale?: string,
): T {
  const out: Record<string, unknown> = { ...obj };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string") out[k] = stripEmDash(v, locale);
  }
  return out as T;
}
