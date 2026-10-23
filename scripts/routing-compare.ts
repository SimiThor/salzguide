// BRouter gegen die gespeicherte Mapbox-Linie, für jede VERÖFFENTLICHTE Runde (docs/42).
//
//   npm run routing:compare                       Profil je Fortbewegung wie im Adapter
//   npm run routing:compare -- --profiles=all     zusätzlich alle Kandidaten-Profile
//
// Braucht einen BRouter auf 127.0.0.1:17777 (oder ROUTING_URL_LOCAL) mit den Wegdaten für
// Salzburg (E10_N45) und .env.local für den LESENDEN Zugriff auf die Runden. Geschrieben
// wird nichts. Geroutet wird mit dem ECHTEN Adapter (src/lib/routing/brouter.ts), dieselbe
// Kette wie snapTourRoute (Start, Stopps, Wegpunkte, Ziel).
//
// Ausgabe ohne Titel und Slugs (öffentliches Repo): "Tour 1 (Rad, Pro)".
import { BrouterProvider, BROUTER_PROFILE, parseBrouterGeojson } from "../src/lib/routing/brouter.ts";
import { toNavSteps, type LngLat, type NormalizedRoute } from "../src/lib/routing/types.ts";
import { routeCumulativeMeters, toLocalM } from "../src/lib/geo.ts";
import type { TourMode } from "../src/lib/tour-mode.ts";
import { brouterBase, loadPublishedTours, tourTitle, type TourForRouting } from "./lib/routing-tours.ts";

const CANDIDATES: Record<TourMode, string[]> = {
  bike: ["trekking", "fastbike", "safety"],
  walk: ["hiking-mountain", "shortest"],
};
const NEAR_M = 15;
const SAMPLE_M = 5;

const all = process.argv.includes("--profiles=all");

// ── Abstand zweier Linien ─────────────────────────────────────────────────────────────
function sample(line: LngLat[], stepM: number): LngLat[] {
  const cum = routeCumulativeMeters(line);
  const total = cum[cum.length - 1];
  const out: LngLat[] = [];
  let seg = 0;
  for (let d = 0; d <= total; d += stepM) {
    while (seg < line.length - 2 && cum[seg + 1] < d) seg++;
    const len = cum[seg + 1] - cum[seg];
    const f = len > 0 ? (d - cum[seg]) / len : 0;
    out.push([line[seg][0] + (line[seg + 1][0] - line[seg][0]) * f, line[seg][1] + (line[seg + 1][1] - line[seg][1]) * f]);
  }
  return out;
}

function distToLine(p: [number, number], line: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d < best) best = d;
  }
  return best;
}

function compareLines(a: LngLat[], b: LngLat[]) {
  const lat0 = a[0][1];
  const la = a.map((p) => toLocalM(p, lat0));
  const lb = b.map((p) => toLocalM(p, lat0));
  const da = sample(a, SAMPLE_M).map((p) => distToLine(toLocalM(p, lat0), lb));
  const db = sample(b, SAMPLE_M).map((p) => distToLine(toLocalM(p, lat0), la));
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const share = (xs: number[]) => xs.filter((x) => x <= NEAR_M).length / xs.length;
  return {
    hausdorffM: Math.max(...da, ...db),
    meanM: (mean(da) + mean(db)) / 2,
    nearAonB: share(da),
    nearBonA: share(db),
    // Wie viele Meter der neuen Linie liegen weiter als 15 m von der alten weg?
    offM: da.filter((x) => x > NEAR_M).length * SAMPLE_M,
  };
}

// ── Wegarten aus den Abschnittsmerkmalen (nur Auswertung, nichts davon wird gespeichert) ──
type WayStats = Record<string, number>;
function wayStats(payload: unknown): WayStats {
  const msgs = (payload as { features?: { properties?: { messages?: unknown[] } }[] })?.features?.[0]?.properties?.messages;
  const out: WayStats = {};
  if (!Array.isArray(msgs)) return out;
  const head = msgs[0] as string[];
  const iDist = head.indexOf("Distance");
  const iTags = head.indexOf("WayTags");
  for (const row of msgs.slice(1) as string[][]) {
    const m = Number(row[iDist]) || 0;
    const tags = row[iTags] ?? "";
    const hw = /(?:^| )highway=([a-z_]+)/.exec(tags)?.[1] ?? "?";
    const bikeOk = /bicycle=(yes|designated|permissive)/.test(tags);
    let k: string;
    if (hw === "steps") k = "Treppen";
    else if (hw === "pedestrian") k = bikeOk ? "Fussgängerzone (Rad frei)" : "Fussgängerzone";
    else if (hw === "footway" || hw === "path" || hw === "bridleway") k = bikeOk ? "Fuss-/Radweg" : "Fussweg/Pfad";
    else if (hw === "cycleway") k = "Radweg";
    else if (hw === "track") k = "Feldweg";
    else if (["primary", "secondary", "trunk", "primary_link", "secondary_link"].includes(hw)) k = "Hauptstrasse";
    else if (["tertiary", "unclassified", "residential", "living_street", "service", "tertiary_link"].includes(hw)) k = "Nebenstrasse";
    else k = `sonst (${hw})`;
    out[k] = (out[k] ?? 0) + m;
  }
  return out;
}

async function rawBrouter(points: LngLat[], profile: string): Promise<unknown> {
  const url = new URL(`${brouterBase()}/brouter`);
  url.searchParams.set("lonlats", points.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join("|"));
  url.searchParams.set("profile", profile);
  url.searchParams.set("alternativeidx", "0");
  url.searchParams.set("format", "geojson");
  url.searchParams.set("timode", "2");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BRouter ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

const km = (m: number) => `${(m / 1000).toFixed(2)} km`;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const sign = (x: number) => (x >= 0 ? `+${Math.round(x)}` : `${Math.round(x)}`);

async function one(t: TourForRouting, profile: string, primary: boolean, live: LngLat[] | null) {
  const provider = new BrouterProvider(brouterBase(), undefined, { profileFor: () => profile });
  const t0 = Date.now();
  const route: NormalizedRoute = await provider.route({ points: t.points, mode: t.mode });
  const ms = Date.now() - t0;
  const navSteps = toNavSteps(route.steps, () => "");
  const line = [`  Profil ${profile}${primary ? " (gewählt)" : ""}: ${km(route.distanceM)}, ${route.geometry.length} Punkte, ${ms} ms`];
  if (t.storedGeo) {
    const storedM = routeCumulativeMeters(t.storedGeo).at(-1)!;
    const c = compareLines(route.geometry, t.storedGeo);
    line.push(
      `    Länge gegen Mapbox: ${sign(route.distanceM - storedM)} m (${sign(((route.distanceM - storedM) / storedM) * 100)} %), ` +
        `Hausdorff ${Math.round(c.hausdorffM)} m, Mittel ${c.meanM.toFixed(1)} m`,
      `    innerhalb ${NEAR_M} m: BRouter auf Mapbox ${pct(c.nearAonB)}, Mapbox auf BRouter ${pct(c.nearBonA)}; ` +
        `${c.offM} m der BRouter-Linie liegen weiter weg`,
    );
  }
  if (live) {
    const liveM = routeCumulativeMeters(live).at(-1)!;
    const c = compareLines(route.geometry, live);
    line.push(
      `    gegen Mapbox LIVE: ${sign(route.distanceM - liveM)} m (${sign(((route.distanceM - liveM) / liveM) * 100)} %), ` +
        `Hausdorff ${Math.round(c.hausdorffM)} m, Mittel ${c.meanM.toFixed(1)} m, innerhalb ${NEAR_M} m ${pct(c.nearAonB)} / ${pct(c.nearBonA)}`,
    );
  }
  const counts = (types: string[]) => route.steps.filter((s) => types.includes(s.type)).length;
  line.push(
    `    Schritte: ${route.steps.length - 1} Hinweise (turn ${counts(["turn"])}, fork ${counts(["fork"])}, ` +
      `continue ${counts(["continue"])}, Kreisverkehr ${counts(["roundabout"])}, Kehre ${route.steps.filter((s) => s.modifier === "uturn").length}) ` +
      `-> nach prepareSteps ${navSteps.length - 1} Ansagen + Ankunft`,
    `    Dauer laut BRouter ${route.durationS != null ? Math.round(route.durationS / 60) : "?"} min, Anstieg ${route.ascentM ?? "?"} m` +
      (t.storedDurationMin != null ? ` (gespeichert: ${t.storedDurationMin} min inkl. Stopps)` : ""),
  );
  const raw = await rawBrouter(t.points, profile);
  // Gegenprobe: Die reine Umrechnung liefert dieselbe Linie wie der Adapter.
  const again = parseBrouterGeojson(raw, t.points, profile);
  if (again.lineHash !== route.lineHash) line.push("    WARNUNG: Rohabruf und Adapter liefern verschiedene Linien.");
  const ws = wayStats(raw);
  const total = Object.values(ws).reduce((s, x) => s + x, 0) || 1;
  line.push(
    "    Wegarten: " +
      Object.entries(ws)
        .sort((a, b) => b[1] - a[1])
        .map(([k, m]) => `${k} ${Math.round(m)} m (${Math.round((m / total) * 100)} %)`)
        .join(", "),
  );
  const stopAlong = route.waypointAlongM.filter((_, i) => t.kinds[i] === "stop");
  line.push(`    Stopps auf der Linie bei: ${stopAlong.map((m) => Math.round(m)).join(", ")} m`);
  if (route.warnings.length) line.push(...route.warnings.map((w) => `    Hinweis: ${w}`));
  console.log(line.join("\n"));
}

async function main() {
  const tours = await loadPublishedTours();
  console.log(`BRouter ${brouterBase()} · ${tours.length} veröffentlichte Runden · nur lesend\n`);
  for (const t of tours) {
    const storedM = t.storedGeo ? routeCumulativeMeters(t.storedGeo).at(-1)! : null;
    console.log(
      `${tourTitle(t)}: ${t.points.length} Kettenpunkte (${t.kinds.filter((k) => k === "stop").length} Stopps, ` +
        `${t.kinds.filter((k) => k === "via").length} Wegpunkte), gespeicherte Linie ${storedM != null ? km(storedM) : "keine"}, ` +
        `Kette = route_hash: ${t.hashMatches ? "ja" : "NEIN (Linie aus anderem Stand)"}`,
    );
    const profiles = all ? CANDIDATES[t.mode] : [BROUTER_PROFILE[t.mode]];
    const live: LngLat[] | null = null;
    for (const p of profiles) {
      try {
        await one(t, p, p === BROUTER_PROFILE[t.mode], live);
      } catch (err) {
        console.log(`  Profil ${p}: FEHLER ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
