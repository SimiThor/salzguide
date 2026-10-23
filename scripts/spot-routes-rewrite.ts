// Gespeicherte Spot-Wanderlinien (openrouteservice) und eigene Runden (Mapbox Optimization)
// durch Linien aus unserem Routendienst ersetzen (docs/42, Abschnitt 16). NUR nach Antons
// Freigabe des Vergleichs (scripts/spot-routes-compare.ts) und NUR mit --write.
//
//   npm run spot-routes:rewrite                       Trockenlauf: zeigt, was geschrieben würde
//   npm run spot-routes:rewrite -- --write            schreibt spots.route_geojson + elevation_profile
//   npm run spot-routes:rewrite -- --write --fix-waypoints
//                                                     schreibt zusätzlich route_waypoints (die aus
//                                                     der Linie abgeleiteten Kontrollpunkte), damit
//                                                     "Anpassen" im Admin die Route nicht zum Stummel macht
//   npm run spot-routes:rewrite -- --write --user-tours
//                                                     schreibt user_tours.route_geo, distance_km, duration_min
//   --only=<slug>        nur dieser Spot
//   --force              auch Spots, deren neue Linie weit von der alten abweicht
//   --brouter=local      gegen 127.0.0.1:17777 statt ROUTING_URL aus .env.local
//
// NIE angefasst: spots.duration, difficulty (vom Admin gesetzt, Regel aus docs/42 Abschnitt 4)
// und route_waypoints ohne --fix-waypoints. Übersprungen wird, was mehr als SKIP_HAUSDORFF_M
// von der alten Linie abweicht oder mehr als SKIP_LEN_PCT länger/kürzer ist (ohne --force).
//
// FOLGEN, die Anton kennen muss:
//   - Jede neue Spot-Linie ändert introSourceHash (lib/intro-hash.ts): das Intro-Video des
//     Spots gilt als veraltet und wird neu gerendert.
//   - Der Katalog-Cache (SPOTS_TAG) wird von diesem Skript NICHT geleert: danach einen Spot im
//     Admin speichern oder neu deployen.
import { createClient } from "@supabase/supabase-js";
import { routeLengthKm } from "../src/lib/geo.ts";
import { snapSpotRouteCore } from "../src/lib/routing/snap-spot.ts";
import { routeUserLoop } from "../src/lib/routing/user-loop.ts";
import type { LngLat } from "../src/lib/routing/types.ts";
import { compareLines } from "./lib/line-compare.ts";
import { deriveWaypoints, lineOf } from "./lib/spot-routes.ts";

const arg = (n: string, d: string | null = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const WRITE = process.argv.includes("--write");
const FIX_WP = process.argv.includes("--fix-waypoints");
const USER_TOURS = process.argv.includes("--user-tours");
const FORCE = process.argv.includes("--force");
const ONLY = arg("only");
if (arg("brouter") === "local") {
  process.env.ROUTING_URL = process.env.ROUTING_URL_LOCAL ?? "http://127.0.0.1:17777";
  delete process.env.ROUTING_TOKEN;
}
if (!process.env.ROUTING_URL) throw new Error("ROUTING_URL fehlt (.env.local oder --brouter=local)");

const SKIP_HAUSDORFF_M = 250;
const SKIP_LEN_PCT = 0.15;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const f2 = (x: number) => x.toFixed(2);
let written = 0;
let skipped = 0;
let failed = 0;

async function spots() {
  let q = sb.from("spots").select("id, slug, status, route_geojson, route_waypoints, elevation_profile").not("route_geojson", "is", null).order("slug");
  if (ONLY) q = q.eq("slug", ONLY);
  const { data, error } = await q;
  if (error) throw new Error(`Supabase: ${error.message}`);
  console.log(`Spots mit Linie: ${data?.length ?? 0}\n`);
  for (const s of (data ?? []) as Record<string, unknown>[]) {
    const slug = s.slug as string;
    const old = lineOf(s.route_geojson);
    if (!old) {
      console.log(`  ${slug.padEnd(28)} keine LineString-Linie, übersprungen`);
      skipped++;
      continue;
    }
    const { points, shape } = deriveWaypoints(old);
    const r = await snapSpotRouteCore(points);
    if (!r.ok || !r.coords) {
      console.log(`  ${slug.padEnd(28)} FEHLER ${r.error}`);
      failed++;
      continue;
    }
    const oldKm = routeLengthKm(old);
    const newKm = r.distanceKm ?? routeLengthKm(r.coords);
    const cmp = compareLines(r.coords, old);
    const lenOff = oldKm > 0 ? Math.abs(newKm - oldKm) / oldKm : 0;
    const far = cmp.hausdorffM > SKIP_HAUSDORFF_M || lenOff > SKIP_LEN_PCT;
    const line = `  ${slug.padEnd(28)} ${shape.padEnd(10)} ${f2(oldKm)} -> ${f2(newKm)} km, Hausdorff ${Math.round(cmp.hausdorffM)} m, ↑${(s.elevation_profile as { ascent?: number } | null)?.ascent ?? "?"} -> ↑${r.profile?.ascent ?? "?"}${r.warnings?.length ? `, ${r.warnings.length} Hinweis(e)` : ""}`;
    if (far && !FORCE) {
      console.log(`${line}  ÜBERSPRUNGEN (weicht ab; --force)`);
      skipped++;
      continue;
    }
    if (!WRITE) {
      console.log(`${line}  würde schreiben${FIX_WP ? ` (+ ${points.length} Kontrollpunkte)` : ""}`);
      continue;
    }
    const patch: Record<string, unknown> = {
      route_geojson: { type: "LineString", coordinates: r.coords },
      elevation_profile: r.profile ?? null,
      ...(FIX_WP ? { route_waypoints: points } : {}),
    };
    const { error: upErr } = await sb.from("spots").update(patch).eq("id", s.id as string);
    if (upErr) {
      console.log(`${line}  SCHREIBFEHLER ${upErr.message}`);
      failed++;
    } else {
      console.log(`${line}  geschrieben`);
      written++;
    }
  }
}

async function userTours() {
  const { data, error } = await sb.from("user_tours").select("id, point_ids, route_geo, start_lat, start_lng, distance_km, duration_min").order("created_at", { ascending: true });
  if (error) throw new Error(`Supabase: ${error.message}`);
  const tours = (data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(tours.flatMap((t) => (t.point_ids as string[] | null) ?? []))];
  const { data: pts } = ids.length ? await sb.from("tour_points").select("id, lat, lng").in("id", ids) : { data: [] };
  const byId = new Map(((pts ?? []) as { id: string; lat: number | null; lng: number | null }[]).map((p) => [p.id, p]));
  console.log(`\nEigene Runden: ${tours.length}\n`);
  let n = 0;
  for (const t of tours) {
    const label = `Eigene Runde ${++n}`;
    const start: LngLat | null = typeof t.start_lng === "number" && typeof t.start_lat === "number" ? [t.start_lng, t.start_lat] : null;
    const stops = ((t.point_ids as string[] | null) ?? []).map((id) => byId.get(id)).filter((p): p is { id: string; lat: number; lng: number } => !!p && p.lat != null && p.lng != null);
    if (!start || stops.length < 2) {
      console.log(`  ${label.padEnd(28)} kein Start oder zu wenige Stopps, übersprungen`);
      skipped++;
      continue;
    }
    const r = await routeUserLoop(start, stops.map((p) => [p.lng, p.lat] as LngLat));
    if (!r.ok) {
      console.log(`  ${label.padEnd(28)} FEHLER ${r.code}`);
      failed++;
      continue;
    }
    const oldKm = Number(t.distance_km) || 0;
    const line = `  ${label.padEnd(28)} ${stops.length} Stopps, ${f2(oldKm)} -> ${f2(r.route.distanceM / 1000)} km, ${t.duration_min ?? "?"} -> ${r.route.durationMin} min`;
    if (!WRITE) {
      console.log(`${line}  würde schreiben`);
      continue;
    }
    const { error: upErr } = await sb
      .from("user_tours")
      .update({ route_geo: r.route.geo, distance_km: Math.round(r.route.distanceM / 100) / 10, duration_min: r.route.durationMin })
      .eq("id", t.id as string);
    if (upErr) {
      console.log(`${line}  SCHREIBFEHLER ${upErr.message}`);
      failed++;
    } else {
      console.log(`${line}  geschrieben`);
      written++;
    }
  }
}

async function main() {
  console.log(`${WRITE ? "SCHREIBEN" : "Trockenlauf"} · Routendienst ${process.env.ROUTING_URL}${FIX_WP ? " · route_waypoints werden ersetzt" : ""}\n`);
  await spots();
  if (USER_TOURS && !ONLY) await userTours();
  console.log(`\n${WRITE ? `geschrieben ${written}` : "nichts geschrieben (Trockenlauf)"} · übersprungen ${skipped} · Fehler ${failed}`);
  if (WRITE && written) console.log("Danach: Katalog-Cache leeren (einen Spot im Admin speichern oder neu deployen); Intro-Videos der geänderten Spots gelten als veraltet.");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
