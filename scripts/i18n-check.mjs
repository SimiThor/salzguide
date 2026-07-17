// Prüft messages/*.json gegen die Basissprache. Aufruf: npm run i18n:check
//
// WARUM ES DAS BRAUCHT: `next build` validiert die Sprachdateien NICHT. Ein fehlender Key
// kompiliert sauber durch, und seit i18n/request.ts jede Sprache tief mit Deutsch mergt,
// sieht man ihn der Seite auch nicht mehr an: Sie zeigt dann still den deutschen Text.
// Das ist gewollt (eine halb übersetzte Seite schlägt eine kaputte), macht die Lücke aber
// unsichtbar. Dieser Check ist die einzige Stelle, die sie noch findet.
//
// Er ist damit nur so viel wert wie sein Rauschen: Wer hier 300 Meldungen sieht, liest
// keine davon. Fehlalarme sind deshalb kein Schönheitsfehler, sondern der Tod des Checks.
//
// Geprüft wird dreierlei, weil Key-Gleichheit allein nicht reicht:
//   1. Key-Pfade — fehlende und überzählige.
//   2. ICU-Platzhalter ({count}, {n}) — ein umbenannter Platzhalter wirft zur Laufzeit.
//   3. Rich-Text-Tags (<terms>, <w> …) — ein umbenanntes Tag löscht STILL den Link im Text,
//      z. B. den §-18-FAGG-Widerruf-Link. Der Ablauf funktioniert weiter, nur der Link ist
//      weg. Das ist ein Rechtsproblem, das kein Key-Vergleich findet.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "messages";
const BASE = "de";

const load = (code) => JSON.parse(readFileSync(join(DIR, `${code}.json`), "utf8"));

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  );
}

// Sprachen, in denen der Gedankenstrich REGULÄRE Zeichensetzung ist und bleiben muss.
// Chinesisch: das doppelte „——" ist das Po-Zhe-Hao, ein normales Satzzeichen. Ein blindes
// Verbot würde die Sprache kaputtmachen, nicht säubern.
const DASH_OK_LOCALES = new Set(["zh"]);

// Ein Wert, der NUR aus einem Strich besteht, ist ein Platzhalter für „keine Angabe"
// (z. B. Detail.opening.noInfo) und kein Fliesstext. Der darf bleiben.
const isDashPlaceholder = (s) => /^[\s—–-]+$/.test(s);

// Namensräume, die NUR in der Basissprache stehen dürfen.
//
// „Home" sind die Texte der Startseite. Die kommen nicht aus diesen Dateien, sondern aus
// der DB (home_content, Migration 0036) und werden im Admin gepflegt und übersetzt.
// lib/home-content.ts importiert dafür ausschliesslich de.json, als unterste Stufe seiner
// Drei-Stufen-Regel: DB-Übersetzung, sonst DB-Deutsch, sonst diese Datei.
//
// Ein „Home.heroTitle" in en.json läse deshalb NIEMAND. Ohne diese Ausnahme meldete der
// Check 39 Keys × 8 Sprachen = 312 Fehlalarme und begrübe die echten Lücken darunter —
// genau so ist die fehlende Meta-Übersetzung monatelang niemandem aufgefallen.
//
// Umgekehrt gilt: In einer Zielsprache ist so ein Key ein FEHLER, kein Extra. Er sieht aus
// wie eine gepflegte Übersetzung, wird aber nie ausgeliefert.
const BASE_ONLY_NAMESPACES = new Set(["Home"]);
const isBaseOnly = (key) => BASE_ONLY_NAMESPACES.has(key.split(".")[0]);

// {name} — greift NICHT bei {count, plural, ...}: dort ist der erste Teil der Name.
const placeholders = (s) =>
  new Set([...String(s).matchAll(/\{\s*(\w+)/g)].map((m) => m[1]));
// <tag> aus t.rich() — schliessende Tags interessieren nicht, der Name reicht.
const richTags = (s) => new Set([...String(s).matchAll(/<(\w+)>/g)].map((m) => m[1]));

const base = new Map(flatten(load(BASE)));
const locales = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((c) => c !== BASE)
  .sort();

let problems = 0;
const report = (locale, msg) => {
  problems++;
  console.error(`  ${locale}: ${msg}`);
};

// Gedankenstriche sind die auffälligste Verräter-Zeichensetzung von KI-Text. Sie stehen
// in brand-voice.ts auf der Verbotsliste — aber ein Prompt ist eine Bitte, kein Zwang, und
// beim nächsten Text ist der Strich wieder drin. Hier wird er hart geprüft.
function checkDashes(locale, entries) {
  if (DASH_OK_LOCALES.has(locale)) return;
  for (const [key, value] of entries) {
    if (typeof value !== "string" || isDashPlaceholder(value)) continue;
    if (value.includes("—")) report(locale, `GEDANKENSTRICH in  ${key}: „${value.slice(0, 60)}…"`);
  }
}

checkDashes(BASE, [...base.entries()]);

for (const locale of locales) {
  const target = new Map(flatten(load(locale)));
  checkDashes(locale, [...target.entries()]);

  for (const key of base.keys()) {
    if (isBaseOnly(key)) continue; // gehört bewusst nur in die Basissprache
    if (!target.has(key)) {
      report(locale, `FEHLENDER Key  ${key}`);
      continue;
    }
    const [b, t] = [base.get(key), target.get(key)];

    if (typeof b !== typeof t) {
      report(locale, `TYP weicht ab  ${key} (${typeof b} -> ${typeof t})`);
      continue;
    }
    if (typeof b !== "string") continue;

    const [pb, pt] = [placeholders(b), placeholders(t)];
    for (const p of pb) if (!pt.has(p)) report(locale, `PLATZHALTER {${p}} fehlt in  ${key}`);
    for (const p of pt) if (!pb.has(p)) report(locale, `PLATZHALTER {${p}} unbekannt in  ${key}`);

    const [rb, rt] = [richTags(b), richTags(t)];
    for (const tag of rb) if (!rt.has(tag)) report(locale, `RICH-TAG <${tag}> fehlt in  ${key}`);
    for (const tag of rt) if (!rb.has(tag)) report(locale, `RICH-TAG <${tag}> unbekannt in  ${key}`);
  }

  for (const key of target.keys()) {
    if (isBaseOnly(key)) {
      report(locale, `NUR-${BASE.toUpperCase()}-Key  ${key} (wird nie ausgeliefert, siehe lib/home-content.ts)`);
      continue;
    }
    if (!base.has(key)) report(locale, `ÜBERZÄHLIGER Key  ${key} (nicht in ${BASE}.json)`);
  }
}

if (problems > 0) {
  console.error(`\n✗ ${problems} Problem(e) in ${locales.length} Sprachen.`);
  process.exit(1);
}
console.log(`✓ ${locales.length} Sprachen stimmen mit ${BASE}.json überein (${base.size} Keys).`);
