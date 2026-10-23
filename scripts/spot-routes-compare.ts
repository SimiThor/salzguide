// BRouter gegen die gespeicherten Spot-Wanderlinien (openrouteservice) und die gespeicherten
// eigenen Runden (Mapbox Optimization), BEVOR etwas davon ersetzt wird (docs/42, Abschnitt 16).
//
//   npm run spot-routes:compare -- --out=<ordner> [--shots=5] [--only=<slug>] [--no-user-tours]
//
// Braucht einen BRouter auf 127.0.0.1:17777 (oder ROUTING_URL_LOCAL, docs/42 Abschnitt 11)
// und .env.local für den LESENDEN Zugriff. Geschrieben wird NUR in --out: report.md,
// results.json und Screenshots (System-Chrome über playwright-core, alt links / neu rechts).
// Gerechnet wird mit DEMSELBEN Kern wie Admin und Builder (snapSpotRouteCore, routeUserLoop),
// ROUTING_URL zeigt für diesen Lauf auf den lokalen Dienst.
//
// ZWEI Eingaben je Spot, weil die gespeicherten Kontrollpunkte (route_waypoints) aus dem
// WP-Import stammen: `waypointsFor` dampfte die FERTIGE Linie auf 4 bis 20 Punkte ein, bei
// Hin-und-zurück-Wegen ohne Rücksicht auf den Wendepunkt. Aus diesen Punkten entsteht oft
// nur ein Stummel (freisaalweg: 1,04 km gespeichert, 0,41 km aus den Punkten), mit jedem
// Dienst. Deshalb rechnet das Skript (a) aus den gespeicherten Punkten (so wie der Knopf
// "Anpassen" heute) und (b) aus Kontrollpunkten, die aus der gespeicherten Linie selbst
// abgeleitet sind (classifyRoute: bei hin&zurück nur der Hinweg, dann verdoppelt; alle
// ~KP_SPACING_M ein Punkt). (b) ist der Vorschlag für das Neu-Rechnen; die Tabelle zeigt beides.
//
// Spots heissen mit Slug (öffentliche Adressen). Eigene Runden gehören Nutzern: nur
// "Eigene Runde n", keine Namen, keine IDs.
process.env.ROUTING_URL = process.env.ROUTING_URL_LOCAL ?? "http://127.0.0.1:17777";
delete process.env.ROUTING_TOKEN;

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { classifyRoute, hikingTimeMinutes, routeCumulativeMeters, routeLengthKm } from "../src/lib/geo.ts";
import { downsample } from "../src/lib/elevation.ts";
import { tourDurationMin } from "../src/lib/routing/chain.ts";
import { snapSpotRouteCore } from "../src/lib/routing/snap-spot.ts";
import { routeUserLoop } from "../src/lib/routing/user-loop.ts";
import type { LngLat } from "../src/lib/routing/types.ts";
import type { ElevationProfile } from "../src/lib/elevation.ts";
import { compareLines, NEAR_M, type LineComparison } from "./lib/line-compare.ts";

const arg = (n: string, d: string | null = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const OUT = arg("out");
const SHOTS = Number(arg("shots", "5"));
const ONLY = arg("only");
const USER_TOURS = !process.argv.includes("--no-user-tours");
if (!OUT) {
  console.error("--out=<ordner> fehlt");
  process.exit(2);
}
mkdirSync(join(OUT, "shots"), { recursive: true });

// ── Schwellen: ab hier ist eine Abweichung "gross" und gehört angesehen ────────────────────
const KM_PCT = 0.15;
const KM_ABS = 0.5;
const HAUSDORFF_M = 250;
const NEAR_MIN = 0.6;
const ASC_PCT = 0.3;
const ASC_ABS = 50;
/** Abstand der abgeleiteten Kontrollpunkte auf der gespeicherten Linie. */
const KP_SPACING_M = 150;
const KP_MIN = 6;
const KP_MAX = 40;

/** Kontrollpunkte aus der gespeicherten Linie: Wendepunkt bleibt erhalten (hin&zurück = Hinweg verdoppelt). */
function deriveWaypoints(line: LngLat[]): { points: LngLat[]; shape: string } {
  const c = classifyRoute(line);
  const shape = c.shape === "out-and-back" ? "hin&zurück" : c.closed ? "Rundweg" : "Strecke";
  const base = c.shape === "out-and-back" ? line.slice(0, c.turnaroundIndex + 1) : line;
  const lenM = routeCumulativeMeters(base).at(-1) ?? 0;
  const k = Math.max(KP_MIN, Math.min(KP_MAX, Math.round(lenM / KP_SPACING_M)));
  const pts = downsample(base, k);
  return { points: c.shape === "out-and-back" ? [...pts, ...pts.slice(0, -1).reverse()] : pts, shape };
}

type Row = {
  kind: "spot" | "user";
  label: string;
  pro: boolean;
  waypoints: number;
  /** Form der gespeicherten Linie: "hin&zurück", "Rundweg", "Strecke". */
  shape: string;
  /** Ergebnis aus den GESPEICHERTEN Kontrollpunkten (route_waypoints), so wie "Anpassen" im Admin heute. */
  storedKp: { n: number; km: number; near: number | null; error?: string } | null;
  old: { coords: LngLat[]; km: number; ascent: number | null; descent: number | null; min: number | null; minStated: string | null; minStatedNum: number | null };
  neu: { coords: LngLat[]; km: number; ascent: number | null; descent: number | null; min: number; warnings: string[]; requests?: number; ms?: number } | null;
  error?: string;
  cmp: LineComparison | null;
  flags: string[];
  /** Je grösser, desto schlechter (für die Reihung der Screenshots). */
  score: number;
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// "~1 Std", "1–2 Std", "2 h 30 min", "45 min" -> Minuten (bei einer Spanne die untere Grenze).
function parseStated(v: string | null): number | null {
  if (!v) return null;
  const s = v.replace(/[~≈]/g, "").trim();
  const m = /^(\d+(?:[.,]\d+)?)\s*(?:[–-]\s*\d+(?:[.,]\d+)?\s*)?(min|minuten|h|std|stunden?)(?:\s*(\d+)\s*min)?/i.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  const min = /^m/i.test(m[2]) ? Math.round(n) : Math.round(n * 60) + (m[3] ? Number(m[3]) : 0);
  return min > 0 ? min : null;
}

function flagsFor(r: Row): { flags: string[]; score: number } {
  const flags: string[] = [];
  let score = 0;
  if (!r.neu) return { flags: ["kein Ergebnis"], score: 100 };
  const dKm = r.neu.km - r.old.km;
  const pKm = r.old.km > 0 ? Math.abs(dKm) / r.old.km : 0;
  if (Math.abs(dKm) > KM_ABS && pKm > KM_PCT) flags.push(`Länge ${dKm > 0 ? "+" : ""}${dKm.toFixed(2)} km (${Math.round(pKm * 100)} %)`);
  score += pKm * 4;
  if (r.cmp) {
    if (r.cmp.hausdorffM > HAUSDORFF_M) flags.push(`Hausdorff ${Math.round(r.cmp.hausdorffM)} m`);
    const near = Math.min(r.cmp.nearAonB, r.cmp.nearBonA);
    if (near < NEAR_MIN) flags.push(`nur ${Math.round(near * 100)} % innerhalb ${NEAR_M} m`);
    score += (1 - near) * 3 + Math.min(1, r.cmp.hausdorffM / 1000);
  }
  if (r.old.ascent != null && r.neu.ascent != null) {
    const dA = r.neu.ascent - r.old.ascent;
    const pA = r.old.ascent > 0 ? Math.abs(dA) / r.old.ascent : dA > 0 ? 1 : 0;
    if (Math.abs(dA) > ASC_ABS && pA > ASC_PCT) flags.push(`Anstieg ${dA > 0 ? "+" : ""}${dA} m`);
    score += Math.min(1, pA);
  }
  if (r.neu.warnings.length) score += 0.2 * r.neu.warnings.length;
  return { flags, score };
}

// ── Spots ──────────────────────────────────────────────────────────────────────────────
async function spots(): Promise<Row[]> {
  let q = sb
    .from("spots")
    .select("slug, is_pro, route_geojson, route_waypoints, elevation_profile, duration")
    .eq("status", "published")
    .not("route_geojson", "is", null)
    .order("slug");
  if (ONLY) q = q.eq("slug", ONLY);
  const { data, error } = await q;
  if (error) throw new Error(`Supabase: ${error.message}`);
  const rows: Row[] = [];
  for (const s of (data ?? []) as Record<string, unknown>[]) {
    const rg = s.route_geojson as { type?: string; coordinates?: LngLat[] } | null;
    if (rg?.type !== "LineString" || !Array.isArray(rg.coordinates) || rg.coordinates.length < 2) continue;
    const waypoints = ((s.route_waypoints as LngLat[] | null) ?? []).filter((p) => Array.isArray(p) && p.length === 2);
    const prof = (s.elevation_profile as ElevationProfile | null) ?? null;
    const oldKm = routeLengthKm(rg.coordinates);
    const stated = (s.duration as string | null) ?? null;
    const derived = deriveWaypoints(rg.coordinates);
    const row: Row = {
      kind: "spot",
      label: s.slug as string,
      pro: Boolean(s.is_pro),
      waypoints: derived.points.length,
      shape: derived.shape,
      storedKp: null,
      old: {
        coords: rg.coordinates,
        km: oldKm,
        ascent: prof?.ascent ?? null,
        descent: prof?.descent ?? null,
        min: prof ? hikingTimeMinutes(prof.distanceKm || oldKm, prof.ascent, prof.descent) : null,
        minStated: stated,
        minStatedNum: parseStated(stated),
      },
      neu: null,
      cmp: null,
      flags: [],
      score: 0,
    };
    // (a) aus den gespeicherten Kontrollpunkten, wie "Anpassen" im Admin heute
    if (waypoints.length >= 2) {
      const a = await snapSpotRouteCore(waypoints);
      row.storedKp = a.ok && a.coords
        ? { n: waypoints.length, km: a.distanceKm ?? routeLengthKm(a.coords), near: Math.min(...(({ nearAonB, nearBonA }) => [nearAonB, nearBonA])(compareLines(a.coords, rg.coordinates))) }
        : { n: waypoints.length, km: 0, near: null, error: a.error };
    }
    // (b) aus Kontrollpunkten entlang der gespeicherten Linie (Vorschlag für das Neu-Rechnen)
    {
      const t0 = Date.now();
      const r = await snapSpotRouteCore(derived.points);
      if (!r.ok || !r.coords) row.error = r.error ?? "?";
      else {
        row.neu = {
          coords: r.coords,
          km: r.distanceKm ?? routeLengthKm(r.coords),
          ascent: r.profile?.ascent ?? null,
          descent: r.profile?.descent ?? null,
          min: r.durationMin ?? 0,
          warnings: r.warnings ?? [],
          requests: Math.ceil((derived.points.length - 1) / 24),
          ms: Date.now() - t0,
        };
        row.cmp = compareLines(r.coords, rg.coordinates);
        console.log(`  ${row.label.padEnd(26)} ${derived.shape.padEnd(10)} ${(Date.now() - t0).toString().padStart(5)} ms  alt ${oldKm.toFixed(2)} km  neu ${row.neu.km.toFixed(2)} km  Hausdorff ${Math.round(row.cmp.hausdorffM)} m  | aus gesp. KP: ${row.storedKp ? (row.storedKp.error ? "FEHLER" : row.storedKp.km.toFixed(2) + " km") : "-"}`);
      }
    }
    if (row.error) console.log(`  ${row.label.padEnd(36)} FEHLER ${row.error}`);
    Object.assign(row, flagsFor(row));
    rows.push(row);
  }
  return rows;
}

// ── Eigene Runden ──────────────────────────────────────────────────────────────────────
async function userTours(): Promise<Row[]> {
  const { data, error } = await sb
    .from("user_tours")
    .select("point_ids, route_geo, start_lat, start_lng, distance_km, duration_min, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Supabase: ${error.message}`);
  const tours = (data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(tours.flatMap((t) => (t.point_ids as string[] | null) ?? []))];
  const { data: pts } = ids.length ? await sb.from("tour_points").select("id, lat, lng").in("id", ids) : { data: [] };
  const byId = new Map(((pts ?? []) as { id: string; lat: number | null; lng: number | null }[]).map((p) => [p.id, p]));
  const rows: Row[] = [];
  tours.forEach((t, i) => {
    const geo = t.route_geo as LngLat[] | null;
    const start: LngLat | null = typeof t.start_lng === "number" && typeof t.start_lat === "number" ? [t.start_lng, t.start_lat] : null;
    const stops = ((t.point_ids as string[] | null) ?? []).map((id) => byId.get(id)).filter((p): p is { id: string; lat: number; lng: number } => !!p && p.lat != null && p.lng != null);
    rows.push({
      kind: "user",
      label: `Eigene Runde ${i + 1}`,
      pro: true,
      waypoints: stops.length,
      shape: "Rundweg",
      storedKp: null,
      old: {
        coords: geo ?? [],
        km: geo ? routeLengthKm(geo) : (Number(t.distance_km) || 0),
        ascent: null,
        descent: null,
        min: typeof t.duration_min === "number" ? t.duration_min : null,
        minStated: null,
        minStatedNum: null,
      },
      neu: null,
      cmp: null,
      flags: [],
      score: 0,
      ...(start ? {} : { error: "kein Start gespeichert" }),
    });
    const row = rows[rows.length - 1];
    if (!start || stops.length < 2) {
      row.error ??= "zu wenige Stopps";
      Object.assign(row, flagsFor(row));
      return;
    }
    rows[rows.length - 1] = row;
    (row as Row & { _run?: () => Promise<void> })._run = async () => {
      const r = await routeUserLoop(start, stops.map((p) => [p.lng, p.lat] as LngLat));
      if (!r.ok) row.error = r.code;
      else {
        row.neu = { coords: r.route.geo, km: r.route.distanceM / 1000, ascent: null, descent: null, min: r.route.durationMin, warnings: r.route.warnings };
        if (geo && geo.length >= 2) row.cmp = compareLines(r.route.geo, geo);
        // Vergleich der Formel: alt = Mapbox-Gehzeit + 2 min je Stopp, neu = tourDurationMin.
        console.log(`  ${row.label.padEnd(36)} alt ${row.old.km.toFixed(2)} km / ${row.old.min ?? "?"} min  neu ${row.neu.km.toFixed(2)} km / ${row.neu.min} min (Formel ${tourDurationMin(r.route.distanceM, "walk", stops.length)})  Hausdorff ${row.cmp ? Math.round(row.cmp.hausdorffM) : "?"} m`);
      }
      Object.assign(row, flagsFor(row));
    };
  });
  for (const row of rows) {
    const run = (row as Row & { _run?: () => Promise<void> })._run;
    if (run) await run();
    delete (row as Row & { _run?: () => Promise<void> })._run;
  }
  return rows;
}

// ── Screenshots: alt links (rot), neu rechts (blau), gleiche Ausdehnung ───────────────────
function html(row: Row): string {
  const all = [...row.old.coords, ...(row.neu?.coords ?? [])];
  const lats = all.map((p) => p[1]);
  const lngs = all.map((p) => p[0]);
  const bounds = JSON.stringify([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]]);
  const toLL = (c: LngLat[]) => JSON.stringify(c.map((p) => [p[1], p[0]]));
  const cap = (t: string) => `<div class="cap">${t}</div>`;
  const oldCap = `ALT: ${row.kind === "spot" ? "openrouteservice" : "Mapbox"} · ${row.old.km.toFixed(2)} km` + (row.old.ascent != null ? ` · ↑${row.old.ascent} ↓${row.old.descent}` : "") + (row.old.min != null ? ` · ${row.old.min} min` : "");
  const newCap = row.neu ? `NEU: BRouter hiking-mountain · ${row.neu.km.toFixed(2)} km` + (row.neu.ascent != null ? ` · ↑${row.neu.ascent} ↓${row.neu.descent}` : "") + ` · ${row.neu.min} min` : "NEU: kein Ergebnis";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${row.label}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>body{margin:0;font:13px/1.3 -apple-system,Helvetica,sans-serif;background:#fff}#wrap{display:flex;width:1400px;height:700px}.pane{position:relative;width:700px;height:700px}.map{width:100%;height:100%}.cap{position:absolute;top:8px;left:8px;z-index:1000;background:rgba(255,255,255,.92);padding:6px 10px;border-radius:8px;font-weight:600}.title{position:absolute;bottom:8px;left:8px;z-index:1000;background:rgba(255,255,255,.92);padding:4px 8px;border-radius:6px}</style></head>
<body><div id="wrap"><div class="pane">${cap(oldCap)}<div id="a" class="map"></div><div class="title">${row.label}${row.flags.length ? " · " + row.flags.join(" · ") : ""}</div></div><div class="pane">${cap(newCap)}<div id="b" class="map"></div></div></div>
<script>
const bounds = ${bounds};
function mk(id, line, color) {
  const m = L.map(id, { zoomControl: false, attributionControl: true });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "© OpenStreetMap-Mitwirkende" }).addTo(m);
  if (line.length) L.polyline(line, { color, weight: 4, opacity: 0.9 }).addTo(m);
  m.fitBounds(bounds, { padding: [20, 20] });
  return m;
}
const a = mk("a", ${toLL(row.old.coords)}, "#cc2924");
const b = mk("b", ${toLL(row.neu?.coords ?? [])}, "#1d4ed8");
b.setView(a.getCenter(), a.getZoom());
let tiles = 0; let done = 0;
for (const m of [a, b]) m.eachLayer((l) => { if (l instanceof L.TileLayer) { tiles++; l.on("load", () => { done++; }); } });
window.__ready = () => done >= tiles;
</script></body></html>`;
}

async function shots(rows: Row[]) {
  const worst = rows.filter((r) => r.neu).sort((a, b) => b.score - a.score).slice(0, SHOTS);
  if (!worst.length) return [] as string[];
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 }, deviceScaleFactor: 1 });
  const out: string[] = [];
  for (const r of worst) {
    const name = r.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const file = join(OUT!, "shots", `${name}.html`);
    writeFileSync(file, html(r));
    await page.goto(`file://${file}`, { waitUntil: "load" });
    for (let i = 0; i < 40; i++) {
      if (await page.evaluate(() => (window as unknown as { __ready?: () => boolean }).__ready?.())) break;
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(800);
    const png = join(OUT!, "shots", `${name}.png`);
    await page.screenshot({ path: png });
    out.push(png);
    console.log(`  Screenshot ${png}`);
  }
  await browser.close();
  return out;
}

// ── Bericht ────────────────────────────────────────────────────────────────────────────
const f2 = (x: number | null | undefined) => (x == null ? "?" : x.toFixed(2));
const pct = (x: number) => `${Math.round(x * 100)} %`;
const sgn = (x: number) => (x >= 0 ? `+${x}` : `${x}`);

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function report(spotRows: Row[], userRows: Row[], pngs: string[]): string {
  const ok = spotRows.filter((r) => r.neu);
  const flagged = ok.filter((r) => r.flags.length);
  const dKm = ok.map((r) => r.neu!.km - r.old.km);
  const pKm = ok.map((r) => (r.old.km > 0 ? ((r.neu!.km - r.old.km) / r.old.km) * 100 : 0));
  const near = ok.filter((r) => r.cmp).map((r) => Math.min(r.cmp!.nearAonB, r.cmp!.nearBonA));
  const haus = ok.filter((r) => r.cmp).map((r) => r.cmp!.hausdorffM);
  const dAsc = ok.filter((r) => r.old.ascent != null && r.neu!.ascent != null).map((r) => r.neu!.ascent! - r.old.ascent!);
  const dMin = ok.filter((r) => r.old.min != null).map((r) => r.neu!.min - r.old.min!);
  const L: string[] = [];
  L.push(`# Vergleich: BRouter gegen gespeicherte Spot-Wanderlinien und eigene Runden`);
  L.push(``);
  L.push(`Stand ${new Date().toISOString().slice(0, 16).replace("T", " ")} · BRouter 1.7.10 lokal, Wegdaten E10_N45.rd5 vom 23.10.2026, Profil \`hiking-mountain\` · nur gelesen, nichts geschrieben.`);
  L.push(``);
  L.push(`**Wichtig vor jedem Neu-Rechnen:** Die Spot-Linie steckt im Hash des Intro-Videos (\`introSourceHash\`, src/lib/intro-hash.ts). Wird \`route_geojson\` eines Spots neu gerechnet (Skript oder "Anpassen" im Admin), gilt sein Intro-Video als veraltet und wird neu gerendert.`);
  L.push(``);
  L.push(`## Spots (${spotRows.length} veröffentlichte Wanderungen, ${spotRows.filter((r) => r.pro).length} Pro)`);
  L.push(``);
  L.push(`- Ergebnis: ${ok.length} berechnet, ${spotRows.length - ok.length} ohne Ergebnis${spotRows.filter((r) => r.error).length ? ` (${spotRows.filter((r) => r.error).map((r) => `${r.label}: ${r.error}`).join("; ")})` : ""}.`);
  L.push(`- Länge: Median ${sgn(Math.round(median(dKm) * 1000))} m (${sgn(Math.round(median(pKm)))} %), Spanne ${f2(Math.min(...dKm))} bis ${f2(Math.max(...dKm))} km.`);
  L.push(`- Linie: Median "nah" (innerhalb ${NEAR_M} m, kleinerer Wert beider Richtungen) ${pct(median(near))}, Median Hausdorff ${Math.round(median(haus))} m.`);
  L.push(`- Anstieg: Median ${sgn(Math.round(median(dAsc)))} m; Gehzeit (SAC, gleiche Formel alt und neu): Median ${sgn(Math.round(median(dMin)))} min.`);
  L.push(`- Auffällig (Länge > ${KM_ABS} km und > ${KM_PCT * 100} %, Hausdorff > ${HAUSDORFF_M} m, nah < ${NEAR_MIN * 100} %, Anstieg > ${ASC_ABS} m und > ${ASC_PCT * 100} %): **${flagged.length} von ${ok.length}**.`);
  L.push(`- Hinweise des Dienstes (Kontrollpunkt weit neben der Linie, Kehre): ${ok.filter((r) => r.neu!.warnings.length).length} Spots.`);
  const kp = spotRows.filter((r) => r.storedKp && !r.storedKp.error);
  const kpShort = kp.filter((r) => r.storedKp!.km < r.old.km * 0.7);
  L.push(``);
  L.push(`**Gespeicherte Kontrollpunkte (route_waypoints) sind für das Neu-Rechnen NICHT brauchbar:** aus ihnen (so wie "Anpassen" im Admin heute, mit jedem Dienst) werden ${kpShort.length} von ${kp.length} Linien um mehr als 30 % kürzer, ${spotRows.filter((r) => r.storedKp?.error).length} scheitern. Grund: Der WP-Import hat die fertige Linie auf 4 bis 20 Punkte eingedampft (\`waypointsFor\`), bei Hin-und-zurück-Wegen (${spotRows.filter((r) => r.shape === "hin&zurück").length} von ${spotRows.length}) ohne den Wendepunkt. Die Tabelle rechnet deshalb mit Kontrollpunkten aus der gespeicherten Linie selbst (Hinweg alle ${KP_SPACING_M} m, dann verdoppelt). Beim Neu-Rechnen sollten diese Punkte auch als route_waypoints gespeichert werden, sonst zerstört der nächste Klick auf "Anpassen" die Route (Skript-Option --fix-waypoints).`);
  L.push(``);
  L.push(`| Spot | Pro | Form | KP | alt km | neu km | Δ | alt ↑/↓ | neu ↑/↓ | Dauer alt (Feld / SAC) | neu SAC | Hausdorff | Mittel | nah | aus gesp. KP | Flags |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of [...spotRows].sort((a, b) => b.score - a.score)) {
    const n = r.neu;
    L.push(
      `| ${r.label} | ${r.pro ? "ja" : ""} | ${r.shape} | ${r.waypoints} | ${f2(r.old.km)} | ${n ? f2(n.km) : "-"} | ${n ? sgn(Math.round((n.km - r.old.km) * 1000)) + " m" : r.error ?? "-"} | ${r.old.ascent ?? "?"}/${r.old.descent ?? "?"} | ${n ? `${n.ascent ?? "?"}/${n.descent ?? "?"}` : "-"} | ${r.old.minStated ?? "-"} / ${r.old.min ?? "?"} | ${n ? n.min : "-"} | ${r.cmp ? Math.round(r.cmp.hausdorffM) + " m" : "-"} | ${r.cmp ? r.cmp.meanM.toFixed(0) + " m" : "-"} | ${r.cmp ? pct(Math.min(r.cmp.nearAonB, r.cmp.nearBonA)) : "-"} | ${r.storedKp ? (r.storedKp.error ? "Fehler" : `${f2(r.storedKp.km)} km (${r.storedKp.n} KP, nah ${pct(r.storedKp.near ?? 0)})`) : "-"} | ${r.flags.join(", ")}${n?.warnings.length ? ` · ${n.warnings.length} Hinweis(e)` : ""} |`,
    );
  }
  L.push(``);
  L.push(`Lesart: "alt" ist die gespeicherte Linie (openrouteservice foot-hiking, Stand des letzten Snaps bzw. des Imports), "neu" die BRouter-Linie aus Kontrollpunkten (KP) entlang dieser Linie; "aus gesp. KP" die BRouter-Linie aus den heute gespeicherten route_waypoints. Dauer alt/SAC = dieselbe Gehzeit-Formel auf das alte Profil, damit nur Linie und Höhen verglichen werden, nicht zwei Formeln. Das Feld "Dauer" im Spot ist vom Admin gesetzt und wird beim Neu-Rechnen NICHT überschrieben.`);
  L.push(``);
  if (userRows.length) {
    const uok = userRows.filter((r) => r.neu);
    L.push(`## Eigene Runden (${userRows.length} gespeichert, ${uok.length} berechnet)`);
    L.push(``);
    L.push(`Kette: Start, Stopps in der gespeicherten Reihenfolge (point_ids), zurück zum Start; eine Anfrage, Profil hiking-mountain. Dauer alt = Mapbox-Gehzeit + 2 min je Stopp, neu = 4,5 km/h + 2 min je Stopp (docs/42 Abschnitt 4).`);
    L.push(``);
    L.push(`| Runde | Stopps | alt km | neu km | Δ | alt min | neu min | Hausdorff | Mittel | nah | Flags |`);
    L.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const r of userRows) {
      const n = r.neu;
      L.push(`| ${r.label} | ${r.waypoints} | ${f2(r.old.km)} | ${n ? f2(n.km) : "-"} | ${n ? sgn(Math.round((n.km - r.old.km) * 1000)) + " m" : r.error ?? "-"} | ${r.old.min ?? "?"} | ${n ? n.min : "-"} | ${r.cmp ? Math.round(r.cmp.hausdorffM) + " m" : "-"} | ${r.cmp ? r.cmp.meanM.toFixed(0) + " m" : "-"} | ${r.cmp ? pct(Math.min(r.cmp.nearAonB, r.cmp.nearBonA)) : "-"} | ${r.flags.join(", ")} |`);
    }
    L.push(``);
  }
  const slow = ok.filter((r) => (r.neu!.ms ?? 0) > 5000).sort((a, b) => (b.neu!.ms ?? 0) - (a.neu!.ms ?? 0));
  const ascDiff = ok
    .filter((r) => r.old.ascent != null && r.neu!.ascent != null)
    .map((r) => ({ r, d: r.neu!.ascent! - r.old.ascent! }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 8);
  L.push(`## Hinweise aus der Durchsicht`);
  L.push(``);
  L.push(`- **Linien:** Mit Kontrollpunkten alle ${KP_SPACING_M} m entlang der alten Linie liegt BRouter bei ${ok.filter((r) => r.cmp && r.cmp.hausdorffM <= 20).length} von ${ok.length} Spots innerhalb 20 m der alten Linie (Hausdorff). Die Linien sind damit praktisch dieselben Wege, nur auf OSM-Daten und ohne CC-BY-SA-Pflicht.`);
  L.push(`- **Höhenmeter sind die eigentliche Änderung:** BRouter nimmt die Höhen aus seinen Wegdaten (SRTM, in den rd5-Kacheln geglättet), openrouteservice aus eigenen Höhendaten. Beide laufen durch dieselbe Glättung (ascentDescent, Zacken unter 3 m). Die neuen Anstiege liegen meist NIEDRIGER (Median ${sgn(Math.round(median(dAsc)))} m). Plausibilitätsprobe für Anton: Mönchsberg ab Altstadt (ca. 80 m je Richtung) alt ${spotRows.find((r) => r.label === "monchsberg")?.old.ascent ?? "?"} m, neu ${spotRows.find((r) => r.label === "monchsberg")?.neu?.ascent ?? "?"} m; Gollinger Wasserfall alt ${spotRows.find((r) => r.label === "gollinger-wasserfall")?.old.ascent ?? "?"} m, neu ${spotRows.find((r) => r.label === "gollinger-wasserfall")?.neu?.ascent ?? "?"} m. Grösste Unterschiede: ${ascDiff.map(({ r, d }) => `${r.label} ${sgn(d)} m (alt ${r.old.ascent}, neu ${r.neu!.ascent})`).join("; ")}. Die SAC-Gehzeit folgt den Höhenmetern; das Feld "Dauer" bleibt aber vom Admin gesetzt und wird nicht angetastet. Das Höhenprofil auf der Spot-Seite ändert sich sichtbar.`);
  L.push(`- **Langsame Anfragen:** ${slow.length ? slow.map((r) => `${r.label} ${Math.round((r.neu!.ms ?? 0) / 1000)} s (${r.neu!.requests} Anfrage(n))`).join(", ") : "keine über 5 s"}. Der Server bricht nach 20 s ab (purpose "spot"); das Profil hiking-mountain braucht in alpinem Gelände für einzelne Teilstücke bis 28 s (gemessen: ein 500-m-Teilstück der Spinnerin 18 bis 28 s, mit \`shortest\` 0 s, gleiche Linie). Fällt ein Spot im Admin auf "Routendienst zu langsam", hilft ein Kontrollpunkt weniger in diesem Abschnitt, oder der Geo-Server ist schneller als dieser Mac.`);
  L.push(`- **Hinweise des Dienstes** ("Punkt n liegt x m neben der berechneten Linie", "Kehre bei Punkt n") sind bei abgeleiteten Punkten erwartbar (sie liegen auf der alten Linie, nicht auf einem OSM-Knoten) und im Admin nach dem Neu-Rechnen sichtbar; sie ändern nichts an der Linie.`);
  L.push(``);
  const worst = [...spotRows, ...userRows].filter((r) => r.neu).sort((a, b) => b.score - a.score).slice(0, SHOTS);
  L.push(`## Schlechteste Fälle (Screenshots: alt links rot, neu rechts blau)`);
  L.push(``);
  worst.forEach((r, i) => {
    const png = pngs[i];
    L.push(`${i + 1}. **${r.label}**: ${r.flags.length ? r.flags.join("; ") : "keine Schwelle gerissen"}${r.neu?.warnings.length ? ` · Hinweise: ${r.neu.warnings.join(" | ")}` : ""}${png ? `  \n   ${png}` : ""}`);
  });
  L.push(``);
  L.push(`## Was Anton entscheiden muss`);
  L.push(``);
  L.push(`1. Profil \`hiking-mountain\` für Spot-Wanderungen so übernehmen (Alternative: \`shortest\`, liegt nicht auf dem Server).`);
  L.push(`2. Die ${spotRows.length} Spot-Linien neu rechnen: per Skript (\`spot-routes:rewrite --write\`, schreibt nur route_geojson + elevation_profile) oder Spot für Spot im Admin. Beides markiert die Intro-Videos als veraltet.`);
  L.push(`3. Die ${userRows.length} eigenen Runden neu rechnen (Reihenfolge bleibt, Linie, km und Minuten werden ersetzt).`);
  L.push(`4. route_waypoints mit den abgeleiteten Kontrollpunkten ersetzen (--fix-waypoints), damit "Anpassen" im Admin die Route nicht zum Stummel macht.`);
  return L.join("\n");
}

async function main() {
  console.log(`BRouter ${process.env.ROUTING_URL} · nur lesend · Ausgabe ${OUT}\n`);
  console.log("Spots:");
  const spotRows = await spots();
  let userRows: Row[] = [];
  if (USER_TOURS && !ONLY) {
    console.log("\nEigene Runden:");
    userRows = await userTours();
  }
  console.log("\nScreenshots:");
  const pngs = await shots([...spotRows, ...userRows]);
  const md = report(spotRows, userRows, pngs);
  writeFileSync(join(OUT!, "report.md"), md);
  const slim = [...spotRows, ...userRows].map((r) => ({ ...r, old: { ...r.old, coords: r.old.coords.length }, neu: r.neu ? { ...r.neu, coords: r.neu.coords.length } : null }));
  writeFileSync(join(OUT!, "results.json"), JSON.stringify(slim, null, 1));
  console.log(`\n-> ${join(OUT!, "report.md")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
