// Erzeugt die Vorschaubilder für Bestands-Hero-Fotos (media.blur_url).
// Neue Uploads bekommen sie automatisch (saveSpot).
//
// Nutzt bewusst dieselbe blurPreviewFor() wie der Upload -> identische Vorschauen und
// dieselbe Aufräum-Logik (alte Vorschau-Datei wird beim Ersetzen gelöscht).
//
// Aufruf:
//   npm run backfill:blur            nur fehlende (idempotent, gefahrlos wiederholbar)
//   npm run backfill:blur -- --force ALLE neu erzeugen – nötig, wenn PREVIEW_WIDTH in
//                                    lib/blur-preview.ts geändert wurde, denn sonst
//                                    bleiben bestehende Vorschauen auf dem alten Stand.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { blurPreviewFor, prunePreviews } from "../src/lib/blur-preview.ts";

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
const base = supabase.from("media").select("id, url, blur_url").eq("type", "image").eq("role", "hero");
const { data, error } = await (force ? base : base.is("blur_url", null));

if (error) {
  console.error("Laden fehlgeschlagen:", error.message);
  process.exit(1);
}

const rows = (data ?? []).filter((r) => typeof r.url === "string" && r.url);
if (!rows.length) {
  console.log("Nichts zu tun – alle Hero-Fotos haben eine Vorschau.");
  process.exit(0);
}

console.log(`${rows.length} Hero-Foto(s) ${force ? "werden neu erzeugt" : "ohne Vorschau"}.`);

let done = 0;
let failed = 0;

for (const row of rows) {
  // Bei --force die alte URL absichtlich NICHT als "prev" durchreichen: Sonst gälte das
  // Bild als unverändert und die alte Vorschau bliebe stehen – genau das, was --force
  // verhindern soll. Die alte Datei wird trotzdem aufgeräumt (prevPreviewUrl).
  const preview = await blurPreviewFor(supabase.storage, row.url, force ? null : row.url, row.blur_url);
  if (!preview) {
    console.warn(`  ✗ ${row.url} – Vorschau konnte nicht erzeugt werden`);
    failed++;
    continue;
  }
  const up = await supabase.from("media").update({ blur_url: preview }).eq("id", row.id);
  if (up.error) {
    console.warn(`  ✗ ${row.url} – Speichern fehlgeschlagen: ${up.error.message}`);
    failed++;
    continue;
  }
  done++;
  console.log(`  ✓ ${row.url.split("/").pop()} -> ${preview.split("/").pop()}`);
}

console.log(`\nFertig: ${done} erzeugt, ${failed} fehlgeschlagen.`);
// Fehlgeschlagene bleiben null -> UI fällt auf den Emoji-Platzhalter zurück und ein
// erneuter Lauf holt sie nach. Kein harter Exit-Code, damit Teil-Erfolge zählen.

// Zum Schluss aufräumen: Vorschauen, die niemand mehr ausliefert. Dasselbe läuft
// wöchentlich im Cron (api/cron/events) — hier steht es für den Fall, dass man nicht
// warten will, und weil man dann SIEHT, was passiert ist.
const pruned = await prunePreviews(supabase, supabase.storage);
console.log(
  `Aufgeräumt: ${pruned.unlinked} Galerie-Verweis(e) geleert, ${pruned.deleted} Datei(en) gelöscht` +
    (pruned.orphans ? ` (davon ${pruned.orphans} verwaist)` : ""),
);
