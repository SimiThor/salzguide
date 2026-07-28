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
import { backfillMissingPreviews, prunePreviews } from "../src/lib/blur-preview.ts";

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

// Die Schleife selbst steht in lib/blur-preview.ts (backfillMissingPreviews) – dieselbe,
// die wöchentlich im Wartungs-Cron mitläuft. Zwei Fassungen derselben Schleife wären genau
// die zweite Wahrheit, die irgendwann auseinanderläuft. Hier bleibt nur die Ausgabe.
//
// Kein Deckel (limit): Wer das Skript startet, will alles nachgezogen haben und schaut zu.
// Der Cron nimmt dagegen 25 pro Lauf, damit ein Wartungslauf nicht am Bilder-Rechnen hängt.
const { done, failed } = await backfillMissingPreviews(supabase, supabase.storage, {
  limit: Number.MAX_SAFE_INTEGER,
  force,
  onRow: ({ url, preview }) =>
    preview
      ? console.log(`  ✓ ${url.split("/").pop()} -> ${preview.split("/").pop()}`)
      : console.warn(`  ✗ ${url} – Vorschau konnte nicht erzeugt werden`),
});

if (!done && !failed) console.log("Nichts zu tun – alle Hero-Fotos haben eine Vorschau.");
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
