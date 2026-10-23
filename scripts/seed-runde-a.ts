// EINMALIGES ANLEGEN der ersten Rad-Audiorunde (docs/40): Gebiet, sieben Punkte, die Runde
// selbst und ihre Reihenfolge. Alles als ENTWURF, damit nichts öffentlich wird, bevor
// jemand drübergeschaut und die Runde einmal abgefahren ist.
//
// Aufruf: npm run seed:runde-a
//
// Idempotent: Gebiet über `key`, Runde über `slug`, Punkte über ihren deutschen Titel.
// Ein zweiter Lauf legt nichts doppelt an, er aktualisiert.
//
// WARUM EIN SKRIPT UND NICHT DAS ADMIN-FORMULAR: Sieben Punkte mit je Koordinate, Titel
// und Audiotext von Hand einzutippen ist die Sorte Arbeit, bei der genau ein Zahlendreher
// passiert und niemand ihn findet. Die Koordinaten stammen aus der Vermessung vom
// 25.08.2026, die Texte aus dem Faktencheck vom selben Tag.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { tourRouteHash } from "../src/lib/tour-route.ts";
import { ensureVoiceFile } from "../src/lib/tts-files.ts";
import { getDefaultVoice } from "../src/lib/tts-voices.ts";
import { cleanRouteGeo } from "../src/lib/tour-route.ts";
import { runChain } from "../src/lib/routing/run.ts";
import { tourDurationMin } from "../src/lib/routing/chain.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Zugang fehlt in .env.local");
if (!process.env.ROUTING_URL) throw new Error("ROUTING_URL fehlt in .env.local (Routendienst, docs/42)");
const db = createClient(SUPA_URL, SUPA_KEY);

const AREA_KEY = "salzburg-stadt-rad";
const TOUR_SLUG = "die-stadt-von-aussen";
// S-Bike-Station Hanuschplatz, Franz-Josef-Kai 1A. Start UND Ziel: Rundtour.
const HANUSCHPLATZ = { lat: 47.80132, lng: 13.0416 };

type Spot = { titel: string; lat: number; lng: number; emoji: string; kind: string };

// Die AUDIOTEXTE stehen bewusst NICHT hier. Das Repository ist öffentlich, und der
// gesprochene Text ist der bezahlte Teil des Produkts: Ab dem dritten Spot ist er
// Pro-Inhalt (free_stops unten). Titel und Koordinaten dürfen offen liegen, die sind
// laut Migration 0026 der Teaser. Der Text nicht.
//
// Er wird deshalb aus einer lokalen, in .gitignore stehenden Datei gelesen:
//   .audio-texte/runde-a-de.json   { "Titel des Spots": "gesprochener Text", ... }
const TEXT_DATEI = ".audio-texte/runde-a-de.json";
const KOSTPROBE_DATEI = ".audio-texte/runde-a-de-kostprobe.json";
const texte: Record<string, string> = JSON.parse(readFileSync(TEXT_DATEI, "utf8"));
const kostproben: Record<string, string> = JSON.parse(readFileSync(KOSTPROBE_DATEI, "utf8"));

// Vertonen kostet Geld. Der Kern (lib/tts-files.ts) vertont deshalb nur, was fehlt oder
// veraltet ist (Text geaendert, Datei im Bucket weg). FORCE_TTS=1 erzwingt neue Takes; die
// ersetzten Dateien raeumt der woechentliche Waisen-Sweep. Seit 09/2026 geht dasselbe auch
// im Admin an der Runde ("Stimme pruefen" / "Vertonen"), fuer alle Sprachen und Stimmen.
const NEU_VERTONEN = process.env.FORCE_TTS === "1";

// Die Stimme der Runde (Migration 0068): der Standard aus tts_voices, also Toni.
const STIMME = await getDefaultVoice();
if (!STIMME) throw new Error("Keine Stimme in tts_voices (Migration 0068 einspielen)");

const SPOTS: Spot[] = [
  {
    titel: "Marko-Feingold-Steg",
    lat: 47.80132, lng: 13.0416, emoji: "🌉", kind: "Geschichte",
  },
  {
    titel: "Festung und Dom von unten",
    lat: 47.7979, lng: 13.0527, emoji: "🏰", kind: "Aussicht",
  },
  {
    titel: "Stift Nonnberg von unten",
    lat: 47.79364, lng: 13.0518, emoji: "⛪", kind: "Geschichte",
  },
  {
    titel: "Schloss Freisaal im Weiher",
    lat: 47.78698, lng: 13.05737, emoji: "🏯", kind: "Geschichte",
  },
  {
    titel: "Giselakai, die Altstadt von gegenüber",
    lat: 47.7989, lng: 13.0536, emoji: "🌆", kind: "Aussicht",
  },
  {
    titel: "Mirabellplatz und Mirabellgarten",
    lat: 47.80577, lng: 13.04284, emoji: "🌷", kind: "Geschichte",
  },
  {
    titel: "Mülln, Müllner Kirche und Augustiner",
    lat: 47.80545, lng: 13.0347, emoji: "🍺", kind: "Essen & Trinken",
  },
];

const log = (s: string) => console.log(s);

// Ein bestehender Status wird NIE ueberschrieben. Nur eine neue Zeile faengt als Entwurf an.
//
// WARUM DAS EINE EIGENE FUNKTION IST: Das Skript ist idempotent gedacht, und genau deshalb
// laeuft es auch, wenn die Runde laengst veroeffentlicht ist, etwa um neu zu vertonen. Bis
// 25.08.2026 schrieb es dabei `status: "draft"` mit und nahm die Runde stillschweigend vom
// Netz. Aufgefallen ist es nur, weil die Schlusszeile "Alles ist ENTWURF" behauptete,
// waehrend die Runde vorher live war.
async function statusBehalten(
  tabelle: "tours" | "tour_areas" | "tour_points",
  spalte: "slug" | "key" | "id",
  wert: string,
): Promise<"draft" | "published"> {
  const r = await db.from(tabelle).select("status").eq(spalte, wert).maybeSingle();
  return ((r.data as { status?: string } | null)?.status as "draft" | "published") ?? "draft";
}
// Rund 130 Woerter je Minute, ruhig gesprochen. Nur fuer die Anzeige, nicht fuer die Steuerung.
const sekunden = (t: string) => Math.round((t.split(/\s+/).length / 130) * 60);

// ── 1. Gebiet ────────────────────────────────────────────────────────────────
const { data: areaRow, error: areaErr } = await db
  .from("tour_areas")
  .upsert(
    {
      key: AREA_KEY,
      status: await statusBehalten("tour_areas", "key", AREA_KEY),
      start_lat: HANUSCHPLATZ.lat,
      start_lng: HANUSCHPLATZ.lng,
      emoji: "🚲",
      sort_order: 0,
    },
    { onConflict: "key" },
  )
  .select("id")
  .single();
if (areaErr) throw areaErr;
const areaId = (areaRow as { id: string }).id;
await db
  .from("tour_area_translations")
  .upsert(
    { area_id: areaId, lang: "de", name: "Salzburg mit dem Rad", subtitle: "Audio-Runden ab dem Hanuschplatz" },
    { onConflict: "area_id,lang" },
  );
log(`Gebiet "${AREA_KEY}": ${areaId}`);

// ── 2. Punkte ────────────────────────────────────────────────────────────────
// Vorhandene Punkte des Gebiets über ihren deutschen Titel wiederfinden, damit ein
// zweiter Lauf aktualisiert statt zu verdoppeln.
const { data: vorhanden } = await db
  .from("tour_points")
  .select("id, tour_point_translations(lang, title)")
  .eq("area_id", areaId);
const idNachTitel = new Map<string, string>();
for (const p of (vorhanden ?? []) as { id: string; tour_point_translations: { lang: string; title: string }[] }[]) {
  const de = p.tour_point_translations?.find((t) => t.lang === "de");
  if (de) idNachTitel.set(de.title, p.id);
}

const pointIds: string[] = [];
for (const [i, s] of SPOTS.entries()) {
  let id = idNachTitel.get(s.titel);
  const felder = {
    area_id: areaId,
    lat: s.lat,
    lng: s.lng,
    kind: s.kind,
    emoji: s.emoji,
    // Nur ein NEUER Punkt faengt als Entwurf an, ein bestehender behaelt seinen Status.
    status: id ? await statusBehalten("tour_points", "id", id) : ("draft" as const),
    sort_order: i,
    weight: SPOTS.length - i,
  };
  if (id) {
    const { error } = await db.from("tour_points").update(felder).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await db.from("tour_points").insert(felder).select("id").single();
    if (error) throw error;
    id = (data as { id: string }).id;
  }
  await db
    .from("tour_point_translations")
    .upsert({ point_id: id, lang: "de", title: s.titel }, { onConflict: "point_id,lang" });
  const text = texte[s.titel];
  if (!text) throw new Error(`Kein Audiotext für "${s.titel}" in ${TEXT_DATEI}`);
  const probe = kostproben[s.titel];
  if (!probe) throw new Error(`Keine Kostprobe für "${s.titel}" in ${KOSTPROBE_DATEI}`);

  // Erst der Text (die Datei-Zeile haengt per FK an ihm), dann die Dateien je Stimme.
  await db.from("tour_point_audio").upsert(
    {
      point_id: id,
      lang: "de",
      audio_text: text,
      duration_sec: sekunden(text),
      teaser_text: probe,
      teaser_sec: sekunden(probe),
    },
    { onConflict: "point_id,lang" },
  );
  const vertonen = async (was: string, txt: string, kind: "voll" | "kostprobe") => {
    const r = await ensureVoiceFile({ pointId: id!, lang: "de", kind, voice: STIMME, text: txt, force: NEU_VERTONEN, db });
    if (!r.ok) throw new Error(`Vertonung (${was}) fehlgeschlagen: ${r.error}`);
    log(`     ${was}: ${r.skipped ? "schon aktuell" : `neu vertont (${r.chars} Zeichen)`} ${r.path}`);
    if (r.spokenFailed) log(`     ${was}: OHNE Sprechfassung vertont (${r.spokenFailed}), Zahlen koennen komisch klingen`);
  };
  await vertonen("Geschichte", text, "voll");
  await vertonen("Kostprobe", probe, "kostprobe");
  pointIds.push(id);
  log(`  ${i + 1}. ${s.titel}  ${id}`);
}

// ── 3. Route über unseren Routendienst (BRouter, Radprofil), docs/42 ─────────────────
// Dieselbe Kette wie Editor, Offline-Paket und Navigation: Start, alle Spots als stille
// Wegpunkte, Ziel. Die Vorschau-Linie auf der Tour-Seite und die gefahrene Linie sind damit
// dieselbe. Bis 23.10.2026 kam die Linie von Mapbox Directions; deren Ergebnisse dürfen
// nicht gespeichert werden (docs/42, Abschnitt 0).
const kette: [number, number][] = [HANUSCHPLATZ, ...SPOTS, HANUSCHPLATZ].map((c) => [c.lng, c.lat]);
const geroutet = await runChain({ points: kette, mode: "bike", purpose: "editor" });
if (!geroutet.ok) throw new Error(`Routendienst: ${geroutet.code}${geroutet.message ? ` (${geroutet.message})` : ""}`);
if (geroutet.route.source.provider === "local") throw new Error("Testadapter aktiv (ROUTING_URL fehlt): keine erfundene Linie speichern");
const routeGeo = cleanRouteGeo(geroutet.route.geometry);
if (!routeGeo) throw new Error("Der Routendienst hat keine Radroute geliefert");
const distanceKm = Math.round(geroutet.route.distanceM / 100) / 10;
// Dieselbe Formel wie der Editor: 12 km/h plus 1 Minute je Spot (docs/42, Abschnitt 4).
const durationMin = tourDurationMin(geroutet.route.distanceM, "bike", SPOTS.length);
for (const w of geroutet.route.warnings) log(`  Hinweis: ${w}`);
log(`Route: ${routeGeo.length} Punkte, ${distanceKm} km, ${durationMin} min inkl. Hören`);

// ── 4. Die Runde ─────────────────────────────────────────────────────────────
const tourRow = {
  area_id: areaId,
  slug: TOUR_SLUG,
  region: "stadt-salzburg",
  emoji: "🚲",
  is_pro: true,
  free_stops: 2, // Gratis-Einstieg (docs/40): die ersten beiden Geschichten ohne Pro
  status: await statusBehalten("tours", "slug", TOUR_SLUG),
  mode: "bike" as const,
  voice_id: STIMME.id,
  duration_min: durationMin,
  distance_km: distanceKm,
  start_lat: HANUSCHPLATZ.lat,
  start_lng: HANUSCHPLATZ.lng,
  end_lat: HANUSCHPLATZ.lat,
  end_lng: HANUSCHPLATZ.lng,
  route_geo: routeGeo,
  // Dieselbe Marke wie das Formular: Fortbewegung, Start, Stationen mit Koordinaten,
  // Wegpunkte (hier keine), Ziel. Sonst stuende die Runde im Editor als "veraltet".
  route_hash: tourRouteHash({
    start: HANUSCHPLATZ,
    end: HANUSCHPLATZ,
    stops: SPOTS.map((s, i) => ({ id: pointIds[i], coord: [s.lng, s.lat] as [number, number] })),
    mode: "bike",
    via: [],
  }),
};
const { data: tourRowOut, error: tourErr } = await db
  .from("tours")
  .upsert(tourRow, { onConflict: "slug" })
  .select("id")
  .single();
if (tourErr) throw tourErr;
const tourId = (tourRowOut as { id: string }).id;
await db.from("tour_translations").upsert(
  {
    tour_id: tourId,
    lang: "de",
    title: "Die Stadt von außen",
    subtitle: "9 km, sieben Geschichten, keine Fußgängerzone",
    description:
      "Eine Runde ab dem Hanuschplatz, die Festung, Dom, Nonnberg, Mirabell und den Augustiner liefert und dabei um jede Fußgängerzone herumfährt. Flach, knapp 50 Minuten, und du hörst im Fahren.",
  },
  { onConflict: "tour_id,lang" },
);
log(`Runde "${TOUR_SLUG}": ${tourId}`);

// ── 5. Reihenfolge ───────────────────────────────────────────────────────────
await db.from("tour_stops").delete().eq("tour_id", tourId);
const { error: stopsErr } = await db
  .from("tour_stops")
  .insert(pointIds.map((point_id, i) => ({ tour_id: tourId, point_id, sort_order: i })));
if (stopsErr) throw stopsErr;
log(`${pointIds.length} Stationen verknüpft`);

const endStatus = await statusBehalten("tours", "slug", TOUR_SLUG);
log(`\nFertig. Status unverändert: ${endStatus === "published" ? "VERÖFFENTLICHT, öffentlich sichtbar" : "ENTWURF, öffentlich nicht sichtbar"}.`);
log(`Ansehen: /admin/tours/${tourId}`);
