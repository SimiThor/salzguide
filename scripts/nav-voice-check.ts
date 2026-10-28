// Prüft die gesprochenen Navigations-Ansagen (Migration 0077). Aufruf: npm run nav-voice:check
//
// Offline und rein: Das Skript importiert die ECHTEN Regeln aus src/lib/nav-voice-rules.ts
// und liest die rohen messages/*.json, kein Nachbau. Es ruft weder ElevenLabs noch Supabase.
import fs from "node:fs";
import path from "node:path";
import { LOCALE_CODES } from "@/i18n/locales";
import {
  NAV_KEY_RE,
  NAV_PROMPT_KEYS,
  isNavPromptKey,
  navPromptPlan,
  navTextOf,
  navVoiceGate,
  navVoiceVersion,
  type NavFileRow,
} from "@/lib/nav-voice-rules";
import { ttsTextHash } from "@/lib/tts-rules";
import { collectTourAudioPaths } from "./lib/storage-refs.mjs";

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, detail: string) => {
  console.log(`  FEHLT ${name}\n        ${detail}`);
  failed++;
};
const expect = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) ok(name);
  else bad(name, `erwartet ${w}, bekommen ${g}`);
};

// ── 1. Texte: jede Ansage in jeder Sprache, roh, ohne Platzhalter ─────────────────────
console.log("\n1. Texte in messages/*.json (roh, ohne Deutsch-Merge)");
const texts: Record<string, Record<string, string | null>> = {};
let totalChars = 0;
for (const lang of LOCALE_CODES) {
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", `${lang}.json`), "utf8"));
  texts[lang] = {};
  for (const key of NAV_PROMPT_KEYS) {
    const t = navTextOf(raw, key);
    texts[lang][key] = t;
    if (!t) {
      bad(`${lang} ${key}: Text vorhanden`, "fehlt oder leer");
      continue;
    }
    totalChars += t.length;
    if (/[{}<>]/.test(t)) bad(`${lang} ${key}: keine Platzhalter`, t);
    else if (t.includes("—") && lang !== "zh") bad(`${lang} ${key}: kein Gedankenstrich`, t);
    else if (!/[.!?。！？]$/.test(t)) bad(`${lang} ${key}: endet mit Satzzeichen`, t);
  }
}
ok(`${LOCALE_CODES.length} Sprachen x ${NAV_PROMPT_KEYS.length} Ansagen geprüft, ${totalChars} Zeichen je Stimme (Kosten)`);
for (const k of NAV_PROMPT_KEYS) if (!NAV_KEY_RE.test(k)) bad(`Schlüssel ${k} passt zum CHECK der Migration`, k);
expect("isNavPromptKey erkennt echte und fremde Schlüssel", [isNavPromptKey("hike.arrived"), isNavPromptKey("hike.x"), isNavPromptKey(5)], [true, false, false]);

// ── 2. Plan: fehlend, veraltet, ok, Objekt weg, Text fehlt ────────────────────────────
console.log("\n2. navPromptPlan");
const langs = ["de", "en"];
const T = { de: { ...texts.de }, en: { ...texts.en } };
const row = (key: string, lang: string, text: string, p: string): NavFileRow => ({
  promptKey: key, lang, voiceId: "v1", audioPath: p, textHash: ttsTextHash(text), durationMs: 1000,
});
const full: NavFileRow[] = [];
for (const l of langs) for (const k of NAV_PROMPT_KEYS) full.push(row(k, l, T[l as "de"][k]!, `nav-${l}-${k}.mp3`));
const allPaths = new Set(full.map((f) => f.audioPath));

const empty = navPromptPlan({ langs, texts: T, files: [], exists: new Set() });
expect("ohne Dateien: alle fehlen", [empty.items.length, empty.wanted, empty.items[0].state], [12, 12, "missing"]);
expect("ohne Dateien: Zeichen = Summe der Texte", empty.chars, langs.reduce((n, l) => n + NAV_PROMPT_KEYS.reduce((m, k) => m + T[l as "de"][k]!.length, 0), 0));
expect("ohne Dateien: Gate zu", navVoiceGate(empty), false);

const done = navPromptPlan({ langs, texts: T, files: full, exists: allPaths });
expect("alles da: nichts zu tun, Gate offen", [done.items.length, done.chars, navVoiceGate(done)], [0, 0, true]);

const stale = full.map((f, i) => (i === 0 ? { ...f, textHash: ttsTextHash("anderer Text") } : f));
const pStale = navPromptPlan({ langs, texts: T, files: stale, exists: allPaths });
expect("alter Text: genau eine veraltet", [pStale.items.length, pStale.items[0].state, navVoiceGate(pStale)], [1, "text_changed", false]);

const gone = new Set(allPaths);
gone.delete(full[3].audioPath);
const pGone = navPromptPlan({ langs, texts: T, files: full, exists: gone });
expect("Objekt fehlt im Bucket: object_missing", [pGone.items.length, pGone.items[0].state], [1, "object_missing"]);

const noText = navPromptPlan({ langs, texts: { ...T, en: { ...T.en, "hike.arrived": null } }, files: full, exists: allPaths });
expect("Text fehlt: missing_text, nicht erzeugbar, Gate zu", [noText.missingText, noText.items.length, navVoiceGate(noText)], [1, 0, false]);

const partial = navPromptPlan({ langs, texts: T, files: full.slice(0, 11), exists: allPaths });
expect("eine fehlt: genau eine offen", [partial.items.length, partial.items[0].state], [1, "missing"]);

// ── 3. Version ────────────────────────────────────────────────────────────────────────
console.log("\n3. navVoiceVersion");
const ent = [{ key: "hike.arrived", path: "a.mp3" }, { key: "hike.offTrail", path: "b.mp3" }];
const v0 = navVoiceVersion("v1", "de", ent);
expect("gleiche Daten, gleiche Version", navVoiceVersion("v1", "de", ent), v0);
expect("Reihenfolge egal", navVoiceVersion("v1", "de", [...ent].reverse()), v0);
expect("andere Stimme, andere Version", navVoiceVersion("v2", "de", ent) !== v0, true);
expect("anderer Pfad (Neu-Take), andere Version", navVoiceVersion("v1", "de", [ent[0], { key: "hike.offTrail", path: "c.mp3" }]) !== v0, true);
expect("andere Sprache, andere Version", navVoiceVersion("v1", "en", ent) !== v0, true);

// ── 4. Waisen-Sweep: Clips müssen geschützt sein ──────────────────────────────────────
console.log("\n4. collectTourAudioPaths");
const asked: string[] = [];
const paths: string[] = await collectTourAudioPaths(async (table: string) => {
  asked.push(table);
  if (table === "nav_prompt_files") return [{ audio_path: "nav-de-toni-abc.mp3" }];
  return [];
});
expect("liest nav_prompt_files", asked.includes("nav_prompt_files"), true);
expect("liefert den Pfad des Clips", paths.includes("nav-de-toni-abc.mp3"), true);

console.log(failed ? `\n${failed} Prüfung(en) FEHLGESCHLAGEN` : "\nAlles in Ordnung.");
process.exit(failed ? 1 : 0);
