// Ordnet die Spots einer Reihe zu, die der Import offen gelassen hat. Aufruf:
//   npm run wp:categories          zeigt, was passieren würde
//   npm run wp:categories -- --go  schreibt
//
// WARUM VON HAND UND NICHT IM IMPORT: import.ts ordnet nur zu, wo die alte WordPress-
// Kategorie den neuen Reihen-Namen wirklich enthält. Für „burgen", „parks", „sonstige" und
// „aussichtspunkte" gibt es kein Gegenstück, und eine mechanische Zuordnung hätte die
// Hälfte falsch einsortiert (Mönchsberg und Schafberg standen in derselben alten Kategorie).
// Was hier steht, ist deshalb je Spot entschieden und nicht abgeleitet.
//
// EINE ZEILE JE SAISON. Ein Spot mit seasons = ["summer","winter"] braucht in BEIDEN
// Saisonen eine Reihe, sonst fehlt er im Explore der anderen Saison, ohne dass etwas
// kaputt aussieht. Genau so waren Dom, Mönchsberg und Nonnberggasse bisher nur im Winter
// sichtbar.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

/** Sommer: „City & Nearby Hills" ist die Reihe für die Stadt und ihre Hausberge. Sie war
 *  leer, obwohl fast jeder Stadt-Spot hineingehört. */
const SUMMER_HILLS = [
  "aignerpark",
  "burglstein",
  "dom-zu-salzburg",
  "festung-hohensalzburg",
  "freisaalweg",
  "halleiner-altstadt",
  "hangar-7",
  "hellbrunner-allee",
  "kapuzinerberg",
  "leopoldskroner-weiher",
  "makartplatz",
  "maria-plain",
  "mirabellgarten",
  "monchsberg",
  "nonnberggasse",
  "schlosspark-hellbrunn",
];

/** Sommer: „Seen & Stege". Der Almkanal ist kein See, aber man geht zum Wasser und
 *  springt rein, und genau danach sucht jemand in dieser Reihe. */
const SUMMER_LAKES = ["almkanal", "hintersee-badeplatz", "wolfgangsee-schifffahrt"];

/** Winter: „Aussicht & Erholung" ist die Reihe für alles, was im Winter offen hat und
 *  weder Bahn noch Hütte ist. Dom, Mönchsberg und Lamprechtshöhle stehen bereits drin,
 *  die Stadt-Sehenswürdigkeiten gehören daneben. */
const WINTER_VIEW = [
  "burg-hohenwerfen",
  "festung-hohensalzburg",
  "hangar-7",
  "mirabellgarten",
  "richterhohe",
  "rossfeld-panoramastrase",
  "schlosspark-hellbrunn",
  "sound-of-music-trail",
];

const PLAN: { key: string; season: "summer" | "winter"; slugs: string[] }[] = [
  { key: "hills", season: "summer", slugs: SUMMER_HILLS },
  { key: "lakes", season: "summer", slugs: SUMMER_LAKES },
  { key: "view", season: "winter", slugs: WINTER_VIEW },
];

async function main() {
  const go = process.argv.includes("--go");

  const { data: cats } = await db.from("categories").select("id, key, season");
  const { data: spots } = await db.from("spots").select("id, slug, seasons");
  const { data: links } = await db.from("spot_categories").select("spot_id, category_id");
  if (!cats || !spots || !links) throw new Error("Lesen fehlgeschlagen");

  const catId = new Map(cats.map((c) => [`${c.season}/${c.key}`, c.id]));
  const spotBySlug = new Map(spots.map((s) => [s.slug, s]));
  const existing = new Set(links.map((l) => `${l.spot_id}/${l.category_id}`));

  const rows: { spot_id: string; category_id: string }[] = [];
  let skipped = 0;

  for (const { key, season, slugs } of PLAN) {
    const cid = catId.get(`${season}/${key}`);
    if (!cid) throw new Error(`Kategorie ${season}/${key} gibt es nicht`);
    for (const slug of slugs) {
      const spot = spotBySlug.get(slug);
      if (!spot) throw new Error(`Spot ${slug} gibt es nicht`);
      // Der Spot MUSS die Saison haben, sonst hängt die Zeile in einer Reihe, die ihn
      // nie zeigt. Lieber laut scheitern als still danebenliegen.
      if (!(spot.seasons ?? []).includes(season))
        throw new Error(`${slug} hat keine Saison ${season}, gehört also nicht in ${key}`);
      if (existing.has(`${spot.id}/${cid}`)) {
        skipped++;
        continue;
      }
      rows.push({ spot_id: spot.id, category_id: cid });
      console.log(`  ${go ? "ok   " : "würde"} ${slug.padEnd(30)} -> ${season}/${key}`);
    }
  }

  console.log(
    `\n${rows.length} Zuordnungen${go ? " geschrieben" : ""}, ${skipped} gab es schon.`,
  );
  if (!go) {
    console.log("TROCKENLAUF. Nichts geschrieben. Wirklich setzen: npm run wp:categories -- --go");
    return;
  }
  if (rows.length) {
    const { error } = await db.from("spot_categories").insert(rows);
    if (error) throw error;
  }

  // Gegenprobe: Welcher Spot hat in einer seiner Saisonen immer noch keine Reihe?
  const { data: after } = await db.from("spot_categories").select("spot_id, category_id");
  const catById = new Map(cats.map((c) => [c.id, c]));
  const perSpot = new Map<string, Set<string>>();
  for (const l of after ?? []) {
    const c = catById.get(l.category_id);
    if (!c) continue;
    if (!perSpot.has(l.spot_id)) perSpot.set(l.spot_id, new Set());
    perSpot.get(l.spot_id)!.add(c.season);
  }
  const open: string[] = [];
  for (const s of spots)
    for (const season of s.seasons ?? [])
      if (!perSpot.get(s.id)?.has(season)) open.push(`${s.slug} (${season})`);
  console.log(open.length ? `Ohne Reihe bleiben: ${open.join(", ")}` : "Jeder Spot hat in jeder seiner Saisonen eine Reihe.");
}

main();
