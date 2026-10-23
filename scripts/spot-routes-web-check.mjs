// Prüft im echten Chrome, dass Spot-Editor und KI-Builder über unseren Routendienst laufen
// (docs/42, Abschnitt 16):
//   1. Admin, Spot-Editor: "An Wanderwege anpassen" liefert Länge, Höhenmeter, Gehzeit und die
//      OSM-Zeile; kein Aufruf an openrouteservice aus dem Browser (der Server fragt BRouter).
//   2. Pro-Nutzer, /touren/bauen: "Tour bauen" legt eine eigene Runde an, deren Linie, km und
//      Minuten aus dem Routendienst kommen (geprüft in der Datenbank, Linie beginnt am Start).
//
// Aufruf: node --experimental-strip-types --disable-warning=ExperimentalWarning --env-file=.env.local \
//           scripts/spot-routes-web-check.mjs --base=http://localhost:3041 --spot=<slug> [--shots=<ordner>] [--lang=de]
// Braucht einen Server mit ROUTING_URL auf einen (lokalen) BRouter und das echte Supabase.
// Legt ein Wegwerf-Konto an (Admin UND Pro, scripts/lib/temp-user.ts) und löscht es IMMER
// wieder, samt der eigenen Runde (on delete cascade). Es klickt NIE auf "Speichern": Der
// Spot in der Datenbank bleibt unverändert; das Bauen kostet einen Claude-Aufruf.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const arg = (n, d = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const BASE = (arg("base") ?? "").replace(/\/+$/, "");
const SPOT = arg("spot");
const LANG = arg("lang", "de");
const SHOTS = arg("shots");
if (!BASE || !SPOT) {
  console.error("--base und --spot fehlen");
  process.exit(2);
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok   " : "FEHLT"} ${name}${!cond && detail ? `\n        ${detail}` : ""}`);
  if (!cond) failed++;
};
const info = (m) => console.log(`  ..    ${m}`);

const tu = await import("./lib/temp-user.ts");
const svc = tu.serviceClient();
const { data: spot } = await svc.from("spots").select("id, route_waypoints").eq("slug", SPOT).single();
if (!spot) {
  console.error(`Spot ${SPOT} nicht gefunden`);
  process.exit(2);
}
const user = await tu.createTempUser();
let browser = null;
const cleanup = async () => {
  await browser?.close().catch(() => {});
  const ok = await tu.deleteTempUser(user.id).catch(() => false);
  const { data: left } = await svc.from("user_tours").select("id").eq("user_id", user.id);
  console.log(`  ..    Wegwerf-Konto gelöscht: ${ok ? "ja, bestätigt" : "NEIN, bitte app-api-check+...@example.com prüfen"}; eigene Runden übrig: ${left?.length ?? "?"}`);
  if (!ok || (left?.length ?? 0) > 0) failed++;
};
process.on("uncaughtException", (e) => {
  console.error(e);
  cleanup().finally(() => process.exit(1));
});

try {
  await tu.setProfile(user.id, { is_pro: true, role: "admin" });
  const cookieHeader = await tu.webCookieHeader(user.session);
  browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: LANG });
  await ctx.addCookies(cookieHeader.split("; ").map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1), url: BASE })));
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  const foreign = [];
  page.on("request", (r) => {
    if (/openrouteservice|api\.mapbox\.com\/(directions|optimized-trips)/.test(r.url())) foreign.push(r.url());
  });

  // ── 1. Spot-Editor ────────────────────────────────────────────────────────────────
  console.log("\n1. Spot-Editor: An Wanderwege anpassen");
  await page.goto(`${BASE}/${LANG}/admin/spots/${spot.id}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(3000);
  const snapBtn = page.getByRole("button", { name: /An Wanderwege anpassen/ });
  check("Editor geladen, Knopf 'An Wanderwege anpassen' sichtbar", (await snapBtn.count()) === 1, `Knöpfe: ${await snapBtn.count()}`);
  await snapBtn.first().click();
  let msg = "";
  for (let i = 0; i < 120 && !msg; i++) {
    await page.waitForTimeout(500);
    msg = await page.evaluate(() => {
      const el = [...document.querySelectorAll("span")].find((s) => /^Angepasst ·|Routendienst|Fehler|nicht erreichbar|Kein Weg/.test(s.textContent ?? ""));
      return el ? el.textContent : "";
    });
  }
  info(`Meldung: ${msg || "(keine)"}`);
  check("Meldung 'Angepasst · <km> · ↑/↓ hm · ~Gehzeit'", /^Angepasst · \d+\.\d km · ↑\d+ ↓\d+ hm · ~/.test(msg), msg);
  check("OSM-Zeile in der Meldung", /Route: © OpenStreetMap-Mitwirkende/.test(msg), msg);
  check("kein Aufruf an openrouteservice oder Mapbox-Directions aus dem Browser", foreign.length === 0, foreign.join(" | "));
  const profileShown = await page.evaluate(() => /Höhenprofil \(Vorschau\)/.test(document.body.innerText));
  check("Höhenprofil (Vorschau) erscheint", profileShown);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-spot-snap.png`, fullPage: false });
  const { data: after } = await svc.from("spots").select("route_waypoints, route_geojson").eq("id", spot.id).single();
  check("Spot in der Datenbank unverändert (nichts gespeichert)", JSON.stringify(after?.route_waypoints) === JSON.stringify(spot.route_waypoints));

  // ── 2. KI-Builder ─────────────────────────────────────────────────────────────────
  console.log("\n2. KI-Builder: Tour bauen (Pro)");
  await page.goto(`${BASE}/${LANG}/touren/bauen`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(2500);
  const buildBtn = page.getByRole("button", { name: /Tour bauen/ });
  check("Builder geladen, Knopf 'Tour bauen'", (await buildBtn.count()) >= 1, `Knöpfe: ${await buildBtn.count()}`);
  const chip = page.getByRole("button", { pressed: false }).nth(0);
  if (await chip.count()) await chip.click().catch(() => {});
  await buildBtn.first().click();
  let landed = false;
  for (let i = 0; i < 240 && !landed; i++) {
    await page.waitForTimeout(500);
    landed = /\/touren\/meine\//.test(page.url());
  }
  check("nach dem Bauen auf /touren/meine/<id>", landed, page.url());
  await page.waitForTimeout(3000);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/builder-result.png`, fullPage: false });
  const { data: tours } = await svc.from("user_tours").select("id, point_ids, route_geo, start_lat, start_lng, distance_km, duration_min").eq("user_id", user.id);
  const t = tours?.[0];
  check("eigene Runde gespeichert (genau eine)", tours?.length === 1, `${tours?.length}`);
  if (t) {
    const geo = t.route_geo;
    check("Linie gespeichert (mehr als 20 Punkte)", Array.isArray(geo) && geo.length > 20, `${Array.isArray(geo) ? geo.length : geo}`);
    const near = (p) => Math.hypot((p[0] - t.start_lng) * 76000, (p[1] - t.start_lat) * 111000) < 60;
    check("Linie beginnt und endet am Gebiets-Start (unter 60 m)", Array.isArray(geo) && near(geo[0]) && near(geo[geo.length - 1]));
    check("km und Minuten gesetzt, Minuten = Gehzeit 4,5 km/h + 2 je Stopp (±1)", typeof t.distance_km === "number" || typeof t.distance_km === "string", JSON.stringify({ km: t.distance_km, min: t.duration_min }));
    const km = Number(t.distance_km);
    const expect = Math.round((km * 1000) / 1.25 / 60) + t.point_ids.length * 2;
    check("Dauer folgt der Formel (±2 min wegen gerundeter km)", Math.abs(t.duration_min - expect) <= 2, `${t.duration_min} gegen ${expect} (${km} km, ${t.point_ids.length} Stopps)`);
    info(`${km} km, ${t.duration_min} min, ${t.point_ids.length} Stopps, Linie ${Array.isArray(geo) ? geo.length : 0} Punkte`);
  }
  const bodyText = await page.evaluate(() => document.body.innerText);
  check("Seite der Runde zeigt km", /\d+([.,]\d+)?\s*km/.test(bodyText));
  check("keine Seitenfehler", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  await cleanup();
}
console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exit(failed ? 1 : 0);
