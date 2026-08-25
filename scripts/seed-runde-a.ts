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
import { synthesizeVoice } from "../src/lib/tts.ts";
import { cleanRouteGeo } from "../src/lib/tour-route.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPBOX = process.env.MAPBOX_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Zugang fehlt in .env.local");
if (!MAPBOX) throw new Error("MAPBOX_SERVER_TOKEN fehlt in .env.local");
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

// Vertonen kostet Geld und legt bei jedem Lauf eine neue Datei an. Deshalb nur, wenn noch
// keine da ist. Neu vertonen mit FORCE_TTS=1, dann bleibt die alte Datei als Waise liegen
// und gehoert von Hand aus dem Bucket geraeumt.
const NEU_VERTONEN = process.env.FORCE_TTS === "1";

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
// Rund 130 Woerter je Minute, ruhig gesprochen. Nur fuer die Anzeige, nicht fuer die Steuerung.
const sekunden = (t: string) => Math.round((t.split(/\s+/).length / 130) * 60);

// ── 1. Gebiet ────────────────────────────────────────────────────────────────
const { data: areaRow, error: areaErr } = await db
  .from("tour_areas")
  .upsert(
    {
      key: AREA_KEY,
      status: "draft",
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
  const felder = {
    area_id: areaId,
    lat: s.lat,
    lng: s.lng,
    kind: s.kind,
    emoji: s.emoji,
    status: "draft" as const,
    sort_order: i,
    weight: SPOTS.length - i,
  };
  let id = idNachTitel.get(s.titel);
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

  // Was schon vertont ist, bleibt vertont (siehe NEU_VERTONEN oben).
  const vorher = (
    await db
      .from("tour_point_audio")
      .select("audio_url, teaser_url")
      .eq("point_id", id)
      .eq("lang", "de")
      .maybeSingle()
  ).data as { audio_url: string | null; teaser_url: string | null } | null;

  const vertonen = async (was: string, txt: string, kind: "voll" | "kostprobe", alt: string | null) => {
    if (alt && !NEU_VERTONEN) return alt;
    const r = await synthesizeVoice({ text: txt, lang: "de", kind });
    if (!r.ok) throw new Error(`Vertonung (${was}) fehlgeschlagen: ${r.error}`);
    // Die ersetzte Datei gleich wegräumen. Sonst sammelt jeder FORCE_TTS-Lauf Waisen im
    // Bucket an, die niemand mehr zuordnen kann, weil der Name nur eine UUID ist.
    if (alt) {
      const { error } = await db.storage.from("tour-audio").remove([alt]);
      log(`     ${was}: ${r.path} (${Math.round(r.bytes / 1024)} kB), alt ${error ? "NICHT" : ""} gelöscht: ${alt}`);
    } else {
      log(`     ${was}: ${r.path} (${Math.round(r.bytes / 1024)} kB)`);
    }
    return r.path;
  };

  const audioUrl = await vertonen("Geschichte", text, "voll", vorher?.audio_url ?? null);
  const teaserUrl = await vertonen("Kostprobe", probe, "kostprobe", vorher?.teaser_url ?? null);

  await db.from("tour_point_audio").upsert(
    {
      point_id: id,
      lang: "de",
      audio_text: text,
      duration_sec: sekunden(text),
      audio_url: audioUrl,
      teaser_text: probe,
      teaser_url: teaserUrl,
      teaser_sec: sekunden(probe),
    },
    { onConflict: "point_id,lang" },
  );
  pointIds.push(id);
  log(`  ${i + 1}. ${s.titel}  ${id}`);
}

// ── 3. Route über Mapbox, Radprofil ──────────────────────────────────────────
// Dieselbe Kette wie die Navigation: Start, alle Spots als stille Wegpunkte, Ziel.
// Die Vorschau-Linie auf der Tour-Seite und die gefahrene Linie sollen dieselbe sein.
const kette = [HANUSCHPLATZ, ...SPOTS.map((s) => ({ lat: s.lat, lng: s.lng })), HANUSCHPLATZ];
const coordStr = kette.map((c) => `${c.lng},${c.lat}`).join(";");
const res = await fetch(
  `https://api.mapbox.com/directions/v5/mapbox/cycling/${coordStr}` +
    `?geometries=geojson&overview=full&continue_straight=false&access_token=${MAPBOX}`,
);
if (!res.ok) throw new Error(`Mapbox antwortet ${res.status}`);
const j = await res.json();
const route = Array.isArray(j.routes) ? j.routes[0] : null;
const routeGeo = cleanRouteGeo(route?.geometry?.coordinates);
if (!routeGeo) throw new Error("Mapbox hat keine Radroute geliefert");
const distanceKm = Math.round((route.distance as number) / 100) / 10;
const durationMin = Math.round((route.duration as number) / 60) + SPOTS.length; // 1 Min je Spot
log(`Route: ${routeGeo.length} Punkte, ${distanceKm} km, ${durationMin} min inkl. Hören`);

// ── 4. Die Runde ─────────────────────────────────────────────────────────────
const tourRow = {
  area_id: areaId,
  slug: TOUR_SLUG,
  region: "stadt-salzburg",
  emoji: "🚲",
  is_pro: true,
  free_stops: 2, // Gratis-Einstieg (docs/40): die ersten beiden Geschichten ohne Pro
  status: "draft" as const,
  mode: "bike" as const,
  duration_min: durationMin,
  distance_km: distanceKm,
  start_lat: HANUSCHPLATZ.lat,
  start_lng: HANUSCHPLATZ.lng,
  end_lat: HANUSCHPLATZ.lat,
  end_lng: HANUSCHPLATZ.lng,
  route_geo: routeGeo,
  route_hash: tourRouteHash({ start: HANUSCHPLATZ, end: HANUSCHPLATZ, pointIds }),
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

log(`\nFertig. Alles ist ENTWURF, öffentlich sichtbar ist nichts.`);
log(`Ansehen: /admin/tours/${tourId}`);
