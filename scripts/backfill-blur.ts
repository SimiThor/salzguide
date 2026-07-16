// Erzeugt die Blur-Vorschauen für Bestands-Hero-Fotos (media.blur_data_url).
// Neue Uploads bekommen sie automatisch (saveSpot).
//
// Nutzt bewusst dieselbe buildBlurPreview() wie der Upload -> identische Vorschauen.
//
// Aufruf:
//   npm run backfill:blur            nur fehlende (idempotent, gefahrlos wiederholbar)
//   npm run backfill:blur -- --force ALLE neu erzeugen – nötig, wenn PREVIEW_WIDTH in
//                                    lib/blur-preview.ts geändert wurde, denn sonst
//                                    bleiben bestehende Vorschauen auf dem alten Stand.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { buildBlurPreview } from "../src/lib/blur-preview.ts";

// .env.local einlesen (gleiches Muster wie scripts/seed.mjs)
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const force = process.argv.includes("--force");
if (force) console.log("--force: ALLE Vorschauen werden neu erzeugt.\n");

// Nur Spot-Hero-Fotos. Tour-Stopps brauchen KEINE Vorschau: Dort sind Titel, Bild und
// Position bewusst öffentliche Teaser, nur das Audio ist Pro (Migration 0029).
const TARGETS = [
  {
    label: "Spot-Hero-Fotos",
    table: "media",
    column: "blur_data_url",
    load: () => {
      const q = supabase
        .from("media")
        .select("id, url")
        .eq("type", "image")
        .eq("role", "hero");
      return force ? q : q.is("blur_data_url", null);
    },
  },
];

let done = 0;
let failed = 0;

for (const target of TARGETS) {
  const { data, error } = await target.load();
  if (error) {
    console.error(`${target.label}: Laden fehlgeschlagen – ${error.message}`);
    failed++;
    continue;
  }

  const rows = (data ?? []).filter((r) => typeof r.url === "string" && r.url);
  if (!rows.length) {
    console.log(`${target.label}: nichts zu tun.`);
    continue;
  }

  console.log(`${target.label}: ${rows.length} ${force ? "werden neu erzeugt" : "ohne Vorschau"}.`);
  for (const row of rows) {
    const blur = await buildBlurPreview(row.url);
    if (!blur) {
      console.warn(`  ✗ ${row.url} – Vorschau konnte nicht erzeugt werden`);
      failed++;
      continue;
    }
    const up = await supabase
      .from(target.table)
      .update({ [target.column]: blur })
      .eq("id", row.id);
    if (up.error) {
      console.warn(`  ✗ ${row.url} – Speichern fehlgeschlagen: ${up.error.message}`);
      failed++;
      continue;
    }
    done++;
    console.log(`  ✓ ${row.url.split("/").pop()} (${blur.length} Zeichen)`);
  }
}

console.log(`\nFertig: ${done} erzeugt, ${failed} fehlgeschlagen.`);
// Fehlgeschlagene bleiben null -> UI fällt auf den Emoji-Platzhalter zurück und ein
// erneuter Lauf holt sie nach. Kein harter Exit-Code, damit Teil-Erfolge zählen.
