// Prüft die ECHTEN Spot-Daten gegen die Übersetzungstabelle. Aufruf:
//   node --experimental-strip-types scripts/facts-audit.ts
//
// Der Unterschied zu `npm run i18n:check`: Der prüft die TABELLE (ist jede Auswahl in jeder
// Sprache da?). Dieses Skript prüft die DATEN (steht in der Datenbank etwas, das die Tabelle
// nicht kennt?). Beides braucht es, denn genau dazwischen lag der Fehler: Die Tabelle war
// vollständig, aber im Admin frei eingetippte Werte („Cafe", „Mai–Oktober", „Gastein") haben
// sie nie getroffen und fielen still auf Deutsch zurück.
//
// Es importiert bewusst die ECHTEN Helfer aus facts-i18n.ts statt die Logik nachzubauen —
// ein Nachbau würde genau die Abweichung verstecken, die er finden soll.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  factAccess,
  factArea,
  factDifficulty,
  factDuration,
  factFame,
  factIsKnown,
  factPrice,
  factSeason,
  factSubtype,
  type FactField,
} from "../src/lib/facts-i18n.ts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const LOCALES = ["de", "en", "es", "fr", "it", "ko", "nl", "pt", "zh"];

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await sb
  .from("spots")
  .select("slug, type, subtype, difficulty, best_season, access, price_level, area, fame, duration");
if (error) throw error;

type Row = Record<string, string | null>;
const rows = (data ?? []) as Row[];

let problems = 0;
const flag = (slug: string, field: string, raw: string, msg: string) => {
  problems++;
  console.error(`  ✗ ${slug} · ${field} = ${JSON.stringify(raw)} — ${msg}`);
};

for (const r of rows) {
  const isFood = r.type === "food";
  type Check = [string, string | null, FactField | null, (v: string | null, l: string) => string | null];
  const checks: Check[] = isFood
    ? [
        ["subtype", r.subtype, "subtype", factSubtype],
        ["area", r.area, "area", factArea],
        ["fame", r.fame, "fame", factFame],
      ]
    : [
        // Dauer ist meist "1,5 Std" und wird gerechnet statt nachgeschlagen — nur Wort-Dauern
        // ("Halbtag") brauchen einen Tabelleneintrag, deshalb hier kein factIsKnown.
        ["duration", r.duration, null, factDuration],
        ["difficulty", r.difficulty, "difficulty", factDifficulty],
        ["best_season", r.best_season, "season", factSeason],
        ["access", r.access, null, factAccess],
      ];

  for (const [field, raw, known, fn] of checks) {
    if (raw == null || raw.trim() === "") continue;

    for (const l of LOCALES) {
      const out = fn(raw, l);
      if (out == null || out === "") flag(r.slug!, field, raw, `${l} ergibt keinen Wert`);
    }

    // Der eigentliche Fehler: Der Wert steht gar nicht in der Tabelle. Dann zeigt jede
    // Sprache Deutsch — und genau das sah man der Seite nicht an.
    if (known && !factIsKnown(known, raw)) {
      flag(r.slug!, field, raw, `steht in keiner Auswahlliste, bleibt in ALLEN Sprachen Deutsch`);
    }
    // Wort-Dauern müssen in DURATION stehen; eine Zahl-Dauer darf frei sein.
    if (field === "duration" && !/\d/.test(raw) && !factIsKnown("duration", raw)) {
      flag(r.slug!, field, raw, `Wort-Dauer ohne Eintrag in DURATION, bleibt in ALLEN Sprachen Deutsch`);
    }
  }

  // Preisniveau ist sprachneutral, muss aber €/€€/€€€ sein — Wort-Werte sind auch auf
  // Deutsch falsch und haben genau so „mittel" auf die Seite gebracht.
  if (isFood && r.price_level?.trim()) {
    const p = factPrice(r.price_level);
    if (!/^€{1,3}$/.test(String(p))) flag(r.slug!, "price_level", r.price_level, `ergibt „${p}" statt €/€€/€€€`);
  }
}

// --show: die fertigen Quick-Facts je Sprache ausgeben. Der Check oben sagt „bestanden",
// diese Ansicht zeigt, WAS ein Gast tatsächlich liest.
if (process.argv.includes("--show")) {
  for (const r of rows) {
    const isFood = r.type === "food";
    console.log(`\n── ${r.slug} (${r.type})`);
    for (const l of LOCALES) {
      const vals = isFood
        ? [factSubtype(r.subtype, l), factPrice(r.price_level), factArea(r.area, l), factFame(r.fame, l)]
        : [factDuration(r.duration, l), factDifficulty(r.difficulty, l), factSeason(r.best_season, l), factAccess(r.access, l)];
      console.log(`   ${l}  ${vals.filter(Boolean).join("  ·  ")}`);
    }
  }
}

console.log(`\n${rows.length} Spots geprüft, ${LOCALES.length} Sprachen.`);
if (problems > 0) {
  console.error(`✗ ${problems} Wert(e) ohne saubere Übersetzung.`);
  process.exit(1);
}
console.log("✓ Jeder gespeicherte Quick-Fact-Wert übersetzt sich in alle Sprachen.");
