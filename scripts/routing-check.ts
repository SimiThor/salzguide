// Prüft den Routendienst-Teil der Web-Seite (docs/42): Modul, Admin-Kern, Offline-Paket und
// Umrouten der App. Aufruf:
//
//   npm run routing:check                          Offline-Teil + BRouter-Teil (lokaler BRouter)
//   npm run routing:check -- --no-brouter          nur der Teil ohne Routendienst
//   npm run routing:check -- --base=http://localhost:3013 [--brouter-log=<datei>] [--server-log=<datei>]
//                                                  zusätzlich die echten Routen gegen einen laufenden Server
//
// BRouter-Teil: braucht einen BRouter auf 127.0.0.1:17777 (oder ROUTING_URL_LOCAL) mit den
// Wegdaten E10_N45 (docs/42 Abschnitt 11). Es wird NICHTS in eine Datenbank geschrieben: Die
// Speicher-Prüfungen laufen gegen einen Speicher im Arbeitsspeicher und einen Attrappen-Client.
//
// HTTP-Teil (--base): Der Server muss mit ROUTING_URL=http://127.0.0.1:17777 laufen und das
// ECHTE Supabase benutzen (wie app-api:check). Er legt ein Wegwerf-Konto an (Pro an und aus)
// und löscht es IMMER wieder. Vor Migration 0076 gibt es die Tabelle noch nicht, der Server
// rechnet dann bei jedem Abruf neu; das Zwischenspeichern beweist der Speicher-Teil.
//
// Die Ausgabe nennt nie Titel, Slugs oder Texte von Pro-Inhalten.
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { OSM_ATTRIBUTION, MAX_ROUTE_POINTS, RoutingError, toNavSteps } from "../src/lib/routing/types.ts";
import { getRoutingProvider } from "../src/lib/routing/index.ts";
import { BROUTER_PROFILE, BrouterProvider, maneuverFromHint } from "../src/lib/routing/brouter.ts";
import { MANEUVER_KEYS, maneuverKey } from "../src/lib/maneuver-text.ts";
import { alongForChain, buildTourChain, dedupePoints, tourDurationMin, travelMinutes } from "../src/lib/routing/chain.ts";
import { runChain } from "../src/lib/routing/run.ts";
import { snapTourRouteCore } from "../src/lib/routing/snap-tour.ts";
import { FALLBACK_SPEED_MPS } from "../src/lib/nav-format.ts";
import { tourRouteHash, type ViaLeg } from "../src/lib/tour-route.ts";
import { assemblePackage, contentHashOf, packageBbox, stableStringify } from "../src/lib/tour-package.ts";
import { getTourNavRoute, supabaseNavRouteStore, type NavRouteStore, type StoredNavRoute } from "../src/lib/tour-nav-route.ts";
import { planReroute, rerouteTour } from "../src/lib/tour-reroute.ts";
import { myTourIdOf } from "../src/lib/tour-chain.ts";
import { OPS_EVENTS } from "../src/lib/ops-events.ts";
import type { TourDetail, TourStopView } from "../src/lib/tour-types.ts";
import type { TourMode } from "../src/lib/tour-mode.ts";
import { createTempUser, deleteTempUser, setProfile, sweepTempUsers } from "./lib/temp-user.ts";
import type { TempUser } from "./lib/temp-user.ts";

// ── Ausgabe ───────────────────────────────────────────────────────────────────
let okCount = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): boolean {
  if (cond) {
    okCount++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FEHLT ${name}${detail ? `\n        ${detail}` : ""}`);
  }
  return cond;
}
const info = (msg: string) => console.log(`  ..    ${msg}`);
const head = (msg: string) => console.log(`\n${msg}`);
const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const BROUTER = process.env.ROUTING_URL_LOCAL ?? "http://127.0.0.1:17777";
const noBrouter = process.argv.includes("--no-brouter");

// ── Fixture: eine Runde mit echten Koordinaten (Salzburg, Altstadt), kein Inhalt aus der DB ──
const COORDS: [number, number][] = [
  [13.0433, 47.8019],
  [13.0475, 47.8035],
  [13.0505, 47.799],
  [13.046, 47.7985],
  [13.0398, 47.8011],
  [13.0425, 47.7975],
];
const START = { lat: 47.8012, lng: 13.0445 };

function tokenUrl(kind: "FULL" | "TEASER", i: number, token: string) {
  return `https://proj.supabase.co/storage/v1/object/sign/tour-audio/${kind}-p${i}.mp3?token=${token}`;
}

function detailOf(opts: {
  mode: TourMode;
  canSeePro: boolean;
  token?: string;
  coords?: [number, number][];
  via?: ViaLeg[];
  isPro?: boolean;
  freeStops?: number;
}): TourDetail {
  const coords = opts.coords ?? COORDS;
  const isPro = opts.isPro ?? true;
  const freeStops = opts.freeStops ?? 2;
  const token = opts.token ?? "t1";
  const stops: TourStopView[] = coords.map((c, i) => {
    const locked = isPro && i >= freeStops && !opts.canSeePro;
    return {
      spotSlug: `p${i}`,
      order: i + 1,
      title: `Stopp ${i + 1}`,
      shortDesc: null,
      emoji: "📍",
      imageUrl: `https://proj.supabase.co/storage/v1/object/public/tour-images/p${i}.webp`,
      lat: c[1],
      lng: c[0],
      locked,
      audioUrl: locked ? null : tokenUrl("FULL", i, token),
      audioText: locked ? null : `Text ${i}`,
      durationSec: locked ? null : 50 + i,
      teaserUrl: locked ? tokenUrl("TEASER", i, token) : null,
      teaserSec: locked ? 20 : null,
    };
  });
  return {
    slug: "fixture-runde",
    region: "salzburg",
    emoji: "🚲",
    coverUrl: "https://proj.supabase.co/storage/v1/object/public/tour-images/cover.webp",
    title: "Fixture",
    subtitle: null,
    stopCount: stops.length,
    isPro,
    freeStops,
    durationMin: null,
    distanceKm: null,
    mode: opts.mode,
    description: "Beschreibung",
    stops,
    canSeePro: opts.canSeePro,
    routeGeo: null,
    start: START,
    end: START,
    routeVia: opts.via ?? [],
  };
}

// ── Speicher im Arbeitsspeicher (wie tour_nav_routes, nur ohne Datenbank) ──────────────────
function memoryStore() {
  const rows = new Map<string, StoredNavRoute>();
  const calls = { get: 0, put: 0 };
  const store: NavRouteStore = {
    async get(tourId, routeHash) {
      calls.get++;
      return rows.get(`${tourId}|${routeHash}`) ?? null;
    },
    async put(tourId, route) {
      calls.put++;
      for (const k of [...rows.keys()]) if (k.startsWith(`${tourId}|`)) rows.delete(k);
      rows.set(`${tourId}|${route.routeHash}`, route);
    },
  };
  return { store, rows, calls };
}

// ── BRouter-Anfragen zählen ────────────────────────────────────────────────────────────
let brouterRequests = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (u.startsWith(BROUTER)) brouterRequests++;
  return realFetch(input, init);
}) as typeof fetch;

async function brouterUp(): Promise<boolean> {
  try {
    const r = await realFetch(`${BROUTER}/brouter?lonlats=13.043,47.802|13.055,47.805&profile=trekking&alternativeidx=0&format=geojson`, {
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const grab = (...a: unknown[]) => lines.push(a.map(String).join(" "));
  console.log = grab;
  console.warn = grab;
  console.error = grab;
  return fn().then(
    (result) => {
      Object.assign(console, orig);
      return { result, out: lines.join("\n") };
    },
    (e) => {
      Object.assign(console, orig);
      throw e;
    },
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════
// 1. Bausteine ohne Routendienst
// ═════════════════════════════════════════════════════════════════════════════════════
async function partOffline(): Promise<void> {
  head("1. Dateien und Einstellungen");
  const src = (p: string) => readFileSync(new URL(`../src/lib/${p}`, import.meta.url), "utf8");
  check("OSM_ATTRIBUTION steht in types.ts ohne server-only", OSM_ATTRIBUTION === "© OpenStreetMap-Mitwirkende" && !/import "server-only"/.test(src("routing/types.ts")));
  check("chain.ts ist ohne server-only (Client und Swift-Port dürfen es lesen)", !/import "server-only"/.test(src("routing/chain.ts")));
  for (const f of ["routing/run.ts", "routing/index.ts", "routing/brouter.ts", "routing/normalize.ts", "routing/snap-tour.ts", "tour-nav-route.ts", "tour-package.ts", "tour-reroute.ts"])
    check(`${f} trägt server-only`, /import "server-only"/.test(src(f)));
  check("ops-events.ts bleibt ohne server-only", !/import "server-only"/.test(src("ops-events.ts")));
  check("Katalog: routing_failed (error, Muster ab 3)", OPS_EVENTS.routing_failed.severity === "error" && OPS_EVENTS.routing_failed.alertAfter === 3);

  // "use server": die Menge der LAUFZEIT-Exporte darf sich nicht geändert haben.
  const exportsOf = (text: string) =>
    [...text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]).sort();
  const before = execFileSync("git", ["show", "HEAD:src/lib/tour-actions.ts"], { encoding: "utf8" });
  const now = readFileSync(new URL("../src/lib/tour-actions.ts", import.meta.url), "utf8");
  check("tour-actions.ts: Laufzeit-Exporte unverändert", stableStringify(exportsOf(before)) === stableStringify(exportsOf(now)),
    `vorher ${exportsOf(before).join(",")} / jetzt ${exportsOf(now).join(",")}`);
  check("tour-actions.ts: snapTourRoute(input) bleibt die Signatur", /export async function snapTourRoute\(input: SnapRouteInput\): Promise<SnapRouteResult>/.test(now));
  check("tour-actions.ts: kein Mapbox-Directions-Aufruf mehr", !/api\.mapbox\.com\/directions/.test(now));
  const usedUse = /^"use server";/.test(now);
  check("tour-actions.ts ist weiter eine use-server-Datei", usedUse);

  head("2. Auswahl des Dienstes (ROUTING_URL)");
  const env = { ...process.env };
  const restore = () => {
    for (const k of ["ROUTING_URL", "ROUTING_TOKEN", "NODE_ENV", "VERCEL_ENV"]) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
  };
  const tryProvider = (): string => {
    try {
      return getRoutingProvider().name;
    } catch (e) {
      return e instanceof RoutingError ? `error:${e.code}` : "other";
    }
  };
  delete process.env.ROUTING_URL;
  delete process.env.VERCEL_ENV;
  (process.env as Record<string, string>).NODE_ENV = "development";
  check("ohne ROUTING_URL, nicht in Produktion: Testadapter", tryProvider() === "local");
  (process.env as Record<string, string>).NODE_ENV = "production";
  check("ohne ROUTING_URL in Produktion: config-Fehler (keine erfundene Linie)", tryProvider() === "error:config");
  delete (process.env as Record<string, string | undefined>).NODE_ENV;
  process.env.VERCEL_ENV = "production";
  check("ohne ROUTING_URL auf Vercel-Production: config-Fehler", tryProvider() === "error:config");
  delete process.env.VERCEL_ENV;
  process.env.ROUTING_URL = "http://geo.example.com/routing";
  check("http:// zu fremdem Host: config-Fehler (Token nie im Klartext)", tryProvider() === "error:config");
  process.env.ROUTING_URL = "kein url";
  check("kaputte Adresse: config-Fehler", tryProvider() === "error:config");
  process.env.ROUTING_URL = "https://geo.example.com/routing";
  check("https:// : BRouter", tryProvider() === "brouter");
  process.env.ROUTING_URL = "http://127.0.0.1:17777";
  check("http:// auf dieser Maschine: BRouter", tryProvider() === "brouter");
  restore();

  head("3. Kette, Dauer, Stellen");
  const bike = detailOf({ mode: "bike", canSeePro: false });
  const stopsIn = bike.stops.map((s) => ({ id: s.spotSlug, coord: [s.lng!, s.lat!] as [number, number] }));
  const chain = buildTourChain({ start: START, end: START, stops: stopsIn, via: [], mode: "bike" });
  check("Kette: Start, 6 Stopps, Ziel (8 Punkte), ab Tour-Start", chain.points.length === 8 && chain.nodes[0].kind === "start" && chain.nodes[7].kind === "end");
  check("Kette: routeHash = tourRouteHash derselben Eingabe", chain.routeHash === tourRouteHash({ start: START, end: START, stops: stopsIn, via: [], mode: "bike" }));
  check("Kette: anderer Modus, anderer Hash", buildTourChain({ start: START, end: START, stops: stopsIn, via: [], mode: "walk" }).routeHash !== chain.routeHash);
  const d = dedupePoints([[1, 1], [1, 1], [2, 2], [2, 2], [3, 3]]);
  check("dedupePoints: Doppelte raus, Abbildung stimmt", d.points.length === 3 && stableStringify(d.indexOf) === "[0,0,1,1,2]");
  const al = alongForChain(chain.nodes, [0, 100, 200, 300, 400, 500, 600, 700], bike.stops.map((s) => s.spotSlug));
  check("alongForChain: Stelle je Stopp, Reihenfolge der Stopps", stableStringify(al.stopAlongM) === "[100,200,300,400,500,600]");
  check("Dauer: Rad 12 km/h, zu Fuss 4,5 km/h (Tempotabelle der Navigation)", FALLBACK_SPEED_MPS.bike === 3.3 && FALLBACK_SPEED_MPS.walk === 1.25);
  check("Dauer Rad: 6000 m = 30 Min + 1 Min je Stopp", travelMinutes(6000, "bike") === 30 && tourDurationMin(6000, "bike", 6) === 36);
  check("Dauer zu Fuss: 4500 m = 60 Min + 2 Min je Stopp", tourDurationMin(4500, "walk", 6) === 72);
  const bb = packageBbox([[13.04, 47.8], [13.05, 47.81]]);
  check("bbox: Puffer von rund 1 km rundum", bb.west < 13.04 - 0.009 && bb.east > 13.05 + 0.009 && bb.south < 47.8 - 0.008 && bb.north > 47.81 + 0.008);

  head("4. Paket: Gast gegen Pro (ohne Netz)");
  const stored = fakeStored(bike);
  const guestD = detailOf({ mode: "bike", canSeePro: false, token: "A" });
  const proD = detailOf({ mode: "bike", canSeePro: true, token: "A" });
  const pg = assemblePackage({ lang: "de", detail: guestD, stored, lineHash: "L" });
  const pp = assemblePackage({ lang: "de", detail: proD, stored, lineHash: "L" });
  check("Gast: tier public, Pro: tier pro", pg.tier === "public" && pp.tier === "pro");
  check("tour im Paket = Tour-Detail des Betrachters (unverändert)", stableStringify(pg.tour) === stableStringify(guestD) && stableStringify(pp.tour) === stableStringify(proD));
  check("Gast: gesperrte Stopps nur Kostprobe", pg.audio.filter((a) => a.kind === "sample").length === 4 && pg.audio.filter((a) => a.kind === "full").length === 2);
  check("Gast: jeder gesperrte Stopp hat genau eine Datei, und die ist eine Kostprobe", guestD.stops.every((s) => pg.audio.filter((a) => a.stopId === s.spotSlug).length === 1 && pg.audio.find((a) => a.stopId === s.spotSlug)!.kind === (s.locked ? "sample" : "full")));
  const guestText = JSON.stringify(pg);
  check("Gast: keine Volldatei eines gesperrten Stopps irgendwo im Manifest", ![2, 3, 4, 5].some((i) => guestText.includes(`FULL-p${i}`)));
  check("Gast: Texte gesperrter Stopps fehlen", ![2, 3, 4, 5].some((i) => guestText.includes(`Text ${i}`)));
  check("Pro: alle Stopps Vollfassung, keine Kostprobe", pp.audio.length === 6 && pp.audio.every((a) => a.kind === "full"));
  check("Pro-Manifest ohne TEASER-Dateien", !JSON.stringify(pp).includes("TEASER"));
  check("Attribution im Manifest", pg.attribution === OSM_ATTRIBUTION && pg.route?.source.attribution === OSM_ATTRIBUTION);
  check("Bilder: Titelbild + Stopp-Bilder, ohne Doppelte", pg.images.length === 7 && new Set(pg.images).size === 7);
  check("Route: Dauer = Formel (Länge, Modus, Stoppzahl)", pg.route?.durationMin === tourDurationMin(stored.lengthM, "bike", 6));

  head("5. contentHash");
  const again = assemblePackage({ lang: "de", detail: detailOf({ mode: "bike", canSeePro: false, token: "ZZZ" }), stored, lineHash: "L" });
  check("stabil: andere Link-Tokens, gleicher Hash", again.contentHash === pg.contentHash);
  check("Hash hängt nicht vom Berechnungszeitpunkt ab", assemblePackage({ lang: "de", detail: guestD, stored: { ...stored, source: { ...stored.source, computedAt: "2030-01-01T00:00:00Z" } }, lineHash: "L" }).contentHash === pg.contentHash);
  check("Pro hat einen anderen Hash als Gast", pp.contentHash !== pg.contentHash);
  check("andere Sprache, anderer Hash", assemblePackage({ lang: "en", detail: guestD, stored, lineHash: "L" }).contentHash !== pg.contentHash);
  check("andere Linie (lineHash), anderer Hash", assemblePackage({ lang: "de", detail: guestD, stored, lineHash: "M" }).contentHash !== pg.contentHash);
  const steps2 = stored.steps.map((s, i) => (i === 0 ? { ...s, modifier: "left" as const } : s));
  check("anderer Abbiegehinweis, anderer Hash", assemblePackage({ lang: "de", detail: guestD, stored: { ...stored, steps: steps2 }, lineHash: "L" }).contentHash !== pg.contentHash);
  const moved = detailOf({ mode: "bike", canSeePro: false, token: "A", coords: COORDS.map((c, i) => (i === 3 ? ([c[0] + 0.001, c[1]] as [number, number]) : c)) });
  check("Stopp verschoben, anderer Hash", assemblePackage({ lang: "de", detail: moved, stored, lineHash: "L" }).contentHash !== pg.contentHash);
  const newAudio = detailOf({ mode: "bike", canSeePro: false, token: "A" });
  newAudio.stops[0] = { ...newAudio.stops[0], audioUrl: "https://proj.supabase.co/storage/v1/object/sign/tour-audio/FULL-NEU.mp3?token=A" };
  check("neue Audiodatei, anderer Hash", assemblePackage({ lang: "de", detail: newAudio, stored, lineHash: "L" }).contentHash !== pg.contentHash);
  check("contentHashOf: Token-Teil taucht im Hash-Eingang nicht auf", !stableStringify({ u: "x" }).includes("token") && contentHashOf({ lang: "de", detail: guestD, route: pg.route, images: pg.images, audio: pg.audio }) === pg.contentHash);

  head("6. Umrouten: Kette und Prüfungen (ohne Netz)");
  const guestWalk = detailOf({ mode: "walk", canSeePro: false });
  const allowed = new Set<string>([
    ...guestWalk.stops.map((s) => `${s.lng},${s.lat}`),
    `${START.lng},${START.lat}`,
  ]);
  const from: [number, number] = [13.0436, 47.8022];
  const p = planReroute(guestWalk, { from });
  check("Plan: Position, dann alle Stopps, dann Ziel", p.ok && p.plan.points.length === 8 && p.plan.points[0][0] === from[0]);
  const tooFar = planReroute(guestWalk, { from: [13.5, 47.4] });
  check("Position zu weit weg: eigener Grund too-far, nicht invalid", !tooFar.ok && tooFar.reason === "too-far" && !planReroute(guestWalk, { from, keep: [] }).ok && (planReroute(guestWalk, { from, keep: [] }) as { reason?: string }).reason === "invalid");
  check("Eigene Runde: meine-<uuid> wird erkannt, Rest nicht", myTourIdOf("meine-123e4567-e89b-42d3-a456-426614174000") === "123e4567-e89b-42d3-a456-426614174000" && myTourIdOf("meine-xyz") === null && myTourIdOf("meine-") === null && myTourIdOf("antons-hausrunde") === null);
  check("Plan Gast: jeder Punkt stammt aus dem Tour-Detail des Gastes (oder ist seine Position)", p.ok && p.plan.points.slice(1).every((c) => allowed.has(`${c[0]},${c[1]}`)));
  const lockedIdx = guestWalk.stops.findIndex((s) => s.locked);
  check("Fixture: Gast hat gesperrte Stopps", lockedIdx >= 0);
  const p2 = planReroute(guestWalk, { from, keep: [3, 5] });
  check("Plan mit keep [3,5]: Position, Stopp 3, Stopp 5, Ziel", p2.ok && p2.plan.points.length === 4 && p2.plan.keep.join() === "3,5");
  const viaLegs: ViaLeg[] = [{ from: "p2", to: "p3", coords: [[13.048, 47.7988]] }];
  const p3 = planReroute(detailOf({ mode: "walk", canSeePro: false, via: viaLegs }), { from, keep: [3, 4, 5] });
  check("Wegpunkt zwischen den Stopps 2 und 3 fällt weg, wenn Stopp 2 erledigt ist", p3.ok && p3.plan.points.length === 5);
  const p4 = planReroute(detailOf({ mode: "walk", canSeePro: false, via: viaLegs }), { from, keep: [2, 3, 4, 5] });
  check("Wegpunkt zwischen offenen Stopps 2 und 3 geht mit", p4.ok && p4.plan.points.length === 7 && p4.plan.kinds.some((k) => k.kind === "via"));
  check("keep leer: invalid", !planReroute(guestWalk, { from, keep: [] }).ok);
  check("keep unbekannter Index: invalid", !planReroute(guestWalk, { from, keep: [0, 99] }).ok);
  check("keep nicht aufsteigend: invalid", !planReroute(guestWalk, { from, keep: [3, 2] }).ok);
  check("keep doppelt: invalid", !planReroute(guestWalk, { from, keep: [2, 2] }).ok);
  check("keep zu viele Einträge: invalid", !planReroute(guestWalk, { from, keep: Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, i) => i) }).ok);
  check("Position 50 km weg: invalid (kein freier Routendienst)", !planReroute(guestWalk, { from: [13.5, 47.4] }).ok);
  check("Position 3 km von den Stopps: gilt noch", planReroute(guestWalk, { from: [13.0433, 47.8289] }).ok);
  const withLine = detailOf({ mode: "walk", canSeePro: false });
  withLine.routeGeo = [[13.0433, 47.8019], [13.0475, 47.8035]];
  check("mit Linie: 6 km neben der Linie = invalid", !planReroute(withLine, { from: [13.0433, 47.8559] }).ok);
  check("mit Linie: 1 km neben der Linie = gültig", planReroute(withLine, { from: [13.0433, 47.8109] }).ok);
  const noCoord = detailOf({ mode: "walk", canSeePro: false });
  noCoord.stops[1] = { ...noCoord.stops[1], lat: null, lng: null };
  const p5 = planReroute(noCoord, { from, keep: [0, 2] });
  check("Stopp ohne Punkt: nicht anwählbar (keep 1 invalid), die anderen gehen", !planReroute(noCoord, { from, keep: [0, 1] }).ok && p5.ok);

  head("7. Quelltext: keine Koordinaten im Log");
  const scan = (name: string, text: string) => {
    const calls = [...text.matchAll(/logOps\([\s\S]*?\n\s*\}\);/g)].map((m) => m[0]);
    check(`${name}: ${calls.length} logOps-Aufruf(e), keiner trägt Koordinaten`, calls.every((c) => !/\b(lng|lat|coord|from|geometry)\b/.test(c.replace(/points: input\.points\.length/g, ""))));
  };
  scan("routing/run.ts", src("routing/run.ts"));
  scan("tour-nav-route.ts", src("tour-nav-route.ts"));
  const routeFile = readFileSync(new URL("../src/app/api/app/v1/route/route.ts", import.meta.url), "utf8");
  check("Umroute-Route: kein logOps, kein console.* (Fehler gehen über appFailure ohne Body)", !/logOps|console\./.test(routeFile));
  check("Umroute-Route schreibt nichts (kein insert/upsert/update/delete/rpc ausser Limit)", !/\.(insert|upsert|update|delete)\(/.test(routeFile + src("tour-reroute.ts")));

  head("7b. Web-Navigation ohne Mapbox, Texte in 13 Sprachen");
  const bd = src("bike-directions.ts");
  check("bike-directions.ts ruft kein Mapbox Directions mehr auf", !/api\.mapbox\.com|MAPBOX/.test(bd.replace(/\/\/[^\n]*/g, "")));
  check("Fahrbildschirm fragt die eigene Route (/api/tours/[slug]/route)", /\/api\/tours\/\$\{encodeURIComponent\(input\.slug\)\}\/route/.test(bd));
  const webRoute = readFileSync(new URL("../src/app/api/tours/[slug]/route/route.ts", import.meta.url), "utf8");
  check("Web-Route lädt nur die Kette (kein getTourDetail) und kennt eigene Runden", /loadCuratedChain/.test(webRoute) && /loadMyChain/.test(webRoute) && !/getTourDetail/.test(webRoute));
  check("Web-Route prüft die Herkunft und begrenzt", /foreignOrigin\(req\)/.test(webRoute) && /appUserRateLimit/.test(webRoute) && !/logOps\([^)]*(from|lng|lat)/.test(webRoute));
  const langs = ["de", "en", "it", "nl", "ko", "fr", "zh", "es", "pt", "pl", "cs", "hu", "sk"];
  for (const l of langs) {
    const m = JSON.parse(readFileSync(new URL(`../messages/${l}.json`, import.meta.url), "utf8")).Tours.maneuver as Record<string, string>;
    const texts = MANEUVER_KEYS.map((k) => m[k]);
    check(`${l}: alle ${MANEUVER_KEYS.length} Anweisungen ohne Strassennamen, Kreisverkehr mit {exit}`,
      texts.every((t) => typeof t === "string" && t.trim().length > 0 && !/undefined|\{street\}|\{name\}|""/.test(t) && !t.includes("\u2014")) && m.roundabout.includes("{exit}") && new Set(texts).size === texts.length);
  }
  check("Schritt -> Schlüssel: Gabel halten, Kehre, Kreisverkehr mit Ausfahrt, Ziel",
    maneuverKey({ type: "fork", modifier: "slight left" }).key === "keepLeft" &&
      maneuverKey({ type: "continue", modifier: "uturn" }).key === "uturn" &&
      maneuverKey({ type: "roundabout", modifier: "right", exit: 2 }).values?.exit === 2 &&
      maneuverKey({ type: "roundabout" }).values?.exit === 1 &&
      maneuverKey({ type: "arrive" }).key === "arrive" &&
      maneuverKey({ type: "turn", modifier: "sharp right" }).key === "sharpRight");
  check("Abfahrt (EL/ER): Seite aus dem Befehl, nicht aus dem Vorzeichen", maneuverFromHint(17, 25, 0)?.modifier === "slight left" && maneuverFromHint(18, -25, 0)?.modifier === "slight right");

  head("7c. Antwortcodes des Routendienstes (Attrappe)");
  const statusOf = async (status: number, body: string) => {
    const saved = globalThis.fetch;
    let init: RequestInit | undefined;
    globalThis.fetch = (async (_u: unknown, i?: RequestInit) => ((init = i), new Response(body, { status }))) as typeof fetch;
    try {
      await new BrouterProvider("http://127.0.0.1:17777").route({ points: [[13.04, 47.8], [13.05, 47.81]], mode: "bike" });
      return { code: "ok", init };
    } catch (e) {
      return { code: e instanceof RoutingError ? e.code : "other", init };
    } finally {
      globalThis.fetch = saved;
    }
  };
  check("400 -> no-route", (await statusOf(400, "no track found")).code === "no-route");
  check("400 'datafile ... not found' (Wegdatei fehlt auf dem Server) -> bad-response, NICHT kein Weg", (await statusOf(400, "datafile E10_N45.rd5 not found")).code === "bad-response");
  check("400 'profile ... not found' -> bad-response", (await statusOf(400, "profile hiking-mountain.brf not found")).code === "bad-response");
  check("400 'to-position not mapped in existing datafile' -> kein Weg (Eingabe)", (await statusOf(400, "to-position not mapped in existing datafile")).code === "no-route");
  check("400 'operation killed by timeout' -> timeout", (await statusOf(400, "operation killed by timeout")).code === "timeout");
  check("404 (falscher Pfad) -> bad-response, wird gemeldet", (await statusOf(404, "nope")).code === "bad-response");
  check("405 -> bad-response", (await statusOf(405, "")).code === "bad-response");
  check("429 -> bad-response", (await statusOf(429, "")).code === "bad-response");
  check("401 -> auth", (await statusOf(401, "")).code === "auth");
  check("500 ohne Hinweis -> unreachable", (await statusOf(500, "boom")).code === "unreachable");
  check("500 mit 'position not mapped' -> no-route", (await statusOf(500, "position not mapped")).code === "no-route");
  check("Weiterleitungen werden nicht verfolgt (redirect: error)", (await statusOf(200, "{}")).init?.redirect === "error");
  const hang = async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = (async () => ({ status: 200, text: () => new Promise((_r, rej) => setTimeout(() => rej(new Error("body hängt")), 20)) }) as unknown as Response) as typeof fetch;
    try {
      await new BrouterProvider("http://127.0.0.1:17777").route({ points: [[13.04, 47.8], [13.05, 47.81]], mode: "bike" });
      return "ok";
    } catch (e) {
      return e instanceof RoutingError ? e.code : "roh";
    } finally {
      globalThis.fetch = saved;
    }
  };
  check("Rumpf liest nicht zu Ende: RoutingError statt roher Ausnahme", (await hang()) === "unreachable");

  head("7d. Testadapter im Editor");
  {
    const sbL = { from: () => ({ select: () => ({ in: async (_c: string, ids: string[]) => ({ data: ids.map((id, i) => ({ id, lat: COORDS[i][1], lng: COORDS[i][0] })), error: null }) }) }) } as unknown as SupabaseClient;
    delete process.env.ROUTING_URL;
    delete process.env.ROUTING_ALLOW_TEST_ADAPTER;
    const noAllow = await snapTourRouteCore(sbL, { start: null, end: null, pointIds: ["a", "b", "c"], mode: "walk" });
    check("Testadapter im Editor: abgelehnt mit klarer Meldung", !noAllow.ok && /Routendienst nicht eingerichtet: ROUTING_URL setzen/.test(noAllow.error ?? "") && !noAllow.routeGeo);
    process.env.ROUTING_ALLOW_TEST_ADAPTER = "1";
    const allow = await snapTourRouteCore(sbL, { start: null, end: null, pointIds: ["a", "b", "c"], mode: "walk" });
    check("mit ROUTING_ALLOW_TEST_ADAPTER=1 erlaubt (nie in Produktion)", allow.ok === true);
    delete process.env.ROUTING_ALLOW_TEST_ADAPTER;
  }

  head("8. Speicher tour_nav_routes: Attrappen-Client");
  await partFakeSupabase(stored);

  head("9. Fehler ohne Dienst");
  process.env.ROUTING_URL = "http://127.0.0.1:1"; // nichts hört zu
  const { result: down, out } = await captureConsole(() => runChain({ points: [[13.0433, 47.8019], [13.0475, 47.8035]], mode: "bike", purpose: "reroute" }));
  check("Dienst nicht erreichbar: Code unreachable", !down.ok && down.code === "unreachable");
  check("Konsole der Meldung enthält keine Koordinate", !/47\.8|13\.04/.test(out), out.slice(0, 200));
  const { result: far } = await captureConsole(() => runChain({ points: [[13.0433, 47.8019], [14.5, 48.5]], mode: "bike", purpose: "package" }));
  check("Punkte 100 km auseinander: invalid mit festem Satz", !far.ok && far.code === "invalid" && typeof far.message === "string" && !/\d{2}\.\d/.test(far.message));
  const { result: many } = await captureConsole(() => runChain({ points: Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, i) => [13.04 + i * 0.0001, 47.8] as [number, number]), mode: "bike", purpose: "package" }));
  check("mehr als 25 Punkte: invalid, ohne dass etwas rausgeht", !many.ok && many.code === "invalid");
  const { result: none } = await captureConsole(() => runChain({ points: [[13.04, 47.8]], mode: "bike", purpose: "package" }));
  check("ein Punkt: invalid", !none.ok && none.code === "invalid");
  delete process.env.ROUTING_URL;
  (process.env as Record<string, string>).NODE_ENV = "production";
  const { result: cfg } = await captureConsole(() => runChain({ points: [[13.0433, 47.8019], [13.0475, 47.8035]], mode: "bike", purpose: "package" }));
  check("Produktion ohne ROUTING_URL: config, keine Linie", !cfg.ok && cfg.code === "config");
  delete (process.env as Record<string, string | undefined>).NODE_ENV;
  restore();
}

/** Eine gespeicherte Route, wie sie aus dem Dienst käme (nur Form, kein echter Weg). */
function fakeStored(detail: TourDetail): StoredNavRoute {
  return {
    routeHash: "h1",
    profile: BROUTER_PROFILE[detail.mode],
    source: { provider: "brouter", profile: BROUTER_PROFILE[detail.mode], engine: "BRouter-1.7.10", data: "OpenStreetMap (ODbL)", attribution: OSM_ATTRIBUTION, computedAt: "2026-10-23T10:00:00Z" },
    geometry: [[13.04, 47.8], [13.05, 47.81], [13.06, 47.8]],
    steps: [
      { index: 1, alongM: 1300, type: "turn", modifier: "right", bearingBefore: 40, bearingAfter: 130, distanceM: 1200, },
      { index: 2, alongM: 2500, type: "arrive", bearingBefore: 130, bearingAfter: 130, distanceM: 0 },
    ],
    viaAlong: { stopAlongM: detail.stops.map((_, i) => i * 400), viaAlongM: {} },
    lengthM: 2500,
  };
}

// Ein Client, der nur die Aufrufe kennt, die supabaseNavRouteStore macht, und sie aufzeichnet.
async function partFakeSupabase(stored: StoredNavRoute): Promise<void> {
  const calls: string[] = [];
  let missing = false;
  let row: Record<string, unknown> | null = null;
  const chain = (table: string, op: string, payload?: unknown) => {
    const filters: string[] = [];
    const q: Record<string, unknown> = {};
    const done = async () => {
      calls.push(`${op} ${table} ${filters.join(" ")}${op === "upsert" ? ` ${JSON.stringify((payload as Record<string, unknown>).lang)}|${JSON.stringify((payload as Record<string, unknown>).tour_id)}` : ""}`);
      if (missing) return { data: null, error: { code: "PGRST205", message: "no table" } };
      if (op === "upsert") {
        row = payload as Record<string, unknown>;
        return { data: null, error: null };
      }
      return { data: op === "select" ? row : null, error: null };
    };
    for (const f of ["eq", "neq"]) q[f] = (col: string, v: unknown) => (filters.push(`${f}:${col}=${String(v)}`), q);
    q.select = () => q;
    q.maybeSingle = done;
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => done().then(res, rej);
    return q;
  };
  const sb = {
    from: (table: string) => ({
      select: () => chain(table, "select"),
      upsert: (payload: unknown, opts: { onConflict: string }) => (calls.push(`onConflict ${opts.onConflict}`), chain(table, "upsert", payload)),
      delete: () => chain(table, "delete"),
    }),
  } as unknown as SupabaseClient;
  const store = supabaseNavRouteStore(sb);
  check("Store: leer, wenn nichts da ist", (await store.get("T1", "h1")) === null);
  await store.put("T1", stored);
  check("Store: Schlüssel (tour_id, lang, route_hash) beim Ablegen", calls.includes("onConflict tour_id,lang,route_hash"));
  check("Store: lang ist 'und' (Schritte tragen keinen Text)", calls.some((c) => c.startsWith("upsert tour_nav_routes") && c.includes('"und"|"T1"')));
  check("Store: ältere Fassungen derselben Runde werden entfernt (neq route_hash)", calls.some((c) => c.startsWith("delete tour_nav_routes") && c.includes("eq:tour_id=T1") && c.includes("neq:route_hash=h1")));
  const back = await store.get("T1", "h1");
  check("Store: lesen liefert die abgelegte Zeile in unserer Form", back?.routeHash === "h1" && back.steps.length === 2 && back.lengthM === 2500);
  row = { ...(row as unknown as object), source: { ...stored.source, provider: "local" } };
  check("Store: eine Zeile des Testadapters gilt nie", (await store.get("T1", "h1")) === null);
  missing = true;
  check("Store: Tabelle fehlt (vor 0076): leer statt Absturz", (await store.get("T1", "h1")) === null);
  let threw = false;
  try {
    await store.put("T1", stored);
  } catch {
    threw = true;
  }
  check("Store: Tabelle fehlt: Ablegen wirft nicht", !threw);
}

// ═════════════════════════════════════════════════════════════════════════════════════
// 2. Mit dem echten Routendienst (lokaler BRouter)
// ═════════════════════════════════════════════════════════════════════════════════════
async function partBrouter(): Promise<void> {
  process.env.ROUTING_URL = BROUTER;
  delete process.env.ROUTING_TOKEN;

  head("10. snapTourRoute-Kern gegen den lokalen BRouter");
  for (const mode of ["bike", "walk"] as const) {
    const ids = COORDS.map((_, i) => `p${i}`);
    const sb = {
      from: () => ({
        select: () => ({
          in: async (_col: string, want: string[]) => ({
            data: want.map((id) => ({ id, lat: COORDS[Number(id.slice(1))][1], lng: COORDS[Number(id.slice(1))][0] })),
            error: null,
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    brouterRequests = 0;
    const r = await snapTourRouteCore(sb, { start: START, end: START, pointIds: ids, mode, via: [] });
    check(`${mode}: ok mit Linie`, r.ok && (r.routeGeo?.length ?? 0) > 50, r.error);
    check(`${mode}: genau eine Anfrage an den Dienst`, brouterRequests === 1, `${brouterRequests}`);
    const stops = ids.map((id, i) => ({ id, coord: COORDS[i] }));
    check(`${mode}: routeHash = tourRouteHash der Kette (wie bisher gespeichert)`, r.routeHash === tourRouteHash({ start: START, end: START, stops, mode, via: [] }));
    check(`${mode}: Länge und Dauer folgen der Formel`, Math.abs((r.durationMin ?? -99) - tourDurationMin((r.distanceKm ?? 0) * 1000, mode, 6)) <= 1, `${r.distanceKm} km, ${r.durationMin} min`);
    check(`${mode}: Felder wie bisher (ok, routeGeo, routeHash, distanceKm, durationMin, via)`, ["ok", "routeGeo", "routeHash", "distanceKm", "durationMin", "via"].every((k) => k in r));
    check(`${mode}: Hinweise und OSM-Zeile für den Admin`, Array.isArray(r.warnings) && r.attribution === OSM_ATTRIBUTION);
    check(`${mode}: Hinweise nennen Stationen ("Stopp 3", "Wegpunkt", "Start", "Ziel"), keine Kettenpositionen`, (r.warnings ?? []).every((w) => /^(Stopp \d+|Wegpunkt \d+|Start|Ziel)\b|bei (Stopp \d+|Wegpunkt \d+|Start|Ziel)/.test(w) && !/Punkt \d/.test(w)), (r.warnings ?? []).join(" | "));
    info(`${mode}: ${r.distanceKm} km, ${r.durationMin} Min, ${r.routeGeo?.length} Punkte, ${r.warnings?.length ?? 0} Hinweis(e)`);
    for (const w of r.warnings ?? []) info(`   Hinweis: ${w}`);
  }
  // Fehlerwege wie bisher
  const none = await snapTourRouteCore({} as SupabaseClient, { start: null, end: null, pointIds: [] });
  check("keine Stationen: dieselbe Meldung wie bisher", !none.ok && none.error === "Bitte zuerst Stationen zur Runde hinzufügen.");
  const sbMissing = { from: () => ({ select: () => ({ in: async () => ({ data: [{ id: "x", lat: null, lng: null }], error: null }) }) }) } as unknown as SupabaseClient;
  const noPt = await snapTourRouteCore(sbMissing, { start: null, end: null, pointIds: ["x"] });
  check("Station ohne Punkt: dieselbe Meldung wie bisher", !noPt.ok && noPt.error === "Mindestens eine Station hat noch keinen Punkt auf der Karte.");
  const sbBig = { from: () => ({ select: () => ({ in: async (_c: string, ids: string[]) => ({ data: ids.map((id, i) => ({ id, lat: 47.8, lng: 13.04 + i * 0.0003 })), error: null }) }) }) } as unknown as SupabaseClient;
  const many = await snapTourRouteCore(sbBig, { start: null, end: null, pointIds: Array.from({ length: 26 }, (_, i) => `q${i}`), mode: "walk" });
  check("26 Punkte: dieselbe Meldung wie bisher", !many.ok && /Zu viele Punkte für die Routenberechnung \(26, erlaubt sind 25/.test(many.error ?? ""));
  const one = await snapTourRouteCore(sbBig, { start: null, end: null, pointIds: ["q0"], mode: "walk" });
  check("eine Station ohne Start/Ziel: dieselbe Meldung wie bisher", !one.ok && one.error === "Für eine Route braucht es mindestens zwei Punkte.");
  process.env.ROUTING_URL = "http://127.0.0.1:1";
  const sbOk = { from: () => ({ select: () => ({ in: async (_c: string, ids: string[]) => ({ data: ids.map((id, i) => ({ id, lat: COORDS[i][1], lng: COORDS[i][0] })), error: null }) }) }) } as unknown as SupabaseClient;
  const downR = await captureConsole(() => snapTourRouteCore(sbOk, { start: null, end: null, pointIds: ["a", "b"], mode: "walk" }));
  check("Dienst aus: Admin liest 'nicht erreichbar'", !downR.result.ok && /nicht erreichbar/.test(downR.result.error ?? ""));
  process.env.ROUTING_URL = BROUTER;

  head("11. Paket: Zwischenspeichern und Hash (echte Linie, Speicher im Arbeitsspeicher)");
  const mem = memoryStore();
  const detail = detailOf({ mode: "bike", canSeePro: false, token: "A" });
  brouterRequests = 0;
  const first = await getTourNavRoute({ detail, tourId: "T-1", store: mem.store });
  check("erster Abruf: gerechnet, genau eine Anfrage, abgelegt", first.ok && !first.fromCache && brouterRequests === 1 && mem.calls.put === 1, `${brouterRequests} Anfragen`);
  brouterRequests = 0;
  const second = await getTourNavRoute({ detail: detailOf({ mode: "bike", canSeePro: true, token: "B" }), tourId: "T-1", store: mem.store });
  check("zweiter Abruf (auch als Pro, anderer Link-Token): aus dem Speicher, KEINE Anfrage an den Dienst", second.ok && second.fromCache && brouterRequests === 0, `${brouterRequests} Anfragen`);
  check("zweiter Abruf liefert dieselbe Linie", first.ok && second.ok && first.lineHash === second.lineHash);
  if (first.ok) {
    const s = first.stored;
    check("Route ab Tour-Start: 8 Kettenpunkte -> 6 Stopp-Stellen, aufsteigend", s.viaAlong.stopAlongM.length === 6 && s.viaAlong.stopAlongM.every((v, i, a) => v != null && (i === 0 || v >= (a[i - 1] as number))));
    check("Schritte enden mit arrive bei der Länge der Linie", s.steps.at(-1)?.type === "arrive" && Math.abs(s.steps.at(-1)!.alongM - s.lengthM) < 2);
    check("Profil Rad = trekking", s.profile === "trekking" && s.source.provider === "brouter" && s.source.attribution === OSM_ATTRIBUTION);
    check("Schritte sind sprachneutral (kein Text im Datensatz)", !s.steps.some((st) => "instruction" in st));
    check("gespeichert wird kein Rohformat des Dienstes", !JSON.stringify(s).match(/voicehints|messages|"cost"|"times"/));
    const nav = toNavSteps(s.steps, (st) => st.type);
    check("Schritte laufen durch toNavSteps/prepareSteps", nav.length > 0 && nav.length <= s.steps.length);
    info(`Rad-Runde: ${(s.lengthM / 1000).toFixed(2)} km, ${s.steps.length} Schritte, ${nav.length} Ansagen, ${s.geometry.length} Punkte`);
  }
  const pk1 = first.ok ? assemblePackage({ lang: "de", detail, stored: first.stored, lineHash: first.lineHash }) : null;
  const pk2 = second.ok ? assemblePackage({ lang: "de", detail: detailOf({ mode: "bike", canSeePro: false, token: "C" }), stored: second.stored, lineHash: second.lineHash }) : null;
  check("contentHash gleich bei zwei Abrufen (echte Route)", !!pk1 && !!pk2 && pk1.contentHash === pk2.contentHash);
  check("bbox umschliesst Linie und Stopps", !!pk1 && pk1.route!.geometry.every(([x, y]) => x >= pk1.bbox.west && x <= pk1.bbox.east && y >= pk1.bbox.south && y <= pk1.bbox.north));

  // Runde ändert sich -> neue Route, neuer Hash, alte Zeile weg
  const movedD = detailOf({ mode: "bike", canSeePro: false, token: "A", coords: COORDS.map((c, i) => (i === 2 ? ([13.0522, 47.7996] as [number, number]) : c)) });
  brouterRequests = 0;
  const third = await getTourNavRoute({ detail: movedD, tourId: "T-1", store: mem.store });
  check("Stopp verschoben: route_hash neu, wird neu gerechnet (1 Anfrage), alte Zeile entfernt", third.ok && !third.fromCache && brouterRequests === 1 && mem.rows.size === 1);
  const pk3 = third.ok ? assemblePackage({ lang: "de", detail: movedD, stored: third.stored, lineHash: third.lineHash }) : null;
  check("contentHash ändert sich, wenn sich die Route ändert", !!pk1 && !!pk3 && pk1.contentHash !== pk3.contentHash);
  const walkD = detailOf({ mode: "walk", canSeePro: false });
  const w = await getTourNavRoute({ detail: walkD, tourId: "T-2", store: mem.store });
  check("Fussrunde: Profil hiking-mountain", w.ok && w.stored.profile === "hiking-mountain");
  const guard = await getTourNavRoute({ detail: { ...detailOf({ mode: "bike", canSeePro: false }), stops: [], start: null, end: null }, tourId: "T-3", store: mem.store });
  check("Runde ohne Punkte: keine Kette, kein Aufruf", !guard.ok && guard.reason === "no-chain");
  // Testadapter wird nie abgelegt
  delete process.env.ROUTING_URL;
  const mem2 = memoryStore();
  const loc = await getTourNavRoute({ detail, tourId: "T-9", store: mem2.store });
  check("Testadapter: Route ja, abgelegt nie", loc.ok && loc.stored.source.provider === "local" && mem2.calls.put === 0);
  process.env.ROUTING_URL = BROUTER;

  head("12. Umrouten gegen den lokalen BRouter");
  const guestW = detailOf({ mode: "walk", canSeePro: false });
  const near = COORDS[0];
  const from: [number, number] = [near[0] + 0.0003, near[1] + 0.0002];
  const plan = planReroute(guestW, { from, keep: [1, 2, 3, 4, 5] });
  if (!plan.ok) return void check("Plan", false);
  brouterRequests = 0;
  const rr = await rerouteTour(guestW, plan.plan);
  check("Umrouten: ok, genau eine Anfrage", rr.ok && brouterRequests === 1, rr.ok ? "" : rr.code);
  if (rr.ok) {
    const a = rr.route;
    check("Linie beginnt an der Position des Gastes (unter 60 m)", Math.hypot((a.geometry[0][0] - from[0]) * 76000, (a.geometry[0][1] - from[1]) * 111000) < 60);
    check("keep im Echo, damit die App stopAlongM zuordnen kann", a.keep.join() === "1,2,3,4,5");
    check("stopAlongM: ein Eintrag je keep, aufsteigend", a.stopAlongM.length === 5 && a.stopAlongM.every((v, i, arr) => v != null && (i === 0 || v >= (arr[i - 1] as number))));
    check("Schritte enden mit arrive", a.steps.at(-1)?.type === "arrive");
    check("Profil zu Fuss, Attribution gesetzt, Dauer = Formel", a.profile === "hiking-mountain" && a.attribution === OSM_ATTRIBUTION && a.durationMin === travelMinutes(a.distanceM, "walk"));
    info(`Umrouten: ${(a.distanceM / 1000).toFixed(2)} km, ${a.steps.length} Schritte`);
  }
  // Gast gegen Pro: gleiche Eingabe, gleiche Linie (Positionen sind öffentliche Teaser)
  const proW = detailOf({ mode: "walk", canSeePro: true });
  const planPro = planReroute(proW, { from, keep: [1, 2, 3, 4, 5] });
  check("Gast und Pro bekommen dieselbe Kette (Stopp-Positionen sind bei Touren öffentlich)", planPro.ok && stableStringify(planPro.plan.points) === stableStringify(plan.plan.points));
  const bikeD = detailOf({ mode: "bike", canSeePro: false });
  const pb = planReroute(bikeD, { from });
  const rb = pb.ok ? await rerouteTour(bikeD, pb.plan) : null;
  check("Rad: Profil trekking", !!rb && rb.ok && rb.route.profile === "trekking");
  // Position mitten im Wald / ausserhalb der Wegdaten
  const off = planReroute(guestW, { from: [20.5, 47.8], keep: [1] });
  check("Position ausserhalb jeder Runde: schon im Plan invalid", !off.ok);
}

// ═════════════════════════════════════════════════════════════════════════════════════
// 3. Echte Routen gegen einen laufenden Server
// ═════════════════════════════════════════════════════════════════════════════════════
type Loose = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let tempUser: TempUser | null = null;
let deleted: boolean | null = null;

function lines(file: string | null): number {
  if (!file) return -1;
  try {
    return readFileSync(file, "utf8").split("\n").length;
  } catch {
    return -1;
  }
}

async function http(method: "GET" | "POST", url: string, auth: string | null, body?: unknown, raw?: { text: string; type: string | null }) {
  const h: Record<string, string> = { Accept: "application/json" };
  if (auth) h.Authorization = auth;
  let payload: string | undefined;
  if (raw) {
    payload = raw.text;
    if (raw.type) h["Content-Type"] = raw.type;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h["Content-Type"] = "application/json";
  }
  const r = await realFetch(url, { method, headers: h, body: payload, redirect: "manual", signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  let json: Loose = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* kein JSON */
  }
  return { status: r.status, headers: r.headers, text, json };
}

const stripTokens = (o: unknown): unknown => JSON.parse(JSON.stringify(o).replace(/\?token=[A-Za-z0-9._-]+/g, ""));

async function partHttp(base: string, brouterLog: string | null, serverLog: string | null): Promise<void> {
  const API = `${base.replace(/\/+$/, "")}/api/app/v1`;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  head("13. Server: Erreichbarkeit und Wahrheit aus der Datenbank");
  const boot = await http("GET", `${API}/bootstrap?lang=de`, null);
  if (!check("Server erreichbar (/bootstrap 200)", boot.status === 200, `Status ${boot.status}`)) return;
  info(`liegengebliebene Wegwerf-Konten geloescht: ${await sweepTempUsers()}`);
  const { data: tours } = await db.from("tours").select("slug, is_pro, free_stops, mode").eq("status", "published").order("slug");
  const list = (tours ?? []) as Loose[];
  const proTour = list.find((t) => t.is_pro && t.free_stops < 5) ?? list.find((t) => t.is_pro);
  info(`veroeffentlichte Touren: ${list.length}, Pro-Tour: ${proTour ? `ja (free_stops ${proTour.free_stops}, ${proTour.mode})` : "nein"}`);
  if (!check("Pro-Tour für die Prüfung vorhanden", !!proTour)) return;
  const slug = proTour.slug as string;

  tempUser = await createTempUser();
  await setProfile(tempUser.id, { is_pro: false, role: "user" });
  const token = tempUser.session.access_token;
  const user = `Bearer ${token}`;

  head("14. Paket als Gast");
  const t0 = Date.now();
  const g1 = await http("GET", `${API}/tours/${slug}/package?lang=de`, null);
  check("200", g1.status === 200, `Status ${g1.status} ${g1.text.slice(0, 120)}`);
  if (g1.status !== 200) return;
  info(`Antwortzeit ${Date.now() - t0} ms`);
  const gp = g1.json;
  const cache = (g1.headers.get("cache-control") ?? "").toLowerCase();
  check("Cache-Control private + no-store", cache.includes("private") && cache.includes("no-store"), cache);
  check("tier public, Attribution, Route vorhanden", gp.tier === "public" && gp.attribution === OSM_ATTRIBUTION && !!gp.route);
  check("Route: Profil nach Modus, Schritte enden mit arrive", gp.route.profile === BROUTER_PROFILE[proTour.mode as TourMode] && gp.route.steps.at(-1)?.type === "arrive");
  const gTour = await http("GET", `${API}/tours/${slug}?lang=de`, null);
  check("tour im Paket = GET /tours/{slug} (ohne Link-Tokens)", stableStringify(stripTokens(gp.tour)) === stableStringify(stripTokens(gTour.json.tour)));
  const g2 = await http("GET", `${API}/tours/${slug}/package?lang=de`, null);
  check("contentHash gleich bei zwei Abrufen", g2.json?.contentHash === gp.contentHash);

  const pTourFull = await (async () => {
    await setProfile(tempUser!.id, { is_pro: true });
    return http("GET", `${API}/tours/${slug}?lang=de`, user);
  })();
  const fullPaths = new Set<string>();
  for (const s of (pTourFull.json.tour.stops as Loose[])) if (s.audioUrl) fullPaths.add(String(s.audioUrl).split("?")[0].split("/tour-audio/")[1]);
  const lockedForGuest = (gp.tour.stops as Loose[]).filter((s) => s.locked);
  info(`gesperrte Stopps für den Gast: ${lockedForGuest.length} von ${gp.tour.stops.length}`);
  check("Gast: gesperrte Stopps vorhanden (sonst beweist die Prüfung nichts)", lockedForGuest.length > 0);
  const gAudio = gp.audio as Loose[];
  check("Gast: jeder gesperrte Stopp nur Kostprobe, jeder freie Vollfassung", (gp.tour.stops as Loose[]).every((s) => {
    const mine = gAudio.filter((a) => a.stopId === s.spotSlug);
    return mine.length <= 1 && mine.every((a) => a.kind === (s.locked ? "sample" : "full"));
  }));
  const guestPaths = [...fullPaths].filter((p) => lockedForGuest.some((s) => String(pTourFull.json.tour.stops.find((x: Loose) => x.spotSlug === s.spotSlug)?.audioUrl ?? "").includes(p)));
  check("Gast: KEINE Volldatei eines gesperrten Stopps irgendwo im Paket", guestPaths.length > 0 && guestPaths.every((p) => !g1.text.includes(p)), `${guestPaths.length} geprüft`);
  check("Gast: Texte gesperrter Stopps sind null", lockedForGuest.every((s: Loose) => s.audioText === null && s.audioUrl === null));

  head("15. Paket als Pro");
  const p1 = await http("GET", `${API}/tours/${slug}/package?lang=de`, user);
  check("200, tier pro", p1.status === 200 && p1.json?.tier === "pro", `Status ${p1.status}`);
  check("Pro: tour im Paket = GET /tours/{slug} (ohne Link-Tokens)", stableStringify(stripTokens(p1.json.tour)) === stableStringify(stripTokens(pTourFull.json.tour)));
  check("Pro: keine gesperrten Stopps, nur Vollfassungen", (p1.json.tour.stops as Loose[]).every((s) => !s.locked) && (p1.json.audio as Loose[]).every((a) => a.kind === "full"));
  check("Pro: Linie ist dieselbe wie für den Gast (lineHash)", p1.json.route.lineHash === gp.route.lineHash);
  check("Pro: anderer contentHash als Gast", p1.json.contentHash !== gp.contentHash);
  const p2 = await http("GET", `${API}/tours/${slug}/package?lang=de`, user);
  check("Pro: contentHash gleich bei zwei Abrufen", p2.json?.contentHash === p1.json.contentHash);
  const en = await http("GET", `${API}/tours/${slug}/package?lang=en`, user);
  check("andere Sprache: anderer contentHash", en.status === 200 && en.json.contentHash !== p1.json.contentHash);

  head("16. Paket: Fehlerfälle");
  check("unbekannte Runde: 404 not_found", (await http("GET", `${API}/tours/gibt-es-nicht-xyz/package?lang=de`, null)).json?.error === "not_found");
  check("ungültiger Slug: 404", (await http("GET", `${API}/tours/${encodeURIComponent("../x")}/package?lang=de`, null)).status === 404);
  check("unbekannte Sprache: 400 invalid", (await http("GET", `${API}/tours/${slug}/package?lang=xx`, null)).json?.error === "invalid");
  check("kaputtes Token: 401 auth", (await http("GET", `${API}/tours/${slug}/package?lang=de`, "Bearer garbage")).status === 401);

  head("17. Umrouten (POST /route)");
  const line = gp.tour.routeGeo as [number, number][] | null;
  const mid = line ? line[Math.floor(line.length / 3)] : [gp.tour.stops[0].lng, gp.tour.stops[0].lat];
  const R = `${API}/route`;
  const body = { tourSlug: slug, from: mid, lang: "de" };
  const r1 = await http("POST", R, null, body);
  check("Gast: 200", r1.status === 200, `Status ${r1.status} ${r1.text.slice(0, 120)}`);
  const rc = (r1.headers.get("cache-control") ?? "").toLowerCase();
  check("Cache-Control private + no-store", rc.includes("private") && rc.includes("no-store"), rc);
  if (r1.status === 200) {
    const a = r1.json.route;
    check("tier public, Linie, Schritte mit arrive, Attribution", r1.json.tier === "public" && a.geometry.length > 10 && a.steps.at(-1).type === "arrive" && a.attribution === OSM_ATTRIBUTION);
    check("stopAlongM: ein Eintrag je Stopp der Runde", a.stopAlongM.length === gp.tour.stops.length);
    check("Linie beginnt nahe der Position", Math.hypot((a.geometry[0][0] - mid[0]) * 76000, (a.geometry[0][1] - mid[1]) * 111000) < 80);
  }
  const part = await http("POST", R, null, { ...body, keep: [gp.tour.stops.length - 2, gp.tour.stops.length - 1] });
  check("Gast: keep mit den letzten zwei Stoppen (gesperrte eingeschlossen): 200, 2 Einträge", part.status === 200 && part.json.route.stopAlongM.length === 2);
  const guestCoords = new Set((gp.tour.stops as Loose[]).map((s) => `${s.lng},${s.lat}`));
  check("Gast: gesperrte Stopps haben im Tour-Detail ohnehin Positionen (öffentliche Teaser)", lockedForGuest.every((s: Loose) => s.lat != null && s.lng != null) && guestCoords.size > 0);
  const asPro = await http("POST", R, user, body);
  check("Pro: 200, tier pro, dieselbe Länge wie für den Gast", asPro.status === 200 && asPro.json.tier === "pro" && asPro.json.route.lineHash === r1.json.route.lineHash);
  check("ungültig: unbekanntes Feld -> 400", (await http("POST", R, null, { ...body, wegpunkte: [[1, 2]] })).json?.error === "invalid");
  check("ungültig: freie Wegpunkte werden nicht angenommen", (await http("POST", R, null, { mode: "bike", waypoints: [[13.04, 47.8], [13.05, 47.8]] })).status === 400);
  check("ungültig: from fehlt -> 400", (await http("POST", R, null, { tourSlug: slug })).status === 400);
  check("ungültig: from keine Zahlen -> 400", (await http("POST", R, null, { ...body, from: ["a", "b"] })).status === 400);
  check("ungültig: from ausserhalb der Welt -> 400", (await http("POST", R, null, { ...body, from: [400, 99] })).status === 400);
  check("ungültig: from 100 km von der Runde -> 400", (await http("POST", R, null, { ...body, from: [14.6, 48.6] })).status === 400);
  check("ungültig: Modus passt nicht zur Runde -> 400", (await http("POST", R, null, { ...body, mode: proTour.mode === "bike" ? "walk" : "bike" })).status === 400);
  check("gültig: Modus passt -> 200", (await http("POST", R, null, { ...body, mode: proTour.mode })).status === 200);
  check("ungültig: keep ausserhalb -> 400", (await http("POST", R, null, { ...body, keep: [999] })).status === 400);
  check("ungültig: unbekannte Sprache -> 400", (await http("POST", R, null, { ...body, lang: "xx" })).status === 400);
  check("ungültig: Slug unbekannt -> 404", (await http("POST", R, null, { ...body, tourSlug: "gibt-es-nicht-xyz" })).json?.error === "not_found");
  check("ungültig: kein JSON-Typ -> 400", (await http("POST", R, null, undefined, { text: JSON.stringify(body), type: "text/plain" })).status === 400);
  check("ungültig: zu grosser Body -> 400", (await http("POST", R, null, undefined, { text: JSON.stringify({ ...body, pad: "x".repeat(5000) }), type: "application/json" })).status === 400);
  check("kaputtes Token -> 401", (await http("POST", R, "Bearer garbage", body)).status === 401);
  check("GET auf /route: 405", (await http("GET", R, null)).status === 405);

  head("18. Ratenbegrenzung");
  // Pro-Konto: 60 Umroute-Anfragen in 10 Minuten. Mit ungültigem Slug (400 ohne Routendienst),
  // denn die Zählung kommt VOR der Prüfung des Inhalts.
  const t = [] as number[];
  let firstBlocked = -1;
  for (let i = 1; i <= 64; i++) {
    const r = await http("POST", R, user, { tourSlug: "x", from: [13, 47] });
    t.push(r.status);
    if (r.status === 429 && firstBlocked < 0) firstBlocked = i;
  }
  info(`Umrouten: erste 429 bei Anfrage ${firstBlocked} (die 3 Anfragen von oben zählen mit)`);
  check("Umrouten: je Konto begrenzt (429 rate_limit zwischen Anfrage 50 und 62)", firstBlocked >= 50 && firstBlocked <= 62 && t.at(-1) === 429);
  const lim = await http("POST", R, user, { tourSlug: "x", from: [13, 47] });
  check("429 trägt den festen Code rate_limit", lim.json?.error === "rate_limit");
  const other = await http("POST", R, null, body);
  check("anderes Konto (Gast) ist davon nicht betroffen", other.status === 200);
  let pkgBlocked = -1;
  for (let i = 1; i <= 34; i++) {
    const r = await http("GET", `${API}/tours/gibt-es-nicht-xyz/package?lang=de`, user);
    if (r.status === 429) {
      pkgBlocked = i;
      break;
    }
  }
  info(`Paket: erste 429 bei Anfrage ${pkgBlocked} (die 5 Paket-Abrufe von oben zählen mit)`);
  check("Paket: je Konto begrenzt (429 spätestens bei Anfrage 30)", pkgBlocked > 0 && pkgBlocked <= 30);

  head("19. Logs");
  if (serverLog) {
    const log = readFileSync(serverLog, "utf8");
    const nums = [mid[0].toFixed(4), mid[1].toFixed(4)];
    check("Server-Log enthält die Position des Gastes nicht", !nums.some((n) => log.includes(n)), "Koordinaten im Log gefunden");
    check("Server-Log enthält keine Routing-Token/Bearer-Werte", !/Bearer [A-Za-z0-9._-]{20,}/.test(log) && !log.includes(token));
  } else info("Server-Log nicht angegeben (--server-log=), übersprungen");
  if (brouterLog) info(`BRouter-Log: ${lines(brouterLog)} Zeilen`);
  void statSync;
}

// ── Lauf ──────────────────────────────────────────────────────────────────────
async function cleanup(): Promise<void> {
  if (!tempUser || deleted !== null) return;
  try {
    deleted = await deleteTempUser(tempUser.id);
  } catch (e) {
    console.log(`  FEHLT Aufraeumen: ${(e as Error).message}`);
    deleted = false;
  }
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    cleanup().finally(() => process.exit(130));
  });
}

try {
  await partOffline();
  if (noBrouter) {
    info("--no-brouter: Abschnitte 10 bis 12 übersprungen");
  } else if (!(await brouterUp())) {
    check(`BRouter erreichbar unter ${BROUTER} (sonst --no-brouter)`, false);
  } else {
    await partBrouter();
  }
  const base = arg("base");
  if (base) {
    for (const v of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"])
      if (!process.env[v]) throw new Error(`${v} fehlt (.env.local)`);
    await partHttp(base, arg("brouter-log"), arg("server-log"));
  }
} catch (e) {
  failed++;
  console.log(`\n  FEHLT Unerwarteter Fehler: ${(e as Error).stack ?? (e as Error).message}`);
} finally {
  await cleanup();
  if (tempUser) {
    console.log(`\nWegwerf-Konto geloescht: ${deleted ? "ja (bestaetigt)" : "NEIN, NICHT BESTAETIGT, bitte app-api-check+...@example.com im Supabase-Dashboard pruefen"}`);
    if (!deleted) failed++;
  }
  console.log(failed ? `\n${failed} Pruefung(en) fehlgeschlagen, ${okCount} ok.` : `\nAlles gruen (${okCount} ok).`);
  process.exitCode = failed ? 1 : 0;
}
