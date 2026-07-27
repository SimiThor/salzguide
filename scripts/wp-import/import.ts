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

// ── Kategorien ──────────────────────────────────────────────────────────────

// Die alten WordPress-Kategorien auf die Karussell-Reihen der neuen App. Zugeordnet wird
// NUR, wo der neue Name den alten wirklich enthält — bei allem anderen bleibt der Spot ohne
// Kategorie und steht im Report. Eine falsche Reihe sortiert den Spot an eine Stelle, an der
// ihn niemand sucht, und das fällt keinem auf, weil ja etwas dasteht.
//
// „aussichtspunkte" (18 Spots) ist bewusst NICHT dabei. Die neue Reihe heisst „City &
// Nearby Hills", und die alte Kategorie mischt Mönchsberg und Kapuzinerberg mit Schafberg,
// Maria Plain und der Wolfgangsee-Schifffahrt. Die Hälfte läge falsch.
// „burgen", „parks" und „sonstige" haben in der neuen Einteilung schlicht kein Gegenstück.
const WP_CATEGORY_IDS: Record<number, string> = {
  17: "lakes", // seen -> Seen & Stege
  16: "roads", // panoramastrassen -> Panoramastraßen
  18: "gorges", // wasserfaelle -> Klammen & Wasserfälle
  19: "gorges", // klammen -> dieselbe Reihe
};

/** Wanderungen (13) teilen sich nach Schwierigkeit auf zwei Reihen auf. */
const HIKE_CATEGORY = 13;

// Die Winter-Reihen sagen selbst, was hineingehört: „Action & Bahnen" und „Aussicht &
// Erholung". Die 19 Gastein-Spots haben keine alte Kategorie, aber einen Typ-Marker, und
// der trifft die zwei Reihen ohne Auslegung: Bahnen und Karts sind Action, Aussichtspunkte
// und Thermen sind Aussicht und Erholung. Food läuft über den Typ, wie im Sommer.
const WINTER_FROM_MARKER: Record<string, string> = {
  ski: "action",
  action: "action",
  rodeln: "action",
  viewpoint: "view",
  aussichtspunkt: "view",
  therme: "view",
};

function categoryKeysFor(
  wpCategories: number[],
  type: "food" | "activity",
  difficulty: string | null,
  typeMarker: string | null,
  winter: boolean,
): string[] {
  const keys = new Set<string>();
  if (winter) {
    const k = WINTER_FROM_MARKER[(typeMarker ?? "").toLowerCase()];
    if (k) keys.add(k);
  }
  for (const id of wpCategories) {
    if (WP_CATEGORY_IDS[id]) keys.add(WP_CATEGORY_IDS[id]);
    if (id === HIKE_CATEGORY) keys.add(difficulty === "schwer" ? "hike-hard" : "hike-ez");
  }
  // Food braucht keine alte Kategorie: Der Typ sagt es schon, und die Reihe heisst im
  // Sommer „Food Spots" und im Winter „Skihütten & Cafés" — dieselbe Rolle, ein Schlüssel.
  if (type === "food") keys.add("food");
  return [...keys];
}

// ── Wird der Spot überhaupt gegangen? ───────────────────────────────────────

// Subtypen, die man fährt statt geht. Eine Wanderlinie wäre hier eine Lüge, und die
// DAV-Gehzeit rechnet aus 30 km Grossglockner-Hochalpenstrasse 16 Stunden Fussmarsch.
// Solche Spots bekommen nur einen Punkt auf der Karte, genau wie ein Café.
const NOT_WALKED_SUBTYPES = new Set(["Panoramastraße", "Schifffahrt", "Skigebiet", "Bergbahn"]);

// Einzelfälle, die kein Subtyp verrät. Die Hellbrunner Allee IST ein Weg, aber der Text
// beschreibt sie durchgehend als Fahrradtour („Die Fahrradtour … dauert 20 bis 30 Minuten").
// Eine Wander-Gehzeit von 63 Minuten daneben zu stellen, widerspricht dem eigenen Text.
const NOT_WALKED_SLUGS = new Set(["hellbrunner-allee", "wolfgangsee-schifffahrt"]);

/**
 * Ab welcher Länge ist eine Linie eine Route und kein Kringel?
 *
 * 500 Meter, und das ist ein ABSOLUTES Mass, kein Vergleich mit der alten Dauer. Genau
 * dieser Vergleich hat mich vorher zweimal in die Irre geführt: Beim Goldegger See und
 * bei der Innersbachklamm sah die Linie „zu kurz" aus, dabei war sie richtig und die alte
 * Zeitangabe falsch. Die Länge weiss man dagegen sicher.
 *
 * In den Daten liegt dort ein klarer Bruch. Darunter: Hangar-7 mit 80 Metern, Blick auf
 * Hohenwerfen mit 30, Mirabellgarten mit 230. Das sind Markierungen, die jemand um einen
 * Ort gezogen hat, keine Wege. Darüber beginnen die echten Runden.
 */
const MIN_ROUTE_KM = 0.5;

type RouteInfo = {
  slug: string;
  snappedKm: number | null;
  ascent: number | null;
  descent: number | null;
  minutes: number | null;
  shape: string | null;
  coords?: [number, number][];
  elevations?: number[];
};

function pointOnly(src: Source, subtype: string | null, route: RouteInfo | undefined): string | null {
  if (!route?.coords || route.coords.length < 2) return "keine brauchbare Linie";
  if (subtype && NOT_WALKED_SUBTYPES.has(subtype)) return `wird gefahren (${subtype})`;
  if (NOT_WALKED_SLUGS.has(src.slug)) return "wird gefahren/geradelt laut Text";
  if ((route.snappedKm ?? 0) < MIN_ROUTE_KM)
    return `Linie nur ${Math.round((route.snappedKm ?? 0) * 1000)} m — kein Weg, sondern eine Markierung`;
  return null;
}

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

async function importSpot(
  src: Source,
  draft: Draft,
  mediaMap: Record<string, MapEntry>,
  routes: Record<string, RouteInfo>,
  categories: { id: string; key: string; season: string }[],
  localId: string,
  dry: boolean,
) {
  const type = spotType(src);
  const notes: string[] = [];
  const subtype = subtypeOf(src, draft);

  const bestSeason = factValue(src, "season");
  const snapped = routes[src.slug];
  const reason = pointOnly(src, subtype, snapped);
  if (reason && snapped?.coords) notes.push(`nur Punkt statt Route: ${reason}`);

  // Die Linie kommt GESNAPPT aus wp:routes, nicht roh von der alten Seite: an echten
  // Wanderwegen ausgerichtet, und wo der Rückweg fehlte, um ihn ergänzt.
  const coords = !reason && snapped?.coords ? snapped.coords : [];
  const isRoute = coords.length >= 2;
  const el = !reason ? (snapped?.elevations ?? null) : null;
  const profile = isRoute && el ? elevationProfile(coords, el) : null;

  // Bei einer Route ist der Startpunkt der Haupt-/Anreisepunkt, genau wie in saveSpot.
  // Ohne Route bleibt der Spot-Punkt der alten Seite stehen.
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
    subtype,
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
    // Dauer: die GERECHNETE gewinnt, wo es eine gibt.
    //
    // Erst hatte ich es andersherum, weil die rohen Linien unvollständig waren und daraus
    // gerechnete Zeiten Unsinn ergaben („27 min" für den Gaisberg). Nach dem Snappen und
    // dem Ergänzen der Rückwege gilt das nicht mehr, und Anton sagt dazu das Entscheidende:
    // Die alten Werte sind grob überschlagen, keiner ist mit der Stoppuhr geprüft. 35 von
    // 60 sind ausserdem gar keine Gehzeit, sondern ein „plane insgesamt X ein" inklusive
    // Bergbahn, Pausen und Baden.
    //
    // Wo KEINE Route bleibt (Punkt-Spots), gibt es nichts zu rechnen: Dort steht die alte
    // Angabe weiter, bis die Route nachgezogen ist.
    //
    // WICHTIG für die Texte: Die Zahl im Feld und die Zahl im Fliesstext müssen dieselbe
    // sein. Ein Spot, der „2 Stunden" anzeigt und „gut drei Stunden" schreibt, ist schlimmer
    // als einer ohne Angabe.
    duration:
      isRoute && snapped?.minutes != null
        ? formatDuration(snapped.minutes)
        : factValue(src, "duration"),
    price_level: factPrice(factValue(src, "priceLevel") ?? ""),
    area: factCanonical("area", factValue(src, "area") ?? "") ?? factValue(src, "area"),
    fame: factCanonical("fame", factValue(src, "fame") ?? "") ?? null,
    local_id: localId,
    video_url: videoUrl.url,
    video_poster_url: posterUrl.url,
    // Öffnungszeiten brauchen eine Google-Place-ID, die die alte Seite nicht hat.
    // Bewusst aus, damit kein Spot mit leerem Öffnungszeiten-Block dasteht.
    // Öffnungszeiten NUR, wo die alte Seite wirklich eine Place-ID hinterlegt hat. Ohne
    // sie lehnt saveSpot das Flag ohnehin ab ("place_id_required"), und ein leerer
    // Öffnungszeiten-Block auf der Detailseite sähe nach kaputt aus.
    google_place_id: src.googlePlaceId,
    has_opening_hours: Boolean(src.googlePlaceId),
    phone: src.phone,
    ticket_url: src.ticketUrl,
    ticket_partner: src.ticketPartner,
    lake_name: src.lakeName,
  };

  if (dry) return { row, images, texts, notes };

  // Anlegen ODER aktualisieren. Ein Import, der beim zweiten Lauf am eindeutigen Slug
  // scheitert, ist bei 95 Spots unbrauchbar: Man bessert einen Text nach und müsste den
  // Spot vorher von Hand löschen — mitsamt seinen Medien-Zeilen. Der Slug ist der
  // Schlüssel, der Spot gehört also sich selbst, egal wie oft der Import läuft.
  const { data: existing } = await db.from("spots").select("id").eq("slug", row.slug).maybeSingle();
  let spotId: string;
  if (existing) {
    const { error } = await db.from("spots").update(row).eq("id", existing.id);
    if (error) throw new Error(`spots aktualisieren: ${error.message}`);
    spotId = existing.id as string;
    // Medien neu setzen statt anhängen, sonst sammelt jeder Lauf dieselben Fotos erneut ein.
    // Die DATEIEN bleiben liegen, sie werden gleich wieder eingetragen (media-map ist stabil).
    await db.from("media").delete().eq("spot_id", spotId);
  } else {
    const { data: spot, error } = await db.from("spots").insert(row).select("id").single();
    if (error) throw new Error(`spots: ${error.message}`);
    spotId = spot.id as string;
  }

  // source_hash steht auf spot_translations (Migration 0031), NICHT auf spots. Er hält
  // fest, aus welchem deutschen Text eine Übersetzung entstand; weicht er ab, meldet der
  // Admin „veraltet". Beim deutschen Datensatz ist er der Hash seiner selbst. Fehlt er,
  // gilt die spätere Übersetzung sofort als veraltet, obwohl sie frisch ist.
  const { error: tErr } = await db.from("spot_translations").upsert({
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
  }, { onConflict: "spot_id,lang" });
  if (tErr) throw new Error(`spot_translations: ${tErr.message}`);

  // Kategorien neu setzen (delete + insert), damit ein zweiter Lauf nicht doppelt einträgt.
  const catKeys = categoryKeysFor(src.wpCategories ?? [], type, row.difficulty, src.typeMarker, row.seasons.includes("winter"));
  await db.from("spot_categories").delete().eq("spot_id", spotId);
  if (catKeys.length) {
    const season = row.seasons[0];
    const ids = categories
      .filter((c) => catKeys.includes(c.key as string) && row.seasons.includes(c.season as string))
      .map((c) => c.id as string);
    if (ids.length) {
      const { error: cErr } = await db
        .from("spot_categories")
        .insert(ids.map((category_id) => ({ spot_id: spotId, category_id })));
      if (cErr) throw new Error(`spot_categories: ${cErr.message}`);
    }
    const missing = catKeys.filter(
      (k) => !categories.some((c) => c.key === k && row.seasons.includes(c.season as string)),
    );
    for (const m of missing) notes.push(`Kategorie „${m}" gibt es für ${season} nicht`);
  } else {
    notes.push("keine Kategorie zuordenbar");
  }

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

// „5 h 47" wäre für eine Wanderung falsche Genauigkeit: Die DAV-Formel ist eine Schätzung,
// keine Messung. Auf fünf Minuten gerundet, und ab einer Stunde in Stunden.
function formatDuration(min: number): string {
  const r = Math.round(min / 5) * 5;
  if (r < 60) return `${r} min`;
  const h = Math.floor(r / 60);
  const m = r % 60;
  return m ? `${h} Std ${m} min` : `${h} Std`;
}

// ── Lauf ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dry = !args.includes("--go");
  const onlyArg = args.indexOf("--only");
  const only = onlyArg >= 0 ? new Set(args[onlyArg + 1].split(",")) : null;

  if (!existsSync(MAP_FILE)) throw new Error(`${MAP_FILE} fehlt — bitte zuerst "npm run wp:media"`);
  const mediaMap = JSON.parse(readFileSync(MAP_FILE, "utf8")) as Record<string, MapEntry>;

  const routesFile = join(CACHE_DIR, "routes.json");
  if (!existsSync(routesFile)) throw new Error(`${routesFile} fehlt — bitte zuerst "npm run wp:routes"`);
  const routes = Object.fromEntries(
    (JSON.parse(readFileSync(routesFile, "utf8")) as RouteInfo[]).map((r) => [r.slug, r]),
  );

  const { data: categoryRows } = await db.from("categories").select("id, key, season");
  const categories = (categoryRows ?? []) as { id: string; key: string; season: string }[];
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
      const r = await importSpot(src, draft, mediaMap, routes, categories, localId, dry);
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
