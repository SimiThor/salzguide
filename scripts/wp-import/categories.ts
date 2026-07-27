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

/**
 * Sommer: „Aussicht & Kultur", die einzige Reihe, die neu dazukommt.
 *
 * Die alte Seite hatte drei kleine Reihen, für die es in der neuen App kein Gegenstück
 * gibt: Burgen (2), Parks (2) und Sonstige (4), dazu den nicht-städtischen Teil von
 * Aussichtspunkte (18). Parks und die Stadt-Sehenswürdigkeiten sind in „City & Nearby
 * Hills" untergekommen. Was übrig blieb, ist eine Burg über dem Salzachtal, ein
 * Aussichtspunkt daneben, eine Höhle im Saalachtal und der Ortskern von Bad Gastein: alles
 * sehenswert, nichts davon Stadt und nichts davon ein Hausberg.
 *
 * Der Winter hat mit „Aussicht & Erholung" längst so eine Reihe, dem Sommer fehlte sie.
 * Damit sind beide Startseiten gleich gebaut, und „City & Nearby Hills" bleibt, was der
 * Name sagt, statt zur Restekiste zu werden.
 *
 * Die Sommerrodelbahn Abtenau bleibt bewusst draußen. Sie stand auf der alten Seite unter
 * „Sonstige" und ist weder Aussicht noch Kultur; sie in diese Reihe zu legen, wäre genau
 * der Griff, den die Reihe verhindern soll.
 */
const NEW_CATEGORY = {
  key: "sights",
  season: "summer" as const,
  sortOrder: 6, // direkt hinter „City & Nearby Hills"
  titles: {
    de: "Aussicht & Kultur",
    en: "Views & Culture",
    es: "Vistas & Cultura",
    fr: "Panoramas & Culture",
    it: "Panorami & Cultura",
    ko: "전망 & 문화",
    nl: "Uitzicht & Cultuur",
    pt: "Vistas e Cultura",
    zh: "美景与文化",
  },
  slugs: ["bad-gastein", "blick-auf-hohenwerfen", "burg-hohenwerfen", "lamprechtshohle"],
};

const PLAN: { key: string; season: "summer" | "winter"; slugs: string[] }[] = [
  { key: "hills", season: "summer", slugs: SUMMER_HILLS },
  { key: "lakes", season: "summer", slugs: SUMMER_LAKES },
  { key: "view", season: "winter", slugs: WINTER_VIEW },
  { key: NEW_CATEGORY.key, season: NEW_CATEGORY.season, slugs: NEW_CATEGORY.slugs },
];

/**
 * Spots, denen der Winter wieder weggenommen wird.
 *
 * Sie tragen ihn nur, weil die alte Seite bei der Jahreszeit „Ganzjährig" stehen hatte und
 * `seasonsOf` daraus beide Saisonen macht. Gemeint war damit aber „im Winter gesperrt ist
 * hier nichts", nicht „das ist ein Winterausflug": Ein Bergsee auf 1.300 Metern und ein
 * Felsgipfel sind im Winter kein Ziel, und Winterfotos hat keiner der fünf.
 *
 * Es ist dieselbe Regel wie bei der Gastein-Karte, nur andersherum: Ein Spot ohne Foto der
 * passenden Saison sieht auf dieser Karte falscher aus, als wenn er dort fehlt.
 */
const DROP_WINTER = [
  "goldegger-see",
  "groser-barmstein",
  "hintersee-pinzgau",
  "jagersee",
  "ritzensee",
];

async function main() {
  const go = process.argv.includes("--go");

  let { data: cats } = await db.from("categories").select("id, key, season, sort_order");
  const { data: spots } = await db.from("spots").select("id, slug, seasons");
  const { data: links } = await db.from("spot_categories").select("spot_id, category_id");
  if (!cats || !spots || !links) throw new Error("Lesen fehlgeschlagen");

  // Die neue Reihe anlegen, falls sie noch fehlt. Sie schiebt sich zwischen zwei
  // bestehende, deshalb rücken die dahinter um eins nach hinten. Erst schieben, dann
  // einlegen: andersherum gäbe es kurz zwei Reihen mit derselben Position.
  if (!cats.some((c) => c.key === NEW_CATEGORY.key && c.season === NEW_CATEGORY.season)) {
    const behind = cats
      .filter((c) => c.season === NEW_CATEGORY.season && c.sort_order >= NEW_CATEGORY.sortOrder)
      .sort((a, b) => b.sort_order - a.sort_order);
    console.log(
      `  ${go ? "ok   " : "würde"} Reihe „${NEW_CATEGORY.titles.de}" anlegen (${NEW_CATEGORY.season}/${NEW_CATEGORY.key}, Position ${NEW_CATEGORY.sortOrder}), ${behind.length} Reihen rücken nach`,
    );
    if (go) {
      for (const c of behind) {
        const { error } = await db
          .from("categories")
          .update({ sort_order: c.sort_order + 1 })
          .eq("id", c.id);
        if (error) throw error;
      }
      const { error } = await db.from("categories").insert({
        key: NEW_CATEGORY.key,
        season: NEW_CATEGORY.season,
        sort_order: NEW_CATEGORY.sortOrder,
        title_translations: NEW_CATEGORY.titles,
      });
      if (error) throw error;
      cats = (await db.from("categories").select("id, key, season, sort_order")).data!;
    }
  }

  const catId = new Map(cats.map((c) => [`${c.season}/${c.key}`, c.id]));
  const spotBySlug = new Map(spots.map((s) => [s.slug, s]));
  const existing = new Set(links.map((l) => `${l.spot_id}/${l.category_id}`));

  const rows: { spot_id: string; category_id: string }[] = [];
  let skipped = 0;

  for (const { key, season, slugs } of PLAN) {
    // Im Trockenlauf gibt es die neue Reihe noch nicht. Das ist kein Fehler, sondern der
    // ganze Sinn des Trockenlaufs: Er soll zeigen, was danach drin läge.
    const cid = catId.get(`${season}/${key}`);
    if (!cid && go) throw new Error(`Kategorie ${season}/${key} gibt es nicht`);
    if (!cid && !(key === NEW_CATEGORY.key && season === NEW_CATEGORY.season))
      throw new Error(`Kategorie ${season}/${key} gibt es nicht`);
    for (const slug of slugs) {
      const spot = spotBySlug.get(slug);
      if (!spot) throw new Error(`Spot ${slug} gibt es nicht`);
      // Der Spot MUSS die Saison haben, sonst hängt die Zeile in einer Reihe, die ihn
      // nie zeigt. Lieber laut scheitern als still danebenliegen.
      if (!(spot.seasons ?? []).includes(season))
        throw new Error(`${slug} hat keine Saison ${season}, gehört also nicht in ${key}`);
      if (cid && existing.has(`${spot.id}/${cid}`)) {
        skipped++;
        continue;
      }
      if (cid) rows.push({ spot_id: spot.id, category_id: cid });
      console.log(`  ${go ? "ok   " : "würde"} ${slug.padEnd(30)} -> ${season}/${key}`);
    }
  }

  // Saison wegnehmen. Vorher prüfen, ob der Spot in dieser Saison noch in einer Reihe
  // hängt: Eine Zuordnung zu einer Winter-Reihe bei einem Spot ohne Winter wäre eine
  // Karteileiche, die niemand sieht und die beim nächsten Lauf niemandem auffällt.
  const seasonFix: { id: string; slug: string; seasons: string[] }[] = [];
  for (const slug of DROP_WINTER) {
    const spot = spotBySlug.get(slug);
    if (!spot) throw new Error(`Spot ${slug} gibt es nicht`);
    const seasons = (spot.seasons ?? []).filter((s: string) => s !== "winter");
    if (seasons.length === (spot.seasons ?? []).length) continue;
    if (!seasons.length) throw new Error(`${slug} hätte danach gar keine Saison mehr`);
    const stale = links.filter(
      (l) => l.spot_id === spot.id && cats.find((c) => c.id === l.category_id)?.season === "winter",
    );
    if (stale.length) throw new Error(`${slug} hängt noch in einer Winter-Reihe`);
    seasonFix.push({ id: spot.id, slug, seasons });
    console.log(`  ${go ? "ok   " : "würde"} ${slug.padEnd(30)} -> Saison ${JSON.stringify(seasons)}`);
  }

  console.log(
    `\n${rows.length} Zuordnungen${go ? " geschrieben" : ""}, ${skipped} gab es schon.` +
      ` ${seasonFix.length} Saison-Korrekturen.`,
  );
  if (!go) {
    console.log("TROCKENLAUF. Nichts geschrieben. Wirklich setzen: npm run wp:categories -- --go");
    return;
  }
  if (rows.length) {
    const { error } = await db.from("spot_categories").insert(rows);
    if (error) throw error;
  }
  for (const f of seasonFix) {
    const { error } = await db.from("spots").update({ seasons: f.seasons }).eq("id", f.id);
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
