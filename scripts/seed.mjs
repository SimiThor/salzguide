// Seed-Runner über die Supabase-API (service_role) — Alternative zu supabase/seed.sql.
// Vorteil: keine SQL-Escaping-/Copy-Paste-Probleme. Idempotent (upsert).
// Aufruf:  node scripts/seed.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// .env.local einlesen
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function check(label, error) {
  if (error) {
    console.error(`❌ ${label}:`, error.message);
    process.exit(1);
  }
  console.log(`✅ ${label}`);
}

// --- Kategorien ---------------------------------------------------------------
const categories = [
  { key: "favs",      season: "summer", sort_order: 1, title_translations: { de: "Favoriten unserer Community ❤️", en: "Community Favorites ❤️" } },
  { key: "hike-ez",   season: "summer", sort_order: 2, title_translations: { de: "Wanderungen – Leicht & Mittel", en: "Hikes – Easy & Medium" } },
  { key: "lakes",     season: "summer", sort_order: 3, title_translations: { de: "Seen & Stege", en: "Lakes & Piers" } },
  { key: "food",      season: "summer", sort_order: 4, title_translations: { de: "Food Spots", en: "Food Spots" } },
  { key: "hills",     season: "summer", sort_order: 5, title_translations: { de: "City & Nearby Hills", en: "City & Nearby Hills" } },
  { key: "gorges",    season: "summer", sort_order: 6, title_translations: { de: "Klammen & Wasserfälle", en: "Gorges & Waterfalls" } },
  { key: "roads",     season: "summer", sort_order: 7, title_translations: { de: "Panoramastraßen", en: "Scenic Roads" } },
  { key: "hike-hard", season: "summer", sort_order: 8, title_translations: { de: "Wanderungen – Anspruchsvoll", en: "Hikes – Challenging" } },
  { key: "food",      season: "winter", sort_order: 1, title_translations: { de: "Skihütten & Cafés", en: "Ski Huts & Cafés" } },
  { key: "view",      season: "winter", sort_order: 2, title_translations: { de: "Aussicht & Erholung", en: "Views & Relaxation" } },
  { key: "action",    season: "winter", sort_order: 3, title_translations: { de: "Action & Bahnen", en: "Action & Lifts" } },
];

// --- Spots --------------------------------------------------------------------
const spots = [
  { slug: "aignerpark", type: "activity", subtype: "Spaziergang", duration: "~1 Std", seasons: ["summer"], is_pro: false, status: "published", sort_weight: 100, emoji: "🌳",
    lat: 47.7855, lng: 13.0896, parking_lat: 47.78551, parking_lng: 13.08962, transit_lat: 47.78595, transit_lng: 13.08963,
    difficulty: "leicht", best_season: "Frühling–Herbst", access: "beides", loc: "stadt", kids: true, bus: true, vibes: ["wandern"], has_opening_hours: false },
  { slug: "karaffu", type: "food", subtype: "Café", seasons: ["summer"], is_pro: false, status: "published", sort_weight: 90, emoji: "☕",
    lat: 47.8009, lng: 13.0432, parking_lat: 47.8009, parking_lng: 13.0432,
    price_level: "mittel", area: "Stadt Salzburg", fame: "Hidden Gem", loc: "stadt", kids: false, bus: true, vibes: [], has_opening_hours: true },
  { slug: "fuschlsee", type: "activity", subtype: "See", duration: "1–2 Std", seasons: ["summer"], is_pro: false, status: "published", sort_weight: 80, emoji: "🏊",
    lat: 47.7956, lng: 13.2736, parking_lat: 47.7956, parking_lng: 13.2736, transit_lat: 47.7950, transit_lng: 13.2700,
    difficulty: "leicht", best_season: "Sommer", access: "beides", loc: "seen", kids: true, bus: true, vibes: ["wasser"], lake_name: "Fuschlsee", has_opening_hours: false },
  { slug: "liechtensteinklamm", type: "activity", subtype: "Klamm", duration: "1–1,5 Std", seasons: ["summer"], is_pro: true, status: "published", sort_weight: 70, emoji: "🏞️",
    lat: 47.3280, lng: 13.1970, parking_lat: 47.3290, parking_lng: 13.1960, transit_lat: 47.3270, transit_lng: 13.1990,
    difficulty: "mittel", best_season: "Mai–Oktober", access: "auto", loc: "berge", kids: true, bus: false, vibes: ["wasser", "wandern"], has_opening_hours: true },
  { slug: "alpentherme-gastein", type: "activity", subtype: "Therme", duration: "Halbtag", seasons: ["winter"], is_pro: false, status: "published", sort_weight: 60, emoji: "♨️",
    lat: 47.1715, lng: 13.0990, parking_lat: 47.1715, parking_lng: 13.0990, transit_lat: 47.1700, transit_lng: 13.1010,
    best_season: "Ganzjährig", access: "beides", area: "Gastein", loc: "berge", kids: true, bus: true, vibes: [], has_opening_hours: true },
];

// --- Übersetzungen (je Spot DE + EN) -----------------------------------------
const translations = {
  aignerpark: {
    de: { title: "Aignerpark", short_desc: "Ruhiger Stadtpark mit Teich und kurzem Waldweg.",
      general: "Der Aignerpark liegt am Stadtrand von Salzburg und ist perfekt für eine kurze Runde zwischen alten Bäumen. Ein kleiner Teich, schattige Wege und genug Platz zum Durchatmen – ohne weit rauszufahren.",
      insider_tip: "Geh früh am Morgen, dann hast du die Wege fast für dich. Oben am Hang gibts einen Blick über die Stadt, den kaum jemand kennt.",
      section_a: "Etwa 1 Stunde, leichte Runde. Gut auch mit Kinderwagen.", section_b: "Schön von Frühling bis Herbst, im Herbst besonders ruhig.",
      location_text: "Am südöstlichen Stadtrand. Mit dem Bus erreichbar, Parkplätze direkt am Eingang." },
    en: { title: "Aignerpark", short_desc: "Quiet city park with a pond and a short forest loop.",
      general: "Aignerpark sits at the edge of Salzburg and is perfect for a short loop among old trees. A small pond, shady paths and enough room to breathe – without driving far.",
      insider_tip: "Go early in the morning and the paths are almost yours. Up on the slope there is a view over the city that few people know.",
      section_a: "About 1 hour, easy loop. Stroller-friendly.", section_b: "Nice from spring to autumn, especially calm in fall.",
      location_text: "On the south-eastern edge of town. Reachable by bus, parking right at the entrance." },
  },
  karaffu: {
    de: { title: "Karaffu", short_desc: "Kleiner Coffee Spot mit richtig gutem Espresso.",
      general: "Karaffu ist ein unaufgeregtes Café in der Stadt, in dem der Kaffee im Mittelpunkt steht. Specialty Coffee, ein paar Plätze, freundliche Leute – ideal für eine Pause zwischendurch.",
      insider_tip: "Frag nach dem Filterkaffee des Tages. Wenn der Pistazien-Snack da ist, nimm ihn.",
      section_a: "Specialty Coffee, klein und gemütlich.", section_b: "Mittleres Preisniveau, fair für die Qualität.",
      location_text: "Mitten in der Stadt Salzburg, gut zu Fuß oder mit dem Bus erreichbar." },
    en: { title: "Karaffu", short_desc: "Small coffee spot with seriously good espresso.",
      general: "Karaffu is a laid-back café in town where the coffee is the point. Specialty coffee, a few seats, friendly people – ideal for a quick break.",
      insider_tip: "Ask for the filter coffee of the day. If the pistachio snack is in, grab it.",
      section_a: "Specialty coffee, small and cosy.", section_b: "Mid-range prices, fair for the quality.",
      location_text: "Right in the city of Salzburg, easy to reach on foot or by bus." },
  },
  fuschlsee: {
    de: { title: "Fuschlsee", short_desc: "Klarer See zum Schwimmen und Spazieren.",
      general: "Der Fuschlsee hat richtig klares Wasser und eine schöne Runde am Ufer. Im Sommer zum Schwimmen, sonst für einen entspannten Spaziergang mit Blick aufs Wasser.",
      insider_tip: "Das Ostufer ist ruhiger als der Ortsbereich. Nimm dir Zeit für die Uferrunde.",
      section_a: "Leichte Uferrunde, je nach Lust 1 bis 2 Stunden.", section_b: "Am besten im Sommer, klares Wasser auch im Frühherbst.",
      location_text: "Rund 20 Minuten von Salzburg. Mit Auto und Bus erreichbar." },
    en: { title: "Fuschlsee", short_desc: "Clear lake for swimming and strolling.",
      general: "Fuschlsee has really clear water and a nice loop along the shore. Swim in summer, or take a relaxed walk with the water in view the rest of the year.",
      insider_tip: "The eastern shore is quieter than the village side. Take your time on the shore loop.",
      section_a: "Easy shore loop, 1 to 2 hours depending on your mood.", section_b: "Best in summer, clear water into early autumn too.",
      location_text: "About 20 minutes from Salzburg. Reachable by car and bus." },
  },
  liechtensteinklamm: {
    de: { title: "Liechtensteinklamm", short_desc: "Enge Klamm mit tosendem Wasser und Steg.",
      general: "Die Liechtensteinklamm führt auf Stegen tief in eine enge Schlucht hinein. Das Wasser donnert neben dir, die Felswände rücken eng zusammen – ein kurzes, intensives Erlebnis.",
      insider_tip: "Geh unter der Woche und am Vormittag, dann ist weniger los auf den schmalen Stegen.",
      section_a: "Etwa 1 bis 1,5 Stunden hin und zurück, mittel. Festes Schuhwerk.", section_b: "Geöffnet von Mai bis Oktober, im Hochsommer am vollsten.",
      location_text: "Bei St. Johann im Pongau. Am besten mit dem Auto zum Parkplatz." },
    en: { title: "Liechtensteinklamm", short_desc: "Narrow gorge with roaring water and walkways.",
      general: "The Liechtensteinklamm takes you on walkways deep into a narrow gorge. The water roars beside you, the rock walls close in – a short, intense experience.",
      insider_tip: "Go midweek and in the morning for fewer people on the narrow walkways.",
      section_a: "About 1 to 1.5 hours round trip, medium. Wear sturdy shoes.", section_b: "Open from May to October, busiest in high summer.",
      location_text: "Near St. Johann im Pongau. Best reached by car to the car park." },
  },
  "alpentherme-gastein": {
    de: { title: "Alpentherme Gastein", short_desc: "Große Therme zum Aufwärmen nach dem Skitag.",
      general: "Die Alpentherme in Bad Hofgastein ist der Ort zum Aufwärmen, wenn es draußen kalt ist. Innen- und Außenbecken, Sauna und genug Platz, um nach dem Skifahren runterzukommen.",
      insider_tip: "Komm am späten Nachmittag, wenn die Skifahrer noch am Berg sind – dann hast du mehr Ruhe im Wasser.",
      section_a: "Plan ein paar Stunden ein, ideal nach dem Skitag.", section_b: "Im Winter besonders schön, aber ganzjährig offen.",
      location_text: "In Bad Hofgastein im Gasteinertal. Mit Auto und Bahn erreichbar." },
    en: { title: "Alpentherme Gastein", short_desc: "Big thermal spa to warm up after a day on the slopes.",
      general: "The Alpentherme in Bad Hofgastein is the place to warm up when it is cold outside. Indoor and outdoor pools, sauna and plenty of room to wind down after skiing.",
      insider_tip: "Come late afternoon while the skiers are still on the mountain – the water is calmer then.",
      section_a: "Plan a few hours, ideal after a ski day.", section_b: "Especially nice in winter, but open all year.",
      location_text: "In Bad Hofgastein in the Gastein valley. Reachable by car and train." },
  },
};

// --- Spot <-> Kategorie -------------------------------------------------------
const links = [
  ["aignerpark", "hills", "summer"],
  ["aignerpark", "favs", "summer"],
  ["karaffu", "food", "summer"],
  ["fuschlsee", "lakes", "summer"],
  ["liechtensteinklamm", "gorges", "summer"],
  ["alpentherme-gastein", "view", "winter"],
];

// --- Ausführen ----------------------------------------------------------------
check("categories", (await supabase.from("categories").upsert(categories, { onConflict: "key,season" })).error);
check("spots", (await supabase.from("spots").upsert(spots, { onConflict: "slug" })).error);

const { data: spotRows, error: spotErr } = await supabase.from("spots").select("id,slug");
check("spots laden", spotErr);
const spotId = Object.fromEntries(spotRows.map((s) => [s.slug, s.id]));

const { data: catRows, error: catErr } = await supabase.from("categories").select("id,key,season");
check("categories laden", catErr);
const catId = Object.fromEntries(catRows.map((c) => [`${c.key}:${c.season}`, c.id]));

const translationRows = [];
for (const [slug, langs] of Object.entries(translations)) {
  for (const [lang, t] of Object.entries(langs)) {
    translationRows.push({ spot_id: spotId[slug], lang, insider_author: "Anton, Local", ...t });
  }
}
check("spot_translations", (await supabase.from("spot_translations").upsert(translationRows, { onConflict: "spot_id,lang" })).error);

const linkRows = links.map(([slug, key, season]) => ({ spot_id: spotId[slug], category_id: catId[`${key}:${season}`] }));
check("spot_categories", (await supabase.from("spot_categories").upsert(linkRows, { onConflict: "spot_id,category_id" })).error);

// --- Locals (Empfehlende mit Foto für Insider-Tipps) -------------------------
check(
  "locals",
  (
    await supabase
      .from("locals")
      .upsert([{ name: "Anton", role: "Local aus Salzburg", avatar_url: null }], {
        onConflict: "name",
      })
  ).error,
);
const { data: antonRow, error: antonErr } = await supabase
  .from("locals")
  .select("id")
  .eq("name", "Anton")
  .single();
check("locals laden", antonErr);
check(
  "spots ↔ local",
  (await supabase.from("spots").update({ local_id: antonRow.id }).in("slug", Object.keys(spotId))).error,
);

console.log(`\n🎉 Seed fertig: ${categories.length} Kategorien, ${spots.length} Spots, ${translationRows.length} Übersetzungen, ${linkRows.length} Verknüpfungen, 1 Local.`);
