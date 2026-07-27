// Füllt Spot-Felder, die nach dem Import leer geblieben sind. Aufruf:
//   npm run wp:fill
//   npm run wp:fill -- --go
//
// Vier Quellen, in dieser Reihenfolge der Verlässlichkeit:
//
// 1. PARKPLATZ aus der alten Seite. Jeder zweite Beitrag trug einen Link „🚗 Route zum
//    Parkplatz" mit Koordinaten. Der Import hat ihn nie gelesen, weil parse.ts nur das
//    Shortcode-Attribut `lat_park` kennt (5 Spots). Aus den Links kommen 18 dazu.
// 2. GEBIET aus der Geografie. Die Gemeinde eines Spots ist ein Fakt, kein Urteil.
// 3. ANREISE aus dem eigenen Ortstext.
// 4. PREIS und BEKANNTHEIT: Urteil. Beim Preis nur „kostenlos", und nur wo es sicher ist.
//
// WARUM DER PARKPLATZ NUR AB 30 METERN GESETZT WIRD: Bei 49 der 67 Links zeigt die
// Koordinate auf den Spot selbst — die alte Seite hat dort schlicht den Hauptpunkt
// wiederverwendet. Ein Parkplatz-Pin drei Meter neben dem Spot-Pin bringt niemandem etwas
// und verdeckt ihn auf der Karte. Wo der Abstand echt ist, ist er wertvoll: Der Wert steuert
// auch das Navi-Ziel des Auto-Knopfes (`carDest` in der Detailseite), und der Asitz-Parkplatz
// liegt vier Kilometer und 1.000 Höhenmeter unter dem Spot.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { haversineMeters } from "../../src/lib/geo.ts";
import { factCanonical } from "../../src/lib/facts-i18n.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

/** Ab hier ist der Parkplatz ein eigener Ort und nicht der Spot selbst. */
const MIN_PARK_M = 30;

/** Gemeinde bzw. Stadtteil. Aus den Koordinaten und dem Ortstext, nicht geraten. */
const GEBIET: Record<string, string> = {
  // Stadt Salzburg
  aignerpark: "Aigen",
  almkanal: "Stadt Salzburg",
  burglstein: "Stadt Salzburg",
  "dom-zu-salzburg": "Altstadt",
  "festung-hohensalzburg": "Altstadt",
  freisaalweg: "Salzburg-Süd",
  gaisberg: "Gaisberg",
  "hangar-7": "Maxglan",
  "hellbrunner-allee": "Hellbrunn",
  kapuzinerberg: "Kapuzinerberg",
  "leopoldskroner-weiher": "Leopoldskron",
  makartplatz: "Neustadt",
  mirabellgarten: "Neustadt",
  monchsberg: "Mönchsberg",
  nonnberggasse: "Altstadt",
  richterhohe: "Mönchsberg",
  "schlosspark-hellbrunn": "Hellbrunn",
  // Flachgau
  falkensteinwand: "St. Gilgen",
  "fuschlsee-steg": "Hof bei Salzburg",
  "hintersee-badeplatz": "Faistenau",
  "maria-plain": "Bergheim",
  nockstein: "Koppl",
  schafberg: "Wolfgangsee-Region", // St. Wolfgang liegt in Oberösterreich
  spinnerin: "Wolfgangsee-Region",
  "wolfgangsee-schifffahrt": "St. Gilgen",
  zwolferhorn: "St. Gilgen",
  // Tennengau
  bluntautal: "Golling an der Salzach",
  "gollinger-wasserfall": "Golling an der Salzach",
  "groser-barmstein": "Hallein",
  "halleiner-altstadt": "Hallein",
  postalm: "Abtenau",
  "sommerrodelbahn-abtenau": "Abtenau",
  wiestalstausee: "Hallein",
  // Pongau
  "bad-gastein": "Bad Gastein",
  "blick-auf-hohenwerfen": "Werfen",
  bondlsee: "Goldegg im Pongau",
  "burg-hohenwerfen": "Werfen",
  ellmautal: "Großarl",
  gamskarkogel: "Bad Gastein",
  gamskogerl: "Goldegg im Pongau",
  "goldegger-see": "Goldegg im Pongau",
  "hochkeil-spiegelsee": "Mühlbach am Hochkönig",
  jagersee: "Kleinarl",
  lackenkogel: "Flachau",
  oberhutte: "Region Obertauern",
  schuhflickersee: "Großarl",
  "sound-of-music-trail": "Werfen",
  "tappenkar-wasserfall": "Kleinarl",
  tappenkarsee: "Kleinarl",
  // Pinzgau
  "almwelt-lofer": "Lofer",
  asitz: "Leogang",
  "grosglockner-hochalpenstrase": "Fusch an der Großglocknerstraße",
  "hintersee-pinzgau": "Mittersill",
  innersbachklamm: "Unken",
  "krimmler-wasserfalle": "Krimml",
  lamprechtshohle: "Weißbach bei Lofer",
  prinzensee: "Maria Alm am Steinernen Meer",
  ritzensee: "Saalfelden am Steinernen Meer",
  schmittenhohe: "Zell am See",
  seisenbergklamm: "Weißbach bei Lofer",
  "sigmund-thun-klamm": "Kaprun",
  tristkogel: "Saalbach-Hinterglemm",
  vorderkaserklamm: "St. Martin bei Lofer",
  // Die Rossfeld-Panoramastrasse liegt in Bayern. Dafür gibt es in der Liste nichts, und
  // ein falsches Gebiet ist schlimmer als keins.
};

/** Anreise aus dem eigenen Ortstext. Alle dreizehn sind Gastein-Winterspots, deren alte
 *  Quick-Facts `vibe` statt `access` führten. */
const ANREISE: Record<string, string> = {
  alpentherme: "beides",
  "aussichtsplattform-schlossalmblick": "beides",
  "early-winter-mountainkart": "beides",
  felsentherme: "beides",
  "gipfelbahn-fulseck": "beides",
  "glocknerblick-aussichtsplattform": "beides",
  goldbergbahn: "beides",
  "kaiser-wilhelm-promenade": "oeffis", // der Text nennt Bahnhof und Ortsbus, kein Parken
  "panoramakugel-sportgastein": "beides",
  schlossalmbahn: "beides",
  stubnerkogel: "beides",
  stubnerkogelbahn: "beides",
  "wasserfall-bad-gastein": "beides",
};

/**
 * Nur „kostenlos", und nur wo es sicher ist: öffentlicher Weg, freier Platz, kein Eintritt
 * und keine Mautstrasse auf dem Weg dorthin.
 *
 * BEWUSST NICHT GEFÜLLT sind die kostenpflichtigen. Dass die Seisenbergklamm Eintritt
 * kostet, weiss ich; ob das € oder €€ ist, nicht. Eine geratene Preisstufe steht danach als
 * Tatsache auf dem Kärtchen, und niemand sieht ihr an, dass sie geraten war. Ebenso bleiben
 * die Bergbahn-Spots leer: Wandern ist dort gratis, die Bahn nicht.
 */
const KOSTENLOS = [
  "aignerpark", "almkanal", "bad-gastein", "blick-auf-hohenwerfen", "bluntautal", "bondlsee",
  "burglstein", "dom-zu-salzburg", "ellmautal", "freisaalweg", "fuschlsee-steg", "gaisberg",
  "gamskarkogel", "gamskogerl", "goldegger-see", "groser-barmstein", "halleiner-altstadt",
  "hangar-7", "hellbrunner-allee", "hintersee-badeplatz", "hintersee-pinzgau",
  "hochkeil-spiegelsee", "innersbachklamm", "jagersee", "kapuzinerberg", "lackenkogel",
  "leopoldskroner-weiher", "makartplatz", "maria-plain", "mirabellgarten", "monchsberg",
  "nockstein", "nonnberggasse", "oberhutte", "prinzensee", "richterhohe", "ritzensee",
  "schlosspark-hellbrunn", "sound-of-music-trail", "spinnerin", "tristkogel", "wiestalstausee",
];

/**
 * Bekanntheit. Das ist ein Urteil und kein Fakt, deshalb steht es hier zum Überschreiben:
 * Touristen-Hotspot = steht in jedem Reiseplan und hat einen Busparkplatz. Bekannt = kennt
 * man in der Region. Lokal beliebt = Einheimische gehen hin, Reisende selten. Hidden Gem =
 * auch Einheimische müssen überlegen.
 */
const BEKANNTHEIT: Record<string, string> = {
  "burg-hohenwerfen": "Touristen-Hotspot",
  "dom-zu-salzburg": "Touristen-Hotspot",
  "festung-hohensalzburg": "Touristen-Hotspot",
  "grosglockner-hochalpenstrase": "Touristen-Hotspot",
  "hangar-7": "Touristen-Hotspot",
  "krimmler-wasserfalle": "Touristen-Hotspot",
  mirabellgarten: "Touristen-Hotspot",
  schafberg: "Touristen-Hotspot",
  "schlosspark-hellbrunn": "Touristen-Hotspot",
  "sigmund-thun-klamm": "Touristen-Hotspot",
  "sound-of-music-trail": "Touristen-Hotspot",
  "wolfgangsee-schifffahrt": "Touristen-Hotspot",

  "almwelt-lofer": "Bekannt",
  asitz: "Bekannt",
  "bad-gastein": "Bekannt",
  bluntautal: "Bekannt",
  gaisberg: "Bekannt",
  "gollinger-wasserfall": "Bekannt",
  "halleiner-altstadt": "Bekannt",
  kapuzinerberg: "Bekannt",
  lamprechtshohle: "Bekannt",
  makartplatz: "Bekannt",
  "maria-plain": "Bekannt",
  monchsberg: "Bekannt",
  postalm: "Bekannt",
  ritzensee: "Bekannt",
  "rossfeld-panoramastrase": "Bekannt",
  schmittenhohe: "Bekannt",
  seisenbergklamm: "Bekannt",
  "sommerrodelbahn-abtenau": "Bekannt",
  tappenkarsee: "Bekannt",
  zwolferhorn: "Bekannt",

  aignerpark: "Lokal beliebt",
  almkanal: "Lokal beliebt",
  burglstein: "Lokal beliebt",
  falkensteinwand: "Lokal beliebt",
  freisaalweg: "Lokal beliebt",
  "fuschlsee-steg": "Lokal beliebt",
  "goldegger-see": "Lokal beliebt",
  "groser-barmstein": "Lokal beliebt",
  "hellbrunner-allee": "Lokal beliebt",
  "hintersee-badeplatz": "Lokal beliebt",
  jagersee: "Lokal beliebt",
  "leopoldskroner-weiher": "Lokal beliebt",
  nockstein: "Lokal beliebt",
  nonnberggasse: "Lokal beliebt",
  richterhohe: "Lokal beliebt",
  vorderkaserklamm: "Lokal beliebt",
  wiestalstausee: "Lokal beliebt",

  "blick-auf-hohenwerfen": "Hidden Gem",
  bondlsee: "Hidden Gem",
  ellmautal: "Hidden Gem",
  gamskarkogel: "Hidden Gem",
  gamskogerl: "Hidden Gem",
  "hintersee-pinzgau": "Hidden Gem",
  "hochkeil-spiegelsee": "Hidden Gem",
  innersbachklamm: "Hidden Gem",
  lackenkogel: "Hidden Gem",
  oberhutte: "Hidden Gem",
  prinzensee: "Hidden Gem",
  schuhflickersee: "Hidden Gem",
  spinnerin: "Hidden Gem",
  "tappenkar-wasserfall": "Hidden Gem",
  tristkogel: "Hidden Gem",
};

/** Parkplatz-Links aus dem Rohinhalt der alten Beiträge. */
function parkingFromOldSite(): Map<string, { lat: number; lng: number; label: string }> {
  const posts: { slug: string; content?: { raw?: string } }[] = JSON.parse(
    readFileSync(join(".wp-cache", "posts.json"), "utf8"),
  );
  const RE =
    /<a[^>]+href="[^"]*maps\/dir\/\?api=1[^"]*destination=([0-9.]+)\s*,\s*([0-9.]+)[^"]*"[^>]*>([\s\S]{0,120}?)<\/a>/g;
  const out = new Map<string, { lat: number; lng: number; label: string }>();
  for (const p of posts) {
    // Erst die Adresse lesbar machen. Die Ziele stehen als „…destination=47.75,%2013.25":
    // Wer %20 nicht auflöst, liest die 20 als Anfang des Längengrads und landet in China.
    // Genau das ist beim ersten Lauf passiert, sichtbar an 9.221 km Abstand zum Spot.
    const raw = (p.content?.raw ?? "")
      .replace(/&#038;/g, "&")
      .replace(/%20/g, " ")
      .replace(/%2C/gi, ",");
    for (const m of raw.matchAll(RE)) {
      const label = m[3].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      if (!/park|start/i.test(label)) continue;
      out.set(p.slug, { lat: Number(m[1]), lng: Number(m[2]), label });
    }
  }
  return out;
}

async function main() {
  const go = process.argv.includes("--go");
  const { data: spots } = await db
    .from("spots")
    .select("id, slug, type, lat, lng, area, access, price_level, fame, parking_lat, parking_lng");
  if (!spots) throw new Error("Lesen fehlgeschlagen");
  const bySlug = new Map(spots.map((s) => [s.slug, s]));

  const updates = new Map<string, Record<string, unknown>>();
  const plan = (slug: string, patch: Record<string, unknown>) => {
    const cur = updates.get(slug) ?? {};
    updates.set(slug, { ...cur, ...patch });
  };

  console.log("── PARKPLATZ (aus den Links der alten Seite) ──");
  let zuNah = 0;
  for (const [slug, p] of parkingFromOldSite()) {
    const s = bySlug.get(slug);
    if (!s?.lat || s.parking_lat != null) continue;
    const d = Math.round(haversineMeters([p.lng, p.lat], [s.lng!, s.lat]));
    if (d < MIN_PARK_M) {
      zuNah++;
      continue;
    }
    console.log(`  ${slug.padEnd(30)} ${String(d).padStart(5)} m vom Spot   „${p.label}"`);
    plan(slug, { parking_lat: p.lat, parking_lng: p.lng });
  }
  console.log(`  (${zuNah} Links zeigen auf den Spot selbst, unter ${MIN_PARK_M} m — übersprungen)`);

  for (const [titel, tabelle, feld] of [
    ["GEBIET", GEBIET, "area"],
    ["ANREISE", ANREISE, "access"],
    ["BEKANNTHEIT", BEKANNTHEIT, "fame"],
  ] as const) {
    console.log(`\n── ${titel} ──`);
    let n = 0;
    for (const [slug, wert] of Object.entries(tabelle)) {
      const s = bySlug.get(slug);
      if (!s) throw new Error(`Spot ${slug} gibt es nicht`);
      if (s[feld] != null) continue;
      // Gegen Tippfehler: Was die App nicht auflöst, darf nicht in die Spalte.
      if (feld !== "access") {
        const canon = factCanonical(feld === "area" ? "area" : "fame", wert);
        if (!canon) throw new Error(`${slug}: „${wert}" ist kein gültiger Wert für ${feld}`);
      }
      plan(slug, { [feld]: wert });
      n++;
    }
    console.log(`  ${n} Spots`);
  }

  console.log("\n── PREIS: kostenlos ──");
  let k = 0;
  for (const slug of KOSTENLOS) {
    const s = bySlug.get(slug);
    if (!s) throw new Error(`Spot ${slug} gibt es nicht`);
    if (s.price_level != null) continue;
    plan(slug, { price_level: "kostenlos" });
    k++;
  }
  console.log(`  ${k} Spots`);

  console.log(`\n${updates.size} Spots bekommen zusammen ${[...updates.values()].reduce((n, u) => n + Object.keys(u).length, 0)} Werte.`);
  if (!go) {
    console.log("TROCKENLAUF. Nichts geschrieben. Wirklich setzen: npm run wp:fill -- --go");
    return;
  }
  for (const [slug, patch] of updates) {
    const { error } = await db.from("spots").update(patch).eq("id", bySlug.get(slug)!.id);
    if (error) throw error;
  }
  console.log("Geschrieben.");
}

main();
