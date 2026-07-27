// Legt bei Wanderungen, die man auf demselben Weg zurückgeht, den Rückweg nach. Aufruf:
//   npm run wp:there-and-back
//   npm run wp:there-and-back -- --go
//
// WAS SCHIEFGING: `wp:routes` entscheidet über den Rückweg, indem es beide Lesarten gegen
// die alte Dauer-Angabe hält und die nähere nimmt. Beim Gamskarkogel stand dort „8 h
// gesamt". Der reine Aufstieg rechnet sich zu 7:55, hin und zurück zu 13:45 — also gewann
// der Aufstieg, und auf der Karte lag danach eine Linie, die am Gipfel aufhört. Das Wort
// „gesamt" hätte das Gegenteil sagen müssen, aber ein Zahlenvergleich liest keine Wörter.
//
// Deshalb steht die Entscheidung jetzt hier als Liste, je Zeile mit dem Grund. Verdoppelt
// wird nur, wo es keinen Lift gibt und das Ziel ein Stichweg ist: rauf, schauen, denselben
// Weg zurück.
//
// WO NICHT VERDOPPELT WIRD, UND WARUM: Schmittenhöhe, Almenwelt Lofer, Spinnerin und
// Prinzensee haben eine Bahn, und die eigenen Texte sagen es auch („Runter geht es mit der
// Seilbahn"). Kapuzinerberg, Bad Gastein und die Halleiner Altstadt sind Überschreitungen,
// die woanders herauskommen als sie anfangen. Der Wiestalstausee ist eine Uferstrasse, kein
// Wanderziel. Verdoppeln hiesse dort, eine Tour zu erfinden, die niemand geht.
//
// Der Rückweg braucht keine neue ORS-Anfrage: Er ist der Hinweg rückwärts, und genau so
// macht es der Knopf „↔ Hin & zurück" im Admin-Formular auch.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { hikingTimeMinutes, routeLengthKm } from "../../src/lib/geo.ts";
import {
  doubled,
  elevationProfile,
  formatDuration,
  thereAndBack,
  waypointsFor,
} from "./route-math.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

const ROUTES_FILE = join(".wp-cache", "routes.json");

/** Wanderungen, bei denen der Rückweg der Hinweg ist. */
const DOUBLE: { slug: string; warum: string }[] = [
  { slug: "gamskarkogel", warum: "Gipfel ohne Bahn; Abstieg nach Hüttschlag ist die Alternative, nicht der Normalfall" },
  { slug: "lackenkogel", warum: "Gipfel ohne Bahn, der Text sagt selbst „den Abstieg nimmst du denselben Weg\"" },
  { slug: "tappenkarsee", warum: "Bergsee am Talschluss, zurück geht es denselben Weg" },
  { slug: "oberhutte", warum: "Hütte am See, kein Übergang weiter, kein Lift" },
  { slug: "nockstein", warum: "Felsgipfel über Koppl, Stichweg vom Parkplatz" },
  { slug: "gollinger-wasserfall", warum: "Stichweg zum Wasserfall und wieder herunter" },
];

type RouteRow = {
  slug: string;
  coords?: [number, number][];
  elevations?: number[];
  shape?: string;
  snappedKm?: number;
  ascent?: number;
  descent?: number;
  minutes?: number;
};

async function main() {
  const go = process.argv.includes("--go");
  const routes: RouteRow[] = JSON.parse(readFileSync(ROUTES_FILE, "utf8"));
  let touched = false;
  const byslug = new Map(routes.map((r) => [r.slug, r]));

  const { data: spots } = await db
    .from("spots")
    .select("id, slug, duration, route_geojson, elevation_profile");
  if (!spots) throw new Error("Lesen fehlgeschlagen");

  for (const { slug, warum } of DOUBLE) {
    const spot = spots.find((s) => s.slug === slug);
    if (!spot) throw new Error(`Spot ${slug} gibt es nicht`);
    const r = byslug.get(slug);
    if (!r?.coords || !r.elevations) throw new Error(`${slug}: keine gesnappte Linie im Cache`);

    // Cache und Datenbank können getrennt schon verdoppelt sein, wenn ein Lauf dazwischen
    // abgebrochen ist. Beide werden deshalb einzeln geprüft, statt beim ersten Treffer
    // auszusteigen: Sonst bleibt die eine Seite für immer stehen, und niemand sieht es.
    const cacheFertig = r.shape === "there-and-back";
    const inDb = (spot.route_geojson as { coordinates: [number, number][] } | null)?.coordinates;
    const dbFertig = !!inDb && inDb.length > (cacheFertig ? r.coords.length / 2 : r.coords.length);
    if (cacheFertig && dbFertig) {
      console.log(`  schon verdoppelt  ${slug}`);
      continue;
    }

    const prof = spot.elevation_profile as { ascent: number; descent: number } | null;
    if (!prof) throw new Error(`${slug}: kein Höhenprofil`);

    // Ausgangspunkt ist immer der einfache Weg, egal welche Seite schon weiter ist.
    const einfach = cacheFertig ? r.coords.slice(0, (r.coords.length + 1) / 2) : r.coords;
    const einfachEl = cacheFertig ? r.elevations.slice(0, (r.elevations.length + 1) / 2) : r.elevations;
    const coords = thereAndBack(einfach);
    const elevations = thereAndBack(einfachEl);
    const km = routeLengthKm(coords);
    const d = dbFertig
      ? { ascent: prof.ascent, descent: prof.descent }
      : doubled(routeLengthKm(einfach), prof.ascent, prof.descent);
    const minutes = hikingTimeMinutes(km, d.ascent, d.descent);

    console.log(
      `  ${go ? "ok   " : "würde"} ${slug.padEnd(24)} ${String(spot.duration).padEnd(13)} -> ${formatDuration(minutes).padEnd(13)} ` +
        `${Math.round(km * 10) / 10} km, ${d.ascent} hm`,
    );
    console.log(`        ${warum}`);

    if (!go) continue;
    const { error } = await db
      .from("spots")
      .update({
        route_geojson: { type: "LineString", coordinates: coords },
        route_waypoints: waypointsFor(coords),
        elevation_profile: elevationProfile(coords, elevations),
        duration: formatDuration(minutes),
      })
      .eq("id", spot.id);
    if (error) throw error;

    // routes.json mitziehen, sonst dreht der nächste `wp:import` die Verdoppelung wieder
    // zurück: Er nimmt die Dauer aus dieser Datei. Die Entscheidung selbst steht in
    // ALWAYS_DOUBLE in routes.ts, damit auch ein frischer `wp:routes` sie wieder trifft.
    Object.assign(r, {
      coords,
      elevations,
      snappedKm: Math.round(km * 100) / 100,
      ascent: d.ascent,
      descent: d.descent,
      minutes,
      shape: "there-and-back",
    });
    touched = true;
  }

  if (go && touched) {
    writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 1));
    console.log(`\n${ROUTES_FILE} nachgezogen.`);
  }

  console.log(`\n${DOUBLE.length} Wanderungen${go ? " angepasst" : " betroffen"}.`);
  if (!go) {
    console.log("TROCKENLAUF. Nichts geschrieben. Wirklich setzen: npm run wp:there-and-back -- --go");
    return;
  }
  console.log("Danach: npm run wp:categories -- --go  (die Wander-Reihen hängen an der Gehzeit)");
  console.log("Und die Texte müssen dieselbe Zahl nennen, siehe npm run wp:consistency -- --only dauer");
}

main();
