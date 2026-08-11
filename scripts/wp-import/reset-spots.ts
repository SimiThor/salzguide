// Räumt den Spot-Bestand der NEUEN App leer, damit der Import auf sauberem Grund steht.
// Aufruf:
//   npm run wp:reset -- --dry     nur zeigen, was passieren würde (Vorgabe)
//   npm run wp:reset -- --go      wirklich löschen
//
// Vor dem Löschen wird ALLES in eine Datei geschrieben: Spot-Zeilen, alle Übersetzungen,
// alle media-Zeilen. Der Grund ist nicht Vorsicht um ihrer selbst willen. Zwei der neun
// Test-Spots (liechtensteinklamm, alm-greisslerei) haben KEIN Gegenstück auf der alten
// Seite: Für sie ist das Löschen endgültig, der Import bringt sie nicht zurück. Mit der
// Sicherung ist der Schritt umkehrbar, und damit ist er keine Entscheidung mehr.
//
// Die Dateien im Bucket gehen über removeSpotMediaFiles weg, also über DIESELBE Funktion,
// die auch deleteSpot benutzt. Ein eigener Nachbau würde die Intro-Videos vergessen, und
// die lägen dann für immer öffentlich erreichbar im Bucket.
//
// Kategorien und Locals bleiben stehen. Die sind kuratiert und kein Spot-Inhalt.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { removeSpotMediaFiles } from "../../src/lib/blur-preview.ts";
import { selectAll } from "./select-all.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen");

const go = process.argv.includes("--go");
const OUT_DIR = ".wp-cache";

async function main() {
  const db = createClient(url!, key!, { auth: { persistSession: false } });

  const { data: spots, error } = await db
    .from("spots")
    .select("*")
    .order("created_at");
  if (error) throw new Error(`spots lesen: ${error.message}`);
  if (!spots?.length) {
    console.log("Keine Spots vorhanden, nichts zu tun.");
    return;
  }

  const ids = spots.map((s) => s.id as string);
  // Seitenweise: 95 Spots mal 13 Sprachen sind 1235 Zeilen, PostgREST liefert ohne range()
  // nur 1000 (siehe select-all.ts). Eine abgeschnittene Sicherung merkt man erst, wenn man
  // sie braucht, und dann ist der Bestand gelöscht.
  const translations = await selectAll<Record<string, unknown>>((from, to) =>
    db.from("spot_translations").select("*").in("spot_id", ids).range(from, to),
  );
  const { data: media } = await db.from("media").select("*").in("spot_id", ids);

  // Sicherung IMMER schreiben, auch im Trockenlauf. Wer erst löscht und dann merkt, dass
  // die Sicherung nicht ging, hat keine.
  mkdirSync(OUT_DIR, { recursive: true });
  const backupFile = join(OUT_DIR, "spots-backup.json");
  writeFileSync(
    backupFile,
    JSON.stringify({ spots, translations: translations ?? [], media: media ?? [] }, null, 1),
  );

  console.log(`${spots.length} Spots, ${translations?.length ?? 0} Übersetzungen, ${media?.length ?? 0} Medien-Zeilen`);
  console.log(`Sicherung -> ${backupFile}`);
  console.log("");
  for (const s of spots) {
    const n = (media ?? []).filter((m) => m.spot_id === s.id).length;
    console.log(`  ${String(s.slug).padEnd(24)} ${n} Medien`);
  }
  console.log("");

  if (!go) {
    console.log("TROCKENLAUF. Es wurde nichts gelöscht.");
    console.log("Wirklich löschen:  npm run wp:reset -- --go");
    return;
  }

  // Datei-URLs einsammeln, SOLANGE die Zeilen noch da sind. Danach wüsste niemand mehr,
  // welche Dateien im Bucket zu diesen Spots gehörten.
  const fileUrls: (string | null | undefined)[] = [];
  for (const m of media ?? []) fileUrls.push(m.url as string, m.blur_url as string | null);
  for (const s of spots)
    fileUrls.push(
      s.video_url as string | null,
      s.video_poster_url as string | null,
      s.intro_video_url as string | null,
      s.intro_video_clean_url as string | null,
      s.intro_video_poster_url as string | null,
    );

  // Zeilen zuerst. Scheitert das, bleiben die Dateien korrekt referenziert stehen, statt
  // dass ein halb entleerter Bucket auf vorhandene Zeilen trifft. (Reihenfolge wie in
  // deleteSpot.) spot_translations und media hängen per Kaskade an der spots-Zeile.
  const { error: delErr } = await db.from("spots").delete().in("id", ids);
  if (delErr) throw new Error(`spots löschen: ${delErr.message}`);
  console.log(`${ids.length} Spot-Zeilen gelöscht (Übersetzungen und Medien kaskadieren mit).`);

  await removeSpotMediaFiles(db.storage, fileUrls);
  const real = fileUrls.filter((u) => typeof u === "string" && u.trim() !== "").length;
  console.log(`${real} Datei-Verweise aufgeräumt.`);

  const { count } = await db.from("spots").select("id", { count: "exact", head: true });
  console.log(`Verbleibende Spots: ${count ?? "?"}`);
  console.log("");
  console.log("Kategorien und Locals sind absichtlich stehen geblieben.");
  console.log(`Zurückholen ginge aus ${backupFile}.`);
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
