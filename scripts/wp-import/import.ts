// Legt aus den Quelldaten der alten Seite Spot-ENTWÜRFE in der neuen Datenbank an.
// Aufruf:
//   npm run wp:import -- --dry                 zeigt, was entstünde
//   npm run wp:import -- --only gaisberg,maiers   einzelne Spots
//   npm run wp:import -- --go                  schreibt wirklich
//
// Es schreibt AUSSCHLIESSLICH Entwürfe (status = 'draft'). Veröffentlichen bleibt Handarbeit
// im Admin, und das Publish-Gate in saveSpot lässt das ohnehin erst zu, wenn Ort und alle
// Übersetzungen stehen.
//
// WARUM DIREKT IN DIE DB UND NICHT ÜBER saveSpot:
// saveSpot ist eine "use server"-Action mit Admin-Sitzung, aus einem Skript nicht aufrufbar.
// Damit hier trotzdem dasselbe herauskommt, werden die Regeln nicht nachgebaut, sondern
// dieselben Module importiert, die saveSpot benutzt: factCanonical/factPrice für die
// Quick-Facts, slugify für den Schlüssel, guardStorageUrl für jede Datei-Adresse,
// hashSpotTexts für den Übersetzungs-Stand, stripEmDashFields für den Gedankenstrich.
// Ein Nachbau wäre genau die Sorte zweiter Wahrheit, die später auseinanderläuft.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { factCanonical, factPrice } from "../../src/lib/facts-i18n.ts";
import { slugify } from "../../src/lib/slug.ts";
import { guardStorageUrl } from "../../src/lib/storage-guard.ts";
import { hashSpotTexts } from "../../src/lib/spot-hash.ts";
import { stripEmDashFields } from "../../src/lib/em-dash.ts";
import { routeLengthKm, haversineMeters } from "../../src/lib/geo.ts";
import type { WpSource } from "./parse.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");

const CACHE_DIR = ".wp-cache";
const SOURCE_DIR = join(CACHE_DIR, "source");
const DRAFT_DIR = join(CACHE_DIR, "drafts");
const MAP_FILE = join(CACHE_DIR, "media-map.json");

/** Fällt kein Name, gehört der Tipp Anton. Toni ist die KI, nicht der Local. */
const DEFAULT_LOCAL = "Anton";

type MapEntry = { newUrl: string; width?: number; height?: number; posterUrl?: string };
type Source = WpSource & {
  media: { images: { url: string; alt: string | null }[]; videos: { url: string }[] };
  computed: { routeKm: number | null; ascent: number | null; hikingMinutes: number | null };
};
/** Die von mir geschriebenen deutschen Texte. Ohne Entwurf wird der Spot übersprungen. */
type Draft = {
  shortDesc: string;
  general: string;
  insiderTip: string;
  sectionA: string;
  sectionB: string;
  locationText: string;
  emoji?: string;
  subtype?: string;
};

const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

// ── Zuordnungen ─────────────────────────────────────────────────────────────

// Food oder Activity entscheidet der INHALT, nicht der Typ-Marker der alten Seite. Der
// Marker ist unzuverlässig (18 Spots haben gar keinen, „hütte" meint vier Gipfelrestaurants),
// aber ein Abschnitt „Küche & Stil" hat genau dann jemand geschrieben, wenn es ums Essen
// geht. Über alle 98 Spots trennt das sauber: 18 food, 78 activity, 2 ohne Signal, und die
// zwei (Therme, Aussichtsplattform) sind richtig auf activity gefallen.
function spotType(src: Source): "food" | "activity" {
  const hasCuisine = src.facts.some((f) => f.field === "cuisine");
  const hasSection = src.sections.some((s) => s.label === "Küche & Stil");
  return hasCuisine || hasSection ? "food" : "activity";
}

// Typ-Marker der alten Seite -> kanonischer Subtyp der neuen Auswahlliste. Was hier fehlt,
// bleibt leer statt zu raten: Ein falscher Subtyp sortiert den Spot in die falsche Reihe
// und fällt niemandem auf.
const SUBTYPE_FROM_MARKER: Record<string, string> = {
  wanderung: "Wanderung",
  winterwanderung: "Winterwanderung",
  aussichtspunkt: "Aussichtspunkt",
  viewpoint: "Aussichtspunkt",
  wasserfall: "Wasserfall",
  klamm: "Klamm",
  see: "See & Baden",
  abkühlung: "See & Baden",
  burg: "Burg & Schloss",
  park: "Park & Garten",
  therme: "Therme",
  panoramastrasse: "Panoramastraße",
  panoramastraße: "Panoramastraße",
  rodeln: "Rodelbahn",
  langlaufen: "Langlaufloipe",
  ski: "Skigebiet",
  action: "Action & Fun",
  café: "Café",
  cafe: "Café",
  restaurant: "Restaurant",
  streetfood: "Streetfood",
  hütte: "Berghütte",
};

// Küchen-Angabe der alten Seite -> Subtyp, wo es einen passenden gibt. „österreichisch"
// ist eine Küche und kein Subtyp; solche Werte bleiben bewusst ohne Zuordnung und leben
// stattdessen im Text (section_a heisst „Küche & Stil").
const SUBTYPE_FROM_CUISINE: Record<string, string> = {
  "coffee spot": "Specialty Coffee",
  "ramen-bar": "Restaurant",
  imbiss: "Imbiss",
  "urban italian": "Pizzeria",
};

function subtypeOf(src: Source, draft: Draft): string | null {
  if (draft.subtype) return factCanonical("subtype", draft.subtype) ?? draft.subtype;
  const marker = (src.typeMarker ?? "").toLowerCase();
  if (SUBTYPE_FROM_MARKER[marker]) return SUBTYPE_FROM_MARKER[marker];
  const cuisine = src.facts.find((f) => f.field === "cuisine")?.value.toLowerCase();
  if (cuisine && SUBTYPE_FROM_CUISINE[cuisine]) return SUBTYPE_FROM_CUISINE[cuisine];
  return null;
}

// Saison. Die Karte STICHT die Jahreszeit-Angabe: Was auf der Gastein-Karte stand, ist
// Winter-Inhalt, und zwar auch dann, wenn eine Therme oder eine Bergbahn dort ganzjährig
// aufsperrt. Anton entscheidet das bewusst so, weil diese Spots durchweg Winterfotos
// haben; ein Sommerfoto-loser Spot auf der Sommerkarte sähe falscher aus als einer, der
// dort fehlt. Was im Sommer mitlaufen soll, gibt er später im Admin einzeln frei.
//
// Sonst gilt die alte Angabe. Ohne jede Angabe ist es Sommer, wie der Vorgabewert der
// Datenbank. „Ganzjährig" heisst beides, nicht „egal".
function seasonsOf(bestSeason: string | null, mapSeason: string | null | undefined): string[] {
  if (mapSeason) return [mapSeason];
  if (!bestSeason) return ["summer"];
  const s = bestSeason.toLowerCase();
  if (s.includes("ganzjährig")) return ["summer", "winter"];
  if (s.includes("dezember") || s === "winter") return ["winter"];
  return ["summer"];
}

const factValue = (src: Source, field: string): string | null => {
  const f = src.facts.find((x) => x.field === field);
  return f ? (f.canonical ?? f.value) : null;
};

// ── Route ───────────────────────────────────────────────────────────────────

function downsample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

// Kontrollpunkte für das Admin-Formular. Die Rohlinie hat bis zu 1447 Punkte; das Formular
// fällt ohne route_waypoints auf die gezeichnete Linie zurück und zeigte dann 1447 einzeln
// ziehbare Punkte an. Handgezeichnete Routen im Altbestand hatten 3 bis 21, also wird auf
// diese Grössenordnung eingedampft: einer alle ~400 m, mindestens 4, höchstens 20.
function waypointsFor(coords: [number, number][]): [number, number][] {
  const km = routeLengthKm(coords);
  const target = Math.max(4, Math.min(20, Math.round((km * 1000) / 400)));
  return downsample(coords, target);
}

// Auf- und Abstieg aus den Höhenwerten. Zacken unter 3 m werden verschluckt, sonst
// summiert sich das Rauschen der Höhendaten zu Höhenmetern, die niemand geht.
function ascentDescent(el: number[]): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  let ref = el[0];
  for (const e of el.slice(1)) {
    const d = e - ref;
    if (Math.abs(d) < 3) continue;
    if (d > 0) ascent += d;
    else descent -= d;
    ref = e;
  }
  return { ascent: Math.round(ascent), descent: Math.round(descent) };
}

// Format wie Migration 0006 und wie snapRoute es schreibt:
// { points:[{d(km), e(m)}], ascent, descent, min, max, distanceKm }, Punkte bei 100 gedeckelt.
function elevationProfile(coords: [number, number][], el: number[]) {
  const pts: { d: number; e: number }[] = [];
  let cum = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) cum += haversineMeters(coords[i - 1], coords[i]);
    pts.push({ d: cum / 1000, e: el[i] });
  }
  const { ascent, descent } = ascentDescent(el);
  return {
    points: downsample(pts, 100).map((p) => ({ d: Math.round(p.d * 100) / 100, e: Math.round(p.e) })),
    ascent,
    descent,
    min: Math.round(Math.min(...el)),
    max: Math.round(Math.max(...el)),
    distanceKm: cum / 1000,
  };
}

// ── Ein Spot ────────────────────────────────────────────────────────────────

async function importSpot(src: Source, draft: Draft, mediaMap: Record<string, MapEntry>, localId: string, dry: boolean) {
  const type = spotType(src);
  const notes: string[] = [];

  const bestSeason = factValue(src, "season");
  const route = src.route;
  const coords = route?.coords ?? [];
  const isRoute = coords.length >= 2;
  const el = route?.elevations ?? null;
  const profile = isRoute && el ? elevationProfile(coords, el) : null;

  // Bei einer Route ist der Startpunkt der Haupt-/Anreisepunkt, genau wie in saveSpot.
  const lat = isRoute ? coords[0][1] : src.lat;
  const lng = isRoute ? coords[0][0] : src.lng;

  // Jede Datei-Adresse durch denselben Riegel wie saveSpot. Eine fremde URL in der
  // media-Tabelle bricht next/image und liesse den Server beliebige Adressen abrufen.
  const images: { url: string; width: number | null; height: number | null; alt: string | null }[] = [];
  for (const img of src.media.images) {
    const m = mediaMap[img.url];
    if (!m) { notes.push(`Foto nicht übernommen: ${img.url.split("/").pop()}`); continue; }
    const g = guardStorageUrl(m.newUrl);
    if (!g.ok || !g.url) { notes.push(`Foto-Adresse abgelehnt: ${m.newUrl}`); continue; }
    images.push({ url: g.url, width: m.width ?? null, height: m.height ?? null, alt: img.alt });
  }

  const firstVideo = src.media.videos.map((v) => mediaMap[v.url]).find(Boolean);
  const videoUrl = firstVideo ? guardStorageUrl(firstVideo.newUrl) : { ok: true as const, url: null };
  const posterUrl = firstVideo?.posterUrl ? guardStorageUrl(firstVideo.posterUrl) : { ok: true as const, url: null };
  if (!videoUrl.ok || !posterUrl.ok) throw new Error("Video-Adresse abgelehnt");
  if (src.media.videos.length > 1)
    notes.push(`${src.media.videos.length} Videos vorhanden, die App zeigt eins`);

  const texts = stripEmDashFields(
    {
      title: src.title,
      shortDesc: draft.shortDesc,
      general: draft.general,
      insiderTip: draft.insiderTip,
      sectionA: draft.sectionA,
      sectionB: draft.sectionB,
      locationText: draft.locationText,
    },
    "de",
  );

  const row = {
    slug: slugify(src.slug),
    type,
    subtype: subtypeOf(src, draft),
    emoji: draft.emoji ?? src.emoji,
    seasons: seasonsOf(bestSeason, src.mapSeason),
    is_pro: src.isPro,
    status: "draft",
    sort_weight: 0,
    lat,
    lng,
    parking_lat: src.parkingLat,
    parking_lng: src.parkingLng,
    transit_lat: null,
    transit_lng: null,
    route_geojson: isRoute ? { type: "LineString", coordinates: coords } : null,
    route_waypoints: isRoute ? waypointsFor(coords) : null,
    elevation_profile: profile,
    difficulty: factCanonical("difficulty", factValue(src, "difficulty") ?? "") ?? null,
    best_season: bestSeason,
    access: factValue(src, "access"),
    // Dauer IMMER aus der alten Angabe, nie aus der importierten Linie gerechnet.
    //
    // Ich hatte es zuerst andersherum: DAV-Gehzeit aus der Linie, weil die App das beim
    // Snappen auch so macht. Der Vergleich mit den alten Angaben hat das widerlegt. Bei 16
    // von 45 vergleichbaren Routen ist die hinterlegte Linie weit kürzer als der
    // beschriebene Weg — die Seisenbergklamm hat 160 Meter bei angegebenen zwei Stunden.
    // Die Linien sind unvollständig gezeichnet, nicht falsch gemessen.
    //
    // Aus einer halben Linie eine Gehzeit zu rechnen ergibt eine Zahl, die stimmig aussieht
    // und falsch ist: „27 min" für den Gaisberg. Die alte Angabe ist dagegen Antons eigenes
    // Wissen. Sobald er eine Route im Admin nachzieht und neu snappt, rechnet die App die
    // Gehzeit ohnehin selbst und überschreibt sie richtig.
    duration: factValue(src, "duration"),
    price_level: factPrice(factValue(src, "priceLevel") ?? ""),
    area: factCanonical("area", factValue(src, "area") ?? "") ?? factValue(src, "area"),
    fame: factCanonical("fame", factValue(src, "fame") ?? "") ?? null,
    local_id: localId,
    video_url: videoUrl.url,
    video_poster_url: posterUrl.url,
    // Öffnungszeiten brauchen eine Google-Place-ID, die die alte Seite nicht hat.
    // Bewusst aus, damit kein Spot mit leerem Öffnungszeiten-Block dasteht.
    has_opening_hours: false,
  };

  if (dry) return { row, images, texts, notes };

  const { data: spot, error } = await db.from("spots").insert(row).select("id").single();
  if (error) throw new Error(`spots: ${error.message}`);
  const spotId = spot.id as string;

  // source_hash steht auf spot_translations (Migration 0031), NICHT auf spots. Er hält
  // fest, aus welchem deutschen Text eine Übersetzung entstand; weicht er ab, meldet der
  // Admin „veraltet". Beim deutschen Datensatz ist er der Hash seiner selbst. Fehlt er,
  // gilt die spätere Übersetzung sofort als veraltet, obwohl sie frisch ist.
  const { error: tErr } = await db.from("spot_translations").insert({
    spot_id: spotId,
    lang: "de",
    title: texts.title,
    short_desc: texts.shortDesc,
    general: texts.general,
    insider_tip: texts.insiderTip,
    section_a: texts.sectionA,
    section_b: texts.sectionB,
    location_text: texts.locationText,
    source_hash: hashSpotTexts(texts),
  });
  if (tErr) throw new Error(`spot_translations: ${tErr.message}`);

  if (images.length) {
    const { error: mErr } = await db.from("media").insert(
      images.map((img, i) => ({
        spot_id: spotId,
        type: "image",
        role: i === 0 ? "hero" : "gallery",
        url: img.url,
        alt: img.alt,
        sort_order: i,
      })),
    );
    if (mErr) throw new Error(`media: ${mErr.message}`);
  }

  return { row, images, texts, notes, spotId };
}

// ── Lauf ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dry = !args.includes("--go");
  const onlyArg = args.indexOf("--only");
  const only = onlyArg >= 0 ? new Set(args[onlyArg + 1].split(",")) : null;

  if (!existsSync(MAP_FILE)) throw new Error(`${MAP_FILE} fehlt — bitte zuerst "npm run wp:media"`);
  const mediaMap = JSON.parse(readFileSync(MAP_FILE, "utf8")) as Record<string, MapEntry>;

  const { data: locals } = await db.from("locals").select("id, name");
  const localId = (locals ?? []).find((l) => l.name === DEFAULT_LOCAL)?.id as string | undefined;
  if (!localId) throw new Error(`Local "${DEFAULT_LOCAL}" fehlt in der Tabelle locals`);

  const slugs = readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .filter((s) => !only || only.has(s));

  let done = 0;
  let skipped = 0;
  const allNotes: string[] = [];

  for (const slug of slugs) {
    const draftFile = join(DRAFT_DIR, `${slug}.json`);
    if (!existsSync(draftFile)) {
      skipped++;
      continue;
    }
    const src = JSON.parse(readFileSync(join(SOURCE_DIR, `${slug}.json`), "utf8")) as Source;
    const draft = JSON.parse(readFileSync(draftFile, "utf8")) as Draft;

    try {
      const r = await importSpot(src, draft, mediaMap, localId, dry);
      done++;
      console.log(
        `  ${dry ? "würde" : "ok   "} ${slug.padEnd(34)} ${r.row.type.padEnd(8)} ${r.images.length} Fotos${r.row.video_url ? " +Video" : ""}${r.row.route_geojson ? ` Route ${r.row.duration}` : ""}${src.isPro ? "  PRO" : ""}`,
      );
      for (const n of r.notes) allNotes.push(`${slug}: ${n}`);
    } catch (err) {
      console.log(`  FEHLER ${slug}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("");
  console.log(`${done} Spots ${dry ? "vorbereitet" : "angelegt"}, ${skipped} ohne Text-Entwurf übersprungen.`);
  if (allNotes.length) {
    console.log("\nAnmerkungen:");
    for (const n of allNotes) console.log(`  ${n}`);
  }
  if (dry) console.log("\nTROCKENLAUF. Nichts geschrieben. Wirklich anlegen: npm run wp:import -- --go");
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
