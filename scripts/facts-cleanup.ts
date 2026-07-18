// Bringt gespeicherte Quick-Fact-Werte auf die kanonische Schreibweise.
//   Trockenlauf:  node --experimental-strip-types scripts/facts-cleanup.ts
//   Schreiben:    node --experimental-strip-types scripts/facts-cleanup.ts --write
//
// Nötig, weil der Admin diese Felder früher als Freitext geführt hat. Entstanden sind
// Varianten, die keine Übersetzung treffen („Cafe" statt „Café", „Mai–Oktober" statt
// „Mai bis Oktober", „See" statt „See & Baden") und ein Preisniveau „mittel", das auch auf
// Deutsch falsch ist. Seit saveSpot() kanonisiert (admin-actions.ts) entsteht das nicht mehr
// neu; dieses Skript räumt den Altbestand einmalig auf.
//
// Es benutzt dieselben Helfer wie die Seite. Was der Anzeige egal wäre, ändert es nicht:
// Unbekannte Werte bleiben stehen, statt geraten oder gelöscht zu werden.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { factCanonical, factPrice, type FactField } from "../src/lib/facts-i18n.ts";

const WRITE = process.argv.includes("--write");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await sb
  .from("spots")
  .select("id, slug, subtype, best_season, area, fame, difficulty, price_level");
if (error) throw error;

// Spalte -> Feld der Übersetzungstabelle. price_level läuft getrennt, es hat keine Tabelle.
const COLUMNS: [string, FactField][] = [
  ["subtype", "subtype"],
  ["best_season", "season"],
  ["area", "area"],
  ["fame", "fame"],
  ["difficulty", "difficulty"],
];

type Row = Record<string, string | null>;
let changed = 0;

for (const row of (data ?? []) as Row[]) {
  const patch: Record<string, string> = {};

  for (const [col, field] of COLUMNS) {
    const raw = row[col];
    if (!raw?.trim()) continue;
    const canonical = factCanonical(field, raw);
    if (canonical && canonical !== raw) patch[col] = canonical;
  }

  const price = row.price_level?.trim() ? factPrice(row.price_level) : null;
  if (price && price !== row.price_level) patch.price_level = price;

  if (Object.keys(patch).length === 0) continue;
  changed++;
  for (const [col, to] of Object.entries(patch)) {
    console.log(`  ${row.slug} · ${col}: ${JSON.stringify(row[col])} -> ${JSON.stringify(to)}`);
  }

  if (WRITE) {
    const { error: upErr } = await sb.from("spots").update(patch).eq("id", row.id!);
    if (upErr) {
      console.error(`  ✗ ${row.slug}: ${upErr.message}`);
      process.exitCode = 1;
    }
  }
}

console.log(
  changed === 0
    ? "\n✓ Nichts zu tun, alle Werte sind bereits kanonisch."
    : WRITE
      ? `\n✓ ${changed} Spot(s) aktualisiert.`
      : `\n${changed} Spot(s) würden geändert. Zum Schreiben nochmal mit --write aufrufen.`,
);
