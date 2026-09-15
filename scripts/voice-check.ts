// Prüft die Regeln der Stimmen. Aufruf: npm run voice:check
//
// WARUM ES DIESE PRÜFUNG GIBT: Seit Migration 0068 hat jede Runde genau eine Stimme, und die
// Dateien liegen je Punkt, Sprache und Stimme. Ob eine Datei "aktuell" ist, entscheidet
// darüber, ob ElevenLabs-Guthaben ausgegeben wird; ob eine Runde live darf, entscheidet
// darüber, ob ein Gast eine halb vertonte Runde hört. Beide Regeln stehen in
// src/lib/tts-rules.ts, und dieses Skript importiert GENAU DIE, keinen Nachbau.
import {
  ttsTextHash,
  elevenIdOf,
  pickDefaultVoice,
  fileState,
  fileCurrent,
  requiredVoiceIds,
  pointVoicesPublishable,
  tourVoiceGate,
  pickRoundVoice,
  disclosureOf,
  durationFromBytes,
  cleanVoiceSettings,
  ELEVEN_DEFAULT_SETTINGS,
  type VoiceRow,
} from "@/lib/tts-rules";
import { stripEmDash } from "@/lib/em-dash";

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

const voice = (over: Partial<VoiceRow>): VoiceRow => ({
  id: "v",
  key: "v",
  name: "V",
  kind: "synthetic",
  elevenVoiceId: null,
  personName: null,
  isDefault: false,
  sortOrder: 0,
  settings: ELEVEN_DEFAULT_SETTINGS,
  ...over,
});

console.log("1. Der Text-Hash ist stabil gegen das, was beim Speichern ohnehin passiert");
{
  const a = ttsTextHash("Servus, ich bin Toni.");
  expect("Leerraum außen zählt nicht", ttsTextHash("  Servus, ich bin Toni.  "), a);
  // Der Speicherpfad strippt den Gedankenstrich (lib/em-dash.ts). Der Hash des rohen
  // KI-Textes muss dem des gespeicherten gleichen, sonst gälte jede Datei als veraltet.
  const roh = "Servus — ich bin Toni.";
  expect("Gedankenstrich: roh und gespeichert ergeben denselben Hash", ttsTextHash(roh), ttsTextHash(stripEmDash(roh)));
  if (ttsTextHash("Servus, ich bin Simon.") !== a) ok("anderer Text, anderer Hash");
  else bad("anderer Text, anderer Hash", "gleich");
}

console.log("\n2. Welche ElevenLabs-ID spricht: nie ein hart kodierter Fallback");
{
  const env = { ELEVENLABS_VOICE_ID: "envVoice0123456" };
  expect("eigene ID gewinnt", elevenIdOf(voice({ elevenVoiceId: "ownVoice012345" }), env), "ownVoice012345");
  expect("Standard ohne ID nimmt die ENV-Brücke", elevenIdOf(voice({ isDefault: true }), env), "envVoice0123456");
  expect("Nicht-Standard ohne ID: nichts", elevenIdOf(voice({}), env), null);
  expect("Standard ohne ID und ohne ENV: nichts (kein Rachel-Fallback)", elevenIdOf(voice({ isDefault: true }), {}), null);
  expect("Leerzeichen-ID zählt als keine", elevenIdOf(voice({ elevenVoiceId: "   " }), {}), null);
  expect("echte Aufnahme hat keine ID", elevenIdOf(voice({ kind: "human", elevenVoiceId: "ownVoice012345", isDefault: true }), env), null);
}

console.log("\n3. Der Standard hat ein Netz");
{
  const toni = voice({ id: "t", key: "toni", sortOrder: 5 });
  const simon = voice({ id: "s", key: "simon", sortOrder: 1 });
  expect("is_default gewinnt", pickDefaultVoice([toni, voice({ id: "d", key: "anton", isDefault: true })])?.id, "d");
  expect("sonst toni", pickDefaultVoice([simon, toni])?.id, "t");
  expect("sonst der erste nach sort_order", pickDefaultVoice([voice({ id: "b", key: "b", sortOrder: 2 }), simon])?.id, "s");
  expect("leer: null", pickDefaultVoice([]), null);
}

console.log("\n4. Wann eine Datei aktuell ist (und wann Guthaben fließt)");
{
  const h = ttsTextHash("Text");
  expect("keine Datei", fileState({ url: null, hash: null, objectExists: false }, h), "missing");
  expect("Datei im Bucket weg (der Kostproben-Fall)", fileState({ url: "a.mp3", hash: h, objectExists: false }, h), "object_missing");
  expect("gleicher Text", fileState({ url: "a.mp3", hash: h, objectExists: true }, h), "ok");
  expect("Text geändert", fileState({ url: "a.mp3", hash: "alt", objectExists: true }, h), "text_changed");
  expect("Altbestand ohne Hash", fileState({ url: "a.mp3", hash: null, objectExists: true }, h), "unhashed");
  expect("ok und unhashed kosten nichts", [fileCurrent("ok"), fileCurrent("unhashed")], [true, true]);
  expect("der Rest kostet", [fileCurrent("missing"), fileCurrent("text_changed"), fileCurrent("object_missing")], [false, false, false]);
}

console.log("\n5. Welche Stimmen ein Punkt braucht");
{
  expect("nur veröffentlichte Runden, ohne Doppelte", requiredVoiceIds(["s", null, "s", "t", undefined]), ["s", "t"]);
  const langs = ["de", "en"];
  const full = { de: { url: "1", hash: null }, en: { url: "2", hash: null } };
  const half = { de: { url: "1", hash: null } };
  expect("Pflicht-Stimme komplett", pointVoicesPublishable({ required: ["s"], langs, files: { s: full, t: half } }), true);
  expect("Pflicht-Stimme halb", pointVoicesPublishable({ required: ["s"], langs, files: { s: half, t: full } }), false);
  expect("zwei Pflicht-Stimmen, eine halb", pointVoicesPublishable({ required: ["s", "t"], langs, files: { s: full, t: half } }), false);
  expect("keine Pflicht: eine komplette reicht", pointVoicesPublishable({ required: [], langs, files: { t: half, a: full } }), true);
  expect("keine Pflicht, nichts komplett", pointVoicesPublishable({ required: [], langs, files: { t: half } }), false);
  expect("keine Pflicht, keine Dateien", pointVoicesPublishable({ required: [], langs, files: {} }), false);
}

console.log("\n6. Wann eine Runde live darf");
{
  const langs = ["de", "en"];
  const textDe = "Servus";
  const textEn = "Hi";
  const stop = (files: Record<string, { url: string | null; hash: string | null }>) => ({
    pointId: "p",
    textByLang: { de: textDe, en: textEn },
    files,
  });
  expect(
    "alles da und aktuell",
    tourVoiceGate([stop({ de: { url: "1", hash: ttsTextHash(textDe) }, en: { url: "2", hash: ttsTextHash(textEn) } })], langs),
    [],
  );
  expect(
    "Altbestand ohne Hash wird toleriert",
    tourVoiceGate([stop({ de: { url: "1", hash: null }, en: { url: "2", hash: null } })], langs),
    [],
  );
  expect(
    "eine andere Sprache fehlt: der Player fällt auf Deutsch zurück, kein Treffer",
    tourVoiceGate([stop({ de: { url: "1", hash: null } })], langs),
    [],
  );
  expect(
    "Deutsch fehlt: die Station wäre stumm",
    tourVoiceGate([stop({ en: { url: "2", hash: null } })], langs),
    [{ pointId: "p", lang: "de", reason: "missing" }],
  );
  expect(
    "Text seit Vertonung geändert",
    tourVoiceGate([stop({ de: { url: "1", hash: "alt" }, en: { url: "2", hash: null } })], langs),
    [{ pointId: "p", lang: "de", reason: "text_changed" }],
  );
  expect(
    "Text leer, Datei da: kein Vergleich möglich, kein Treffer",
    tourVoiceGate([{ pointId: "p", textByLang: {}, files: { de: { url: "1", hash: "x" }, en: { url: "2", hash: "y" } } }], langs),
    [],
  );
}

console.log("\n7. Die eine Stimme einer KI-Runde");
{
  expect("größte Abdeckung", pickRoundVoice([{ voiceIds: ["s", "t"] }, { voiceIds: ["s"] }, { voiceIds: ["t", "s"] }], "t"), "s");
  expect("Gleichstand: der Standard", pickRoundVoice([{ voiceIds: ["s", "t"] }, { voiceIds: ["t", "s"] }], "t"), "t");
  expect("Gleichstand ohne Standard: deterministisch", pickRoundVoice([{ voiceIds: ["z", "a"] }], null), "a");
  expect("Doppelte in einem Punkt zählen einmal", pickRoundVoice([{ voiceIds: ["s", "s"] }, { voiceIds: ["t"] }, { voiceIds: ["t"] }], null), "t");
  expect("keine Dateien: null", pickRoundVoice([{ voiceIds: [] }], "t"), null);
}

console.log("\n8. Die Offenlegung folgt der Stimm-Art");
{
  expect("unbekannt: KI-Stimme", disclosureOf(null), { key: "aiVoice", name: null });
  expect("synthetisch: KI-Stimme ohne Namen", disclosureOf({ name: "Toni", kind: "synthetic", personName: null }), { key: "aiVoice", name: null });
  expect("geklont: mit Namen", disclosureOf({ name: "Simon", kind: "cloned", personName: "Simon" }), { key: "aiVoiceClone", name: "Simon" });
  expect("geklont ohne personName: Anzeigename", disclosureOf({ name: "Simon", kind: "cloned", personName: null }), { key: "aiVoiceClone", name: "Simon" });
  expect("echt: Gesprochen von", disclosureOf({ name: "Anton", kind: "human", personName: "Anton" }), { key: "humanVoice", name: "Anton" });
}

console.log("\n9. Sprech-Einstellungen je Stimme (0069)");
{
  expect("nichts angegeben: ElevenLabs-Standard (Tempo 1,0, nicht mehr 0,9)", cleanVoiceSettings(undefined), ELEVEN_DEFAULT_SETTINGS);
  expect("Formular-Strings werden Zahlen", cleanVoiceSettings({ stability: "0.55", speed: "0.9", speakerBoost: false }).speed, 0.9);
  expect("Grenzen halten: Tempo 0,7 bis 1,2", cleanVoiceSettings({ speed: 3 }).speed, 1.2);
  expect("Grenzen halten: Stil 0 bis 1", cleanVoiceSettings({ style: -4 }).style, 0);
  expect("Unsinn faellt auf den Standard", cleanVoiceSettings({ stability: "abc" }).stability, 0.5);
  expect("leerer String ist NICHT 0 (die alte ENV-Falle)", cleanVoiceSettings({ stability: "" }).stability, 0.5);
  expect("gerundet auf zwei Stellen", cleanVoiceSettings({ similarity: 0.7549 }).similarity, 0.75);
}

console.log("\n10. Dauer aus der Dateigröße (96 kbit/s CBR)");
{
  expect("1,2 MB sind 100 Sekunden", durationFromBytes(1_200_000), 100);
  expect("nie 0", durationFromBytes(10), 1);
}

console.log(failed ? `\n${failed} Prüfung(en) FEHLGESCHLAGEN` : "\nAlles in Ordnung.");
process.exit(failed ? 1 : 0);
