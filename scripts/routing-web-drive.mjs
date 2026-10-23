// Fährt die WEB-Navigation einer Runde im echten Chrome ab (docs/42, Abschnitt 8.3):
// iPhone-Viewport, Standort wird Schritt für Schritt entlang der Linie der Runde gesetzt, einmal
// seitlich neben die Linie (Neuberechnung). Geprüft wird, was der Gast sieht und was das
// Netz tut:
//   - die Route kommt von unserer eigenen Adresse (POST /api/tours/<slug>/route), nie von
//     api.mapbox.com/directions;
//   - Ansagen erscheinen, ohne "undefined", ohne leere Anführungszeichen, ohne Strassennamen;
//   - Stopp-Einladungen erscheinen;
//   - die Neuberechnung löst eine zweite Anfrage aus;
//   - keine Konsolenfehler.
//
// Aufruf: node scripts/routing-web-drive.mjs --base=http://localhost:3014 --slug=<slug>
//          [--max-m=2500] [--step-m=8] [--interval-ms=500] [--shots=<ordner>] [--lang=de]
//   EIGENE RUNDE ("Meine Touren", /touren/meine/<id>/navigation):
//     node --experimental-strip-types --env-file=.env.local scripts/routing-web-drive.mjs \
//          --base=... --slug=<kuratierte Geh-Runde, deren Punkte genommen werden> --user-tour \
//          --brouter=http://127.0.0.1:17777
//     Legt ein Wegwerf-Konto und eine eigene Runde an (echtes Supabase, wie app-api:check) und
//     loescht sie IMMER wieder.
//   FEHLERZUSTAND: --expect-unavailable faehrt gegen einen Server, dessen Routendienst nicht
//     antwortet, und prueft, dass "Navigation gerade nicht verfuegbar" steht (nicht die Pille
//     "letzte Route bleibt aktiv").
// Braucht einen Server mit ROUTING_URL auf einen lokalen BRouter und System-Chrome.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const arg = (n, d = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const BASE = (arg("base") ?? "").replace(/\/+$/, "");
const SLUG = arg("slug");
const LANG = arg("lang", "de");
const MAX_M = Number(arg("max-m", "2500"));
const STEP_M = Number(arg("step-m", "8"));
const INTERVAL = Number(arg("interval-ms", "500"));
const SHOTS = arg("shots");
const USER_TOUR = process.argv.includes("--user-tour");
const EXPECT_UNAVAILABLE = process.argv.includes("--expect-unavailable");
const BROUTER = arg("brouter", "http://127.0.0.1:17777");
if (!BASE || !SLUG) {
  console.error("--base und --slug fehlen");
  process.exit(2);
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok   " : "FEHLT"} ${name}${!cond && detail ? `\n        ${detail}` : ""}`);
  if (!cond) failed++;
};
const info = (m) => console.log(`  ..    ${m}`);

// ── Linie der Runde: aus dem Paket (kuratiert) oder fuer eine eigene Runde selbst gebaut ───
let pkg = await (await fetch(`${BASE}/api/app/v1/tours/${SLUG}/package?lang=${LANG}`)).json();
let navPath = `/${LANG}/touren/${SLUG}/navigation`;
let routeSlug = SLUG; // so heisst die Runde in /api/tours/<slug>/route
let cleanup = async () => {};
process.on("uncaughtException", (e) => {
  console.error(e);
  cleanup().finally(() => process.exit(1));
});
let cookieHeader = null;
if (EXPECT_UNAVAILABLE) {
  pkg = { route: { geometry: [[13.043, 47.801], [13.047, 47.803]], distanceM: 400 }, tour: { mode: "walk", stops: [{}, {}] } };
}
if (!pkg.route && !EXPECT_UNAVAILABLE) {
  console.error("Paket ohne Route", JSON.stringify(pkg).slice(0, 200));
  process.exit(2);
}
if (USER_TOUR) {
  const tu = await import("./lib/temp-user.ts");
  const user = await tu.createTempUser();
  cleanup = async () => {
    const ok = await tu.deleteTempUser(user.id).catch(() => false);
    console.log(`  ..    Wegwerf-Konto (samt eigener Runde) geloescht: ${ok ? "ja, bestaetigt" : "NEIN, bitte app-api-check+...@example.com pruefen"}`);
    if (!ok) failed++;
  };
  const svc = tu.serviceClient();
  const ids = pkg.tour.stops.slice(0, 4).map((x) => x.spotSlug);
  const { data: pts } = await svc.from("tour_points").select("id, lat, lng, area_id").in("id", ids);
  const byId = new Map(pts.map((x) => [x.id, x]));
  const ordered = ids.map((i) => byId.get(i));
  const coordStr = [...ordered, ordered[0]].map((x) => `${x.lng},${x.lat}`).join("|");
  const g = await (await fetch(`${BROUTER}/brouter?lonlats=${coordStr}&profile=hiking-mountain&alternativeidx=0&format=geojson`)).json();
  const geometry = g.features[0].geometry.coordinates.map((c) => [c[0], c[1]]);
  const { data: row, error } = await svc
    .from("user_tours")
    .insert({
      user_id: user.id,
      area_id: ordered[0].area_id,
      name: "Wegwerf-Runde",
      point_ids: ids,
      route_geo: geometry,
      start_lat: ordered[0].lat,
      start_lng: ordered[0].lng,
    })
    .select("id")
    .single();
  if (error) throw new Error(`user_tours anlegen: ${error.message}`);
  cookieHeader = await tu.webCookieHeader(user.session);
  navPath = `/${LANG}/touren/meine/${row.id}/navigation`;
  routeSlug = `meine-${row.id}`;
  pkg = { route: { geometry, distanceM: 0 }, tour: { mode: "walk", stops: ordered.map(() => ({})) } };
  info(`eigene Runde angelegt (${ids.length} Stopps, Linie ${geometry.length} Punkte)`);
}
const line = pkg.route.geometry;
const mode = pkg.tour.mode;
info(`${mode === "bike" ? "Rad" : "zu Fuss"}-Runde, ${pkg.tour.stops.length} Stopps${pkg.route.distanceM ? `, Linie ${(pkg.route.distanceM / 1000).toFixed(2)} km` : ""}`);

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// Punkte im Abstand STEP_M entlang der Linie, bis MAX_M
function sample(pts, step, max) {
  const out = [pts[0]];
  let acc = 0;
  let next = step;
  for (let i = 1; i < pts.length && next <= max; i++) {
    const seg = hav(pts[i - 1], pts[i]);
    while (acc + seg >= next && next <= max) {
      const f = (next - acc) / seg;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
      next += step;
    }
    acc += seg;
  }
  return out;
}
const fixes = sample(line, STEP_M, MAX_M);
info(`${fixes.length} Standort-Schritte (${STEP_M} m, alle ${INTERVAL} ms)`);

// ── Browser ───────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  geolocation: { latitude: fixes[0][1], longitude: fixes[0][0], accuracy: 8 },
  permissions: ["geolocation"],
  locale: LANG,
});
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`${m.text().slice(0, 600)} @ ${m.location()?.url ?? ""}`);
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
const reqs = { route: [], directions: 0, other: 0 };
page.on("request", (r) => {
  const u = r.url();
  if (/api\.mapbox\.com\/directions/.test(u)) reqs.directions++;
  if (u.includes(`/api/tours/${routeSlug}/route`) && r.method() === "POST") reqs.route.push(JSON.parse(r.postData() ?? "{}"));
});
const routeStatus = [];
page.on("response", (r) => {
  if (r.url().includes(`/api/tours/${routeSlug}/route`) && r.request().method() === "POST") routeStatus.push(r.status());
});

if (cookieHeader) await ctx.addCookies(cookieHeader.split("; ").map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1), url: BASE })));
await page.goto(`${BASE}${navPath}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(4000);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/${mode}-0-start.png` });
// Start-Knopf (beginNavigation) und eventuell ein Hinweis davor
for (let i = 0; i < 3; i++) {
  const btn = page.getByRole("button", { name: /Navigation starten/ });
  if (await btn.count()) {
    await btn.first().click().catch(() => {});
    await page.waitForTimeout(1500);
  }
}
// Warten, bis die erste Route da ist
let routeReady = false;
for (let i = 0; i < 40 && !routeReady; i++) {
  routeReady = reqs.route.length > 0 && routeStatus.length > 0;
  if (!routeReady) await page.waitForTimeout(500);
}
check("erste Routenanfrage geht an unsere eigene Adresse", reqs.route.length >= 1, `Anfragen: ${reqs.route.length}`);
if (EXPECT_UNAVAILABLE) {
  // Routendienst antwortet nicht: Es gab nie eine Route, also darf NICHT "letzte Route bleibt
  // aktiv" stehen, sondern die ehrliche Meldung.
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => document.body.innerText);
  check("Antwort 503 (Dienst nicht erreichbar oder nicht eingerichtet)", routeStatus[0] === 503, `Status ${routeStatus[0]}`);
  check("Meldung 'Navigation gerade nicht verfügbar' steht", /Navigation gerade nicht verfügbar/.test(text));
  check("Pille 'letzte Route bleibt aktiv' steht NICHT", !/letzte Route bleibt aktiv/.test(text));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/unavailable.png`, timeout: 8000 }).catch(() => {});
  await browser.close();
  await cleanup();
  console.log(failed ? `\n${failed} Pruefung(en) fehlgeschlagen.` : "\nAlles gruen.");
  process.exit(failed ? 1 : 0);
}
check("erste Antwort 200", routeStatus[0] === 200, `Status ${routeStatus[0]}`);
await page.waitForTimeout(2000);

const banners = new Set();
const seen = { offer: 0, rerouting: 0, wrongWay: 0, finished: 0 };
const bannerOf = async () =>
  page.evaluate(() => {
    const el = document.querySelector(".sg-nav-card");
    return el ? el.innerText.replace(/\s+/g, " ").trim() : "";
  });
async function poll() {
  const b = await bannerOf();
  if (b) banners.add(b);
  const t = await page.evaluate(() => document.body.innerText);
  if (/Jetzt hier|Läuft gerade/.test(t)) seen.offer++;
  if (/neu berechnet/.test(t)) seen.rerouting++;
  if (/Bitte umdrehen/.test(t)) seen.wrongWay++;
  if (/Am Ziel|Wieder am Start/.test(t)) seen.finished++;
}

let offRouteAt = Math.floor(fixes.length * 0.45);
// Auf die Seite ausweichen, auf der die Linie weiter weg liegt (eine kleine Schleife liegt
// sonst nach 120 m wieder neben dem eigenen Stueck).
const minDist = (pt) => Math.min(...line.map((q) => hav(pt, q)));
const base = fixes[offRouteAt] ?? fixes[0];
const SIDE = minDist([base[0], base[1] + 120 / 111000]) >= minDist([base[0], base[1] - 120 / 111000]) ? 1 : -1;
let shot = 0;
for (let i = 0; i < fixes.length; i++) {
  let [lng, lat] = fixes[i];
  // Bis zu 120 m seitlich neben die Linie, in Schritten von 8 m (schneller waere ein GPS-
  // Ausreisser, den der Kern verwirft), 10 Schritte halten, dann zurueck: Der Kern muss neu
  // rechnen lassen.
  const k = i - offRouteAt;
  const lateral = k < 0 || k >= 40 ? 0 : k < 15 ? k * 8 : k < 25 ? 120 : (40 - k) * 8;
  const off = lateral > 0;
  if (off) lat += (SIDE * lateral) / 111000;
  await ctx.setGeolocation({ latitude: lat, longitude: lng, accuracy: 8 });
  await page.waitForTimeout(INTERVAL);
  if (i % 3 === 0 || off) await poll();
  if (SHOTS && i % 60 === 0) await page.screenshot({ path: `${SHOTS}/${mode}-${String(++shot).padStart(2, "0")}.png` });
}
await page.waitForTimeout(2500);
await poll();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/${mode}-9-end.png` });

console.log(`\n  Ansagen im Banner (${banners.size} verschiedene):`);
for (const b of [...banners].slice(0, 25)) console.log(`     | ${b}`);

check("keine Anfrage an api.mapbox.com/directions", reqs.directions === 0, `${reqs.directions} Anfragen`);
check("mindestens eine Neuberechnung (zweite Routenanfrage)", reqs.route.length >= 2, `Anfragen: ${reqs.route.length}`);
check("Neuberechnung trägt alongM/keep (Stand der alten Linie)", reqs.route.slice(1).some((r) => typeof r.alongM === "number" && Array.isArray(r.keep)));
check("alle Routenantworten 200", routeStatus.length > 0 && routeStatus.every((s) => s === 200), JSON.stringify(routeStatus));
check("Ansagen vorhanden", banners.size >= 3, `${banners.size}`);
const bad = [...banners].filter((b) => /undefined|null|\{|\}|""|''|« »|\[object/.test(b));
check("keine Ansage mit 'undefined', leeren Anführungszeichen oder Platzhaltern", bad.length === 0, bad.join(" || "));
check("Stopp-Einladung erschien", seen.offer > 0, JSON.stringify(seen));
check("Anzeige 'Route wird neu berechnet' erschien", seen.rerouting > 0, JSON.stringify(seen));
const realErrors = consoleErrors.filter((e) => !/WebGL|GPU stall|Failed to load resource.*(tiles|mapbox|events)|net::ERR_|^Qt\b|A tree hydrated but some attributes/i.test(e));
check("keine Konsolenfehler", realErrors.length === 0, realErrors.slice(0, 5).join(" || "));
if (consoleErrors.length > realErrors.length) info(`${consoleErrors.length - realErrors.length} Browser-Meldung(en) zu Karte/GPU ignoriert (Mapbox-Meldung Qt im Headless-Chrome, Hydration-Warnung der Navigationsseite; beide gleich auf dem Stand vor dieser Aenderung)`);
info(`Routenanfragen: ${reqs.route.length}, Status ${JSON.stringify(routeStatus)}, gesehen ${JSON.stringify(seen)}`);

await browser.close();
await cleanup();
console.log(failed ? `\n${failed} Pruefung(en) fehlgeschlagen.` : "\nAlles gruen.");
process.exit(failed ? 1 : 0);
