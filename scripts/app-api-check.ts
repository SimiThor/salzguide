// Prüft, dass die App-API (/api/app/v1) und die Website IDENTISCH maskieren.
// Aufruf: npm run app-api:check -- --base=http://localhost:3012 [--web-base=http://localhost:3011] [--lang=de]
//
// WARUM ES DIESE PRÜFUNG GIBT (docs/41, Phase 1): Die native App bekommt ihre Daten aus der
// API, die Website aus Server-Komponenten. Beide müssen für Gast, eingeloggten Nutzer und Pro
// dasselbe verbergen: Pro-Spots als `locked-N` mit grob gerundeter Position, keine Pro-Texte,
// nur die Kostprobe als Audio, nie ein Entwurf. Ein Unterschied wäre ein Leck, das keine
// Seite je zeigt, weil nur die App es abfragt. Die Prüfung vergleicht deshalb die API mit
// dem, was die Website im HTML ausliefert, nicht mit einer Erwartung aus dem Kopf.
//
// Sie braucht einen LAUFENDEN Server und das ECHTE Supabase (Konto anlegen, Pro setzen,
// einloggen). Darum gehört sie NICHT zum Offline-Lauf `npm run pro:check`.
//
// --base      PFLICHT. Server mit der API. Es gibt absichtlich keinen Standard: Auf Port 3000
//             kann ein fremder oder der Produktions-Server laufen.
// --web-base  Server für die Website-Hälfte (Standard: --base). So lässt sich die Website
//             von einem unveränderten Stand (alter Code) abfragen, während die API vom neuen
//             Code kommt: bewiesen wird dann API(neu) == Web(alt).
// --lang      Sprache der Abfragen (Standard: de).
//
// WEGWERF-KONTO: Die Prüfung legt ein Konto `app-api-check+...@example.com` an (ohne Mail),
// setzt darauf kurz is_pro und role=admin und LÖSCHT es IMMER wieder (finally sowie bei
// SIGINT/SIGTERM). Am Ende steht, ob die Löschung bestätigt wurde. Die Ausgabe nennt nie
// Titel, Slugs oder Texte von Pro-Inhalten, nur "Pro-Spot" und "Pro-Tour".
//
// PHASE 3 (docs/41): Die Abschnitte 9 bis 13 pruefen die HANDELNDEN Routen (Merkliste, PATCH und
// DELETE /me) und /spots/{slug}/live. Sie legen zusaetzlich zwei weitere Wegwerf-Konten an (ein
// zweites fuer die RLS-Gegenprobe, ein drittes, das DELETE /me wirklich loescht) und raeumen auch
// diese immer ab. Der Apple-Widerruf ist ohne Schluessel nicht testbar: Abschnitt 9 prueft den
// Client-Secret-Bauer offline mit einem Wegwerf-EC-Schluessel.
import {
  createPrivateKey,
  createVerify,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  createTempUser,
  setProfile,
  webCookieHeader,
  deleteTempUser,
  sweepTempUsers,
  serviceClient,
  anonClient,
} from "./lib/temp-user.ts";
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

// ── Argumente ─────────────────────────────────────────────────────────────────
function arg(name: string): string | null {
  const p = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : null;
}
const trimSlash = (s: string) => s.replace(/\/+$/, "");
const baseArg = arg("base");
if (!baseArg) {
  console.error(
    "--base fehlt. Beispiel: npm run app-api:check -- --base=http://localhost:3012\n" +
      "Es gibt absichtlich keinen Standard: Auf Port 3000 kann ein fremder oder der Produktions-Server laufen.",
  );
  process.exit(2);
}
const BASE = trimSlash(baseArg);
const WEB = trimSlash(arg("web-base") ?? BASE);
const LANG = arg("lang") ?? "de";
const API = `${BASE}/api/app/v1`;
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// ── HTTP-Helfer ───────────────────────────────────────────────────────────────
// JSON aus der API, bewusst locker: jede Prüfung testet die Form selbst. Ein strenger Typ
// hiesse, dem Ergebnis schon vor der Prüfung zu glauben.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
type Res = { status: number; headers: Headers; text: string; json: Loose };

async function getRaw(url: string, headers: Record<string, string>): Promise<Res> {
  const r = await fetch(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
  });
  const text = await r.text();
  let json: Loose = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* kein JSON, z.B. HTML */
  }
  return { status: r.status, headers: r.headers, text, json };
}

/** API-Abfrage. `auth` = kompletter Authorization-Wert, oder null = kein Header. */
function apiGet(path: string, auth: string | null = null): Promise<Res> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (auth !== null) h.Authorization = auth;
  return getRaw(`${API}${path}`, h);
}
const bearer = (token: string | null) => (token ? `Bearer ${token}` : null);

/** Schreibende Abfrage. `body` als JSON, ausser `rawBody` ist gesetzt (dann genau dieser Text). */
async function apiSend(
  method: "PUT" | "PATCH" | "DELETE" | "POST",
  path: string,
  auth: string | null,
  opts: { body?: unknown; rawBody?: string; contentType?: string | null } = {},
): Promise<Res> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (auth !== null) h.Authorization = auth;
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  const ct = opts.contentType === undefined ? (body !== undefined ? "application/json" : null) : opts.contentType;
  if (ct) h["Content-Type"] = ct;
  const r = await fetch(`${API}${path}`, { method, headers: h, body, redirect: "manual", signal: AbortSignal.timeout(90_000) });
  const text = await r.text();
  let json: Loose = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* kein JSON */
  }
  return { status: r.status, headers: r.headers, text, json };
}

function webGet(path: string, cookie: string | null): Promise<Res> {
  const h: Record<string, string> = { "User-Agent": UA, Accept: "text/html" };
  if (cookie) h.Cookie = cookie;
  return getRaw(`${WEB}${path}`, h);
}

// ── Text-Helfer ───────────────────────────────────────────────────────────────
/** Macht HTML-Entities und JSON-Escapes rückgängig, damit ein positiver Treffer nicht an der Schreibweise scheitert. */
function decode(s: string): string {
  return s
    .replace(/\\u0026/g, "&")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
/** Positiver Treffer: nach dem Entschlüsseln. */
const has = (hay: string, needle: string) => decode(hay).includes(needle);
/** Negativer Treffer: roh, entschlüsselt UND als JSON-Text, damit nichts durch die Maschen fällt. */
function leaks(hay: string, needle: string): boolean {
  if (!needle) return false;
  return (
    hay.includes(needle) ||
    decode(hay).includes(needle) ||
    hay.includes(JSON.stringify(needle).slice(1, -1))
  );
}
const lockedSlugs = (s: string) => new Set(s.match(/locked-\d+/g) ?? []);
function audioPaths(s: string): Set<string> {
  const out = new Set<string>();
  const re = /\/storage\/v1\/object\/sign\/tour-audio\/([^?"\\\s]+)/g;
  const flat = s.replace(/\\\//g, "/");
  for (const m of flat.matchAll(re)) out.add(m[1]);
  return out;
}
const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));
const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;
const cc = (r: Res) => (r.headers.get("cache-control") ?? "").toLowerCase();

// ── Ground Truth (Service-Client) ─────────────────────────────────────────────
type SpotTruth = { slug: string; title: string; hasRoute: boolean };
type TourTruth = { slug: string; isPro: boolean; freeStops: number };
type Truth = {
  freeSpot: SpotTruth | null;
  proSpot: SpotTruth | null;
  tourSlugs: string[];
  proTour: TourTruth | null;
  freeTour: TourTruth | null;
  draft: { slug: string; title: string | null } | null;
};

async function loadTruth(): Promise<Truth> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  async function pickSpot(isPro: boolean, withRoute: boolean): Promise<SpotTruth | null> {
    let q = db
      .from("spots")
      .select("slug, route_geojson, spot_translations!inner(title, lang)")
      .eq("status", "published")
      .eq("is_pro", isPro)
      .eq("spot_translations.lang", LANG)
      .order("slug")
      .limit(1);
    if (withRoute) q = q.not("route_geojson", "is", null);
    const { data, error } = await q;
    if (error) throw new Error(`spots lesen: ${error.message}`);
    const row = data?.[0] as Loose;
    if (!row) return null;
    const title = row.spot_translations?.[0]?.title as string | undefined;
    if (!title) return null;
    return { slug: row.slug, title, hasRoute: row.route_geojson != null };
  }

  const freeSpot = (await pickSpot(false, true)) ?? (await pickSpot(false, false));
  const proSpot = await pickSpot(true, false);

  const { data: tours, error: terr } = await db
    .from("tours")
    .select("slug, is_pro, free_stops, status")
    .order("slug");
  if (terr) throw new Error(`tours lesen: ${terr.message}`);
  const all = (tours ?? []) as Loose[];
  const pub = all.filter((t) => t.status === "published");
  const toTour = (t: Loose | undefined): TourTruth | null =>
    t ? { slug: t.slug, isPro: !!t.is_pro, freeStops: Number(t.free_stops ?? 0) } : null;

  const draftRow = all.find((t) => t.status !== "published");
  let draft: Truth["draft"] = null;
  if (draftRow) {
    const { data: tr } = await db
      .from("tour_translations")
      .select("title, lang, tours!inner(slug)")
      .eq("tours.slug", draftRow.slug)
      .eq("lang", LANG)
      .limit(1);
    draft = { slug: draftRow.slug, title: ((tr?.[0] as Loose)?.title as string) ?? null };
  }

  return {
    freeSpot,
    proSpot,
    tourSlugs: pub.map((t) => t.slug as string),
    proTour: toTour(pub.find((t) => t.is_pro)),
    freeTour: toTour(pub.find((t) => !t.is_pro)),
    draft,
  };
}

// ── Aufräumen ─────────────────────────────────────────────────────────────────
let tempUser: TempUser | null = null;
let deletedConfirmed: boolean | null = null;
// Weitere Wegwerf-Konten der Phase-3-Abschnitte (zweites Konto fuer RLS, Konto fuer DELETE /me).
const extraUsers: TempUser[] = [];

async function cleanupExtras(): Promise<void> {
  for (const u of extraUsers.splice(0)) {
    try {
      if (!(await deleteTempUser(u.id))) {
        failed++;
        console.log("  FEHLT Aufraeumen: weiteres Wegwerf-Konto nicht bestaetigt geloescht (app-api-check+...@example.com pruefen)");
      }
    } catch (e) {
      failed++;
      console.log(`  FEHLT Aufraeumen (weiteres Konto): ${(e as Error).message}`);
    }
  }
}

async function cleanup(): Promise<void> {
  await cleanupExtras();
  if (!tempUser || deletedConfirmed !== null) return;
  try {
    deletedConfirmed = await deleteTempUser(tempUser.id);
  } catch (e) {
    console.log(`  FEHLT Aufraeumen: ${(e as Error).message}`);
    deletedConfirmed = false;
  }
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`\n${sig}: loesche Wegwerf-Konto ...`);
    cleanup().finally(() => {
      console.log(deletedConfirmed ? "  Wegwerf-Konto geloescht (bestaetigt)." : "  ACHTUNG: Loeschen NICHT bestaetigt.");
      process.exit(130);
    });
  });
}

// ── Prüfungen je Stufe ────────────────────────────────────────────────────────
type TierName = "Gast" | "Nutzer" | "Pro" | "Gast (nochmal)";
const proAudioCounts: Record<string, number> = {};

async function runTier(
  tierName: TierName,
  expectPro: boolean,
  token: string | null,
  cookie: string | null,
  truth: Truth,
  tempEmail: string,
  isUser: boolean,
): Promise<void> {
  head(`Stufe ${tierName} (erwartet: ${expectPro ? "pro" : "public"})`);
  const expectTier = expectPro ? "pro" : "public";
  const auth = bearer(token);
  const L = `lang=${LANG}`;

  // a. explore
  const apiEx = await apiGet(`/explore?${L}`, auth);
  const webEx = await webGet(`/${LANG}/explore`, cookie);
  check(`${tierName}: /explore antwortet 200 (API und Web)`, apiEx.status === 200 && webEx.status === 200,
    `API ${apiEx.status}, Web ${webEx.status}`);
  check(`${tierName}: /explore tier = ${expectTier}`, apiEx.json?.tier === expectTier, `ist ${apiEx.json?.tier}`);
  check(`${tierName}: /explore Cache-Control enthaelt private`, cc(apiEx).includes("private"), cc(apiEx));
  const spots: Loose[] = Array.isArray(apiEx.json?.spots) ? apiEx.json.spots : [];
  const apiLocked = lockedSlugs(apiEx.text);
  const webLocked = lockedSlugs(webEx.text);
  if (truth.proSpot) {
    const p = truth.proSpot;
    if (expectPro) {
      check(`${tierName}: Pro-Spot steht in der API-Liste`, spots.some((s) => s.slug === p.slug));
      check(`${tierName}: Pro-Spot steht im Web-HTML`, webEx.text.includes(p.slug));
      check(`${tierName}: keine locked-Slugs in der API`, apiLocked.size === 0, `${apiLocked.size} gefunden`);
    } else {
      check(`${tierName}: Pro-Slug nirgends im API-JSON`, !leaks(apiEx.text, p.slug));
      check(`${tierName}: Pro-Titel nirgends im API-JSON`, !leaks(apiEx.text, p.title));
      check(`${tierName}: Pro-Slug nirgends im Web-HTML`, !leaks(webEx.text, p.slug));
      check(`${tierName}: Pro-Titel nirgends im Web-HTML`, !leaks(webEx.text, p.title));
    }
  }
  if (!expectPro) {
    const lockedList = spots.filter((s) => typeof s.slug === "string" && s.slug.startsWith("locked-"));
    const coarse = lockedList.every((s) =>
      [s.lat, s.lng].every((v) => v == null || (typeof v === "number" && decimals(v) <= 2)),
    );
    check(`${tierName}: gesperrte Spots haben Position mit hoechstens 2 Nachkommastellen`, coarse,
      `${lockedList.length} gesperrte Spots`);
    check(`${tierName}: locked-Slugs in API == Web (${apiLocked.size} / ${webLocked.size})`,
      sameSet(apiLocked, webLocked));
  }
  const open = spots.filter((s) => typeof s.slug === "string" && !s.slug.startsWith("locked-"));
  const missing = open.filter((s) => !webEx.text.includes(s.slug)).length;
  check(`${tierName}: jeder offene API-Spot steht im Web-HTML (${open.length})`, missing === 0, `${missing} fehlen`);

  // b. spots
  if (truth.proSpot) {
    const p = truth.proSpot;
    const a = await apiGet(`/spots/${p.slug}?${L}`, auth);
    const w = await webGet(`/${LANG}/spot/${p.slug}`, cookie);
    check(`${tierName}: /spots/<Pro-Spot> 200 und tier = ${expectTier}`,
      a.status === 200 && a.json?.tier === expectTier, `Status ${a.status}`);
    check(`${tierName}: /spots/<Pro-Spot> Cache-Control enthaelt private`, cc(a).includes("private"), cc(a));
    const sp = a.json?.spot ?? {};
    if (expectPro) {
      check(`${tierName}: Pro-Spot locked = false`, sp.locked === false);
      check(`${tierName}: Pro-Spot Titel == DB`, sp.title === p.title);
      check(`${tierName}: Pro-Spot Titel steht im Web-HTML`, has(w.text, p.title), `Web ${w.status}`);
    } else {
      check(`${tierName}: Pro-Spot locked = true`, sp.locked === true);
      check(`${tierName}: Pro-Spot Titel ist maskiert`, typeof sp.title === "string" && sp.title !== p.title);
      check(`${tierName}: Pro-Spot insiderTip/general/route sind null`,
        sp.insiderTip == null && sp.general == null && sp.route == null);
      check(`${tierName}: Pro-Spot images leer`, Array.isArray(sp.images) && sp.images.length === 0);
      check(`${tierName}: Pro-Titel nirgends im API-JSON (Detail)`, !leaks(a.text, p.title));
      check(`${tierName}: Pro-Titel nirgends im Web-HTML (Detail)`, !leaks(w.text, p.title), `Web ${w.status}`);
    }
  }
  if (truth.freeSpot) {
    const f = truth.freeSpot;
    const a = await apiGet(`/spots/${f.slug}?${L}`, auth);
    const w = await webGet(`/${LANG}/spot/${f.slug}`, cookie);
    const sp = a.json?.spot ?? {};
    check(`${tierName}: freier Spot locked = false`, a.status === 200 && sp.locked === false, `Status ${a.status}`);
    check(`${tierName}: freier Spot Titel in API und Web-HTML`, sp.title === f.title && has(w.text, f.title),
      `Web ${w.status}`);
    check(`${tierName}: freier Spot Cache-Control enthaelt private`, cc(a).includes("private"), cc(a));
    if (f.hasRoute) {
      check(`${tierName}: freier Spot route nicht leer`, Array.isArray(sp.route) && sp.route.length > 0);
    }
  }

  // b2. Regale "Geheimtipps in der Naehe" (nearby) und "Aehnliche Spots" (similar)
  {
    const sample = [
      ...(truth.freeSpot ? [truth.freeSpot.slug] : []),
      ...open.map((s) => s.slug as string).filter((s) => s !== truth.freeSpot?.slug).slice(0, 3),
    ];
    let withNearby = 0;
    let withSimilar = 0;
    let shelfBad = 0;
    let webMismatch = 0;
    let secretLeak = 0;
    let proNotEmpty = 0;
    for (const slug of sample) {
      const a = await apiGet(`/spots/${slug}?${L}`, auth);
      const w = await webGet(`/${LANG}/spot/${slug}`, cookie);
      const nearby: Loose[] = a.json?.nearby ?? [];
      const similar: Loose[] = a.json?.similar ?? [];
      if (!Array.isArray(a.json?.nearby) || !Array.isArray(a.json?.similar)) shelfBad++;
      if (nearby.length) withNearby++;
      if (similar.length) withSimilar++;
      // Nearby: nur key + previewUrl, nie etwas Echtes.
      if (nearby.some((n) => Object.keys(n).sort().join() !== "key,previewUrl" || !/^nearby-\d$/.test(n.key))) secretLeak++;
      // Locked-Teaser in similar: keine echten Felder.
      for (const s of similar.filter((x) => x.locked)) {
        if (!String(s.slug).startsWith("locked-") || s.emoji != null || s.imageUrl != null ||
            s.shortDesc != null || s.imageAiOrigin != null) secretLeak++;
      }
      if (truth.proSpot && !expectPro && leaks(JSON.stringify({ nearby, similar }), truth.proSpot.title)) secretLeak++;
      if (expectPro) {
        if (nearby.length || similar.some((x) => x.locked)) proNotEmpty++;
      } else {
        // Web-Gleichheit: jede offene Karte steht im HTML, die Ueberschrift nur bei nearby (de).
        if (similar.some((x) => !x.locked && !w.text.includes(x.slug))) webMismatch++;
        if (LANG === "de" && w.status === 200 && w.text.includes("Geheimtipps in der Nähe</h2>") !== nearby.length > 0) webMismatch++;
        const prevs = [...nearby, ...similar.filter((x) => x.locked)].map((x) => x.previewUrl).filter(Boolean);
        if (w.status === 200 && prevs.some((u) => !w.text.includes(u) && !w.text.includes(encodeURIComponent(u)))) webMismatch++;
      }
    }
    check(`${tierName}: Regale nearby/similar sind Arrays (${sample.length} Spots)`, shelfBad === 0, `${shelfBad} ohne`);
    info(`${tierName}: ${withNearby} Spots mit nearby, ${withSimilar} mit similar`);
    check(`${tierName}: similar ist gefuellt`, withSimilar > 0);
    check(`${tierName}: Teaser enthalten keine echten Felder`, secretLeak === 0, `${secretLeak} Auffaelligkeiten`);
    if (expectPro) check(`${tierName}: Pro sieht keine gesperrten Regal-Eintraege`, proNotEmpty === 0, `${proNotEmpty} Spots`);
    else check(`${tierName}: Regale == Web-HTML (Karten, Ueberschrift, Vorschau)`, webMismatch === 0, `${webMismatch} Abweichungen`);
    if (truth.proSpot) {
      const a = await apiGet(`/spots/${truth.proSpot.slug}?${L}`, auth);
      if (!expectPro) {
        check(`${tierName}: gesperrter Spot liefert leere Regale`,
          Array.isArray(a.json?.nearby) && a.json.nearby.length === 0 && Array.isArray(a.json?.similar) && a.json.similar.length === 0);
      }
    }
  }

  // c. tours
  const aT = await apiGet(`/tours?${L}`, auth);
  const wT = await webGet(`/${LANG}/touren`, cookie);
  const apiSlugs = new Set<string>((aT.json?.tours ?? []).map((t: Loose) => t.slug));
  check(`${tierName}: /tours == veroeffentlichte Touren in der DB (${truth.tourSlugs.length})`,
    sameSet(apiSlugs, new Set(truth.tourSlugs)), `API ${apiSlugs.size}`);
  const notOnPage = truth.tourSlugs.filter((s) => !wT.text.includes(s)).length;
  check(`${tierName}: jede Tour steht im Web /touren`, notOnPage === 0, `${notOnPage} fehlen`);

  // d. tour details und Audio
  const tourCases: [string, TourTruth | null][] = [["Pro-Tour", truth.proTour], ["freie Tour", truth.freeTour]];
  for (const [label, t] of tourCases) {
    if (!t) { info(`${label}: gibt es nicht, uebersprungen`); continue; }
    const a = await apiGet(`/tours/${t.slug}?${L}`, auth);
    const w = await webGet(`/${LANG}/touren/${t.slug}`, cookie);
    check(`${tierName}: /tours/<${label}> 200, tier = ${expectTier}`,
      a.status === 200 && a.json?.tier === expectTier, `Status ${a.status}`);
    check(`${tierName}: /tours/<${label}> Cache-Control enthaelt no-store`, cc(a).includes("no-store"), cc(a));
    const pa = audioPaths(a.text);
    const pw = audioPaths(w.text);
    check(`${tierName}: ${label}: Audio-Pfade API == Web (${pa.size} / ${pw.size})`, sameSet(pa, pw),
      `Web ${w.status}`);
    if (label === "Pro-Tour") proAudioCounts[tierName] = pa.size;
  }

  // e/f. me
  const me = await apiGet("/me", auth);
  if (!token) {
    check(`${tierName}: /me ohne Token = 401`, me.status === 401 && me.json?.error === "auth", `Status ${me.status}`);
  } else {
    check(`${tierName}: /me 200`, me.status === 200, `Status ${me.status}`);
    check(`${tierName}: /me Cache-Control enthaelt no-store`, cc(me).includes("no-store"), cc(me));
    check(`${tierName}: /me canSeePro = ${expectPro}`, me.json?.canSeePro === expectPro, `ist ${me.json?.canSeePro}`);
    if (isUser) check(`${tierName}: /me email == Wegwerf-Adresse`, me.json?.email === tempEmail);
  }
}


// ── Phase 3: handelnde Routen und /live ───────────────────────────────────────
type LiveTruth = {
  activityWithCoords: string | null;
  lakeSpot: { slug: string; lake: string } | null;
  manualHours: string | null;
  anyHours: string | null;
};

async function loadLiveTruth(): Promise<LiveTruth> {
  const db = serviceClient();
  const pick = async (
    filter: (q: Loose) => Loose,
  ): Promise<Loose | null> => {
    const q = filter(
      db.from("spots").select("slug, type, lat, lng, lake_name, has_opening_hours, opening_hours_manual").eq("status", "published").eq("is_pro", false),
    ).order("slug").limit(1);
    const { data, error } = await q;
    if (error) throw new Error(`spots lesen (live): ${error.message}`);
    return (data?.[0] as Loose) ?? null;
  };
  const act = await pick((q) => q.eq("type", "activity").not("lat", "is", null).not("lng", "is", null));
  const lake = await pick((q) => q.not("lake_name", "is", null));
  const manual = await pick((q) => q.eq("has_opening_hours", true).eq("opening_hours_manual", true));
  const any = await pick((q) => q.eq("has_opening_hours", true));
  return {
    activityWithCoords: act?.slug ?? null,
    lakeSpot: lake ? { slug: lake.slug, lake: lake.lake_name } : null,
    manualHours: manual?.slug ?? null,
    anyHours: any?.slug ?? null,
  };
}

/** Zeilen in saved_items fuer (Nutzer, Spot), mit dem Service-Key gezaehlt. */
async function savedRows(userId: string, slug: string): Promise<number> {
  const svc = serviceClient();
  const { data: sp } = await svc.from("spots").select("id").eq("slug", slug).maybeSingle();
  const { data: lists } = await svc.from("saved_lists").select("id").eq("user_id", userId);
  const ids = (lists ?? []).map((l: Loose) => l.id as string);
  if (!sp || ids.length === 0) return 0;
  const { count } = await svc
    .from("saved_items")
    .select("id", { count: "exact", head: true })
    .in("list_id", ids)
    .eq("spot_id", sp.id);
  return count ?? 0;
}

const b64u = (b: Buffer) => b.toString("base64url");

async function runAppleUnit(): Promise<void> {
  head("9. Apple-Widerruf: Client-Secret offline (Wegwerf-EC-Schluessel)");
  const mod = await import("@/lib/apple-revoke");
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const cfg = { keyId: "KEYID12345", teamId: "TEAMID1234", privateKey: pem, clientId: "at.example.test" };
  const now = 1_800_000_000_000;
  const jwt = mod.buildAppleClientSecret(cfg, now);
  const parts = jwt.split(".");
  check("Client-Secret hat drei Teile", parts.length === 3);
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Loose;
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Loose;
  check("Header: alg ES256, kid, typ JWT", header.alg === "ES256" && header.kid === cfg.keyId && header.typ === "JWT");
  check("Claims: iss = Team-ID, sub = Client-ID, aud = Apple", claims.iss === cfg.teamId && claims.sub === cfg.clientId && claims.aud === "https://appleid.apple.com");
  check("Claims: iat = jetzt, exp hoechstens 10 Min danach", claims.iat === now / 1000 && claims.exp > claims.iat && claims.exp - claims.iat <= 600);
  const sig = Buffer.from(parts[2], "base64url");
  check("Signatur ist rohes r||s (64 Bytes), nicht DER", sig.length === 64);
  const verify = (data: string, signature: Buffer) =>
    createVerify("SHA256").update(data).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
  check("Signatur stimmt mit dem oeffentlichen Schluessel", verify(`${parts[0]}.${parts[1]}`, sig));
  const forged = b64u(Buffer.from(JSON.stringify({ ...claims, sub: "evil" })));
  check("veraenderte Claims: Signatur ungueltig", !verify(`${parts[0]}.${forged}`, sig));
  // createPrivateKey nimmt das PEM wie aus der ENV (mit echten Zeilenumbruechen).
  check("PEM laesst sich laden", createPrivateKey(pem).asymmetricKeyType === "ec");

  // Konfiguration: fehlende ENV = null, wortwoertliches "\n" wird zu Zeilenumbruechen.
  const names = ["APPLE_SIWA_KEY_ID", "APPLE_SIWA_TEAM_ID", "APPLE_SIWA_PRIVATE_KEY", "APPLE_SIWA_CLIENT_ID"] as const;
  const saved = names.map((n) => process.env[n]);
  try {
    for (const n of names) delete process.env[n];
    check("ohne ENV: appleSiwaConfig = null", mod.appleSiwaConfig() === null);
    const r0 = await mod.revokeAppleToken("dummy");
    check("ohne ENV: revokeAppleToken = not_configured (kein Netzaufruf)", r0.status === "not_configured");
    process.env.APPLE_SIWA_KEY_ID = cfg.keyId;
    process.env.APPLE_SIWA_TEAM_ID = cfg.teamId;
    process.env.APPLE_SIWA_CLIENT_ID = cfg.clientId;
    process.env.APPLE_SIWA_PRIVATE_KEY = pem.replace(/\n/g, "\\n");
    const c = mod.appleSiwaConfig();
    check("ENV mit \\n-Text: PEM wird wiederhergestellt", c?.privateKey === pem.trim());
    if (c) check("ENV-Konfiguration baut ein gueltiges Secret", mod.buildAppleClientSecret(c).split(".").length === 3);
    delete process.env.APPLE_SIWA_TEAM_ID;
    check("ein Wert fehlt: appleSiwaConfig = null", mod.appleSiwaConfig() === null);
  } finally {
    names.forEach((n, i) => {
      if (saved[i] === undefined) delete process.env[n];
      else process.env[n] = saved[i];
    });
  }
}

async function runNavVoice(): Promise<void> {
  head("13. /nav-voice");
  const r = await apiGet(`/nav-voice?lang=${LANG}`, null);
  check("nav-voice: Gast -> 200", r.status === 200, `Status ${r.status}`);
  check("nav-voice: Cache-Control private, no-store", (r.headers.get("cache-control") ?? "") === "private, no-store", r.headers.get("cache-control") ?? "");
  check("nav-voice: Form {lang, version, voice, prompts}", Object.keys(r.json ?? {}).sort().join() === "lang,prompts,version,voice", Object.keys(r.json ?? {}).join());
  check("nav-voice: kein ElevenLabs-Bezug in der Antwort", !/eleven_voice_id|elevenVoiceId|xi-api-key/i.test(r.text));
  const prompts: Loose[] = r.json?.prompts ?? [];
  if (r.json?.voice === null) {
    check("nav-voice: ohne aktive Stimme keine Clips", prompts.length === 0);
    info("keine aktive Ansage-Stimme, Link-Pruefung uebersprungen");
  } else {
    check("nav-voice: Stimme nur name/kind/personName", Object.keys(r.json?.voice ?? {}).sort().join() === "kind,name,personName", Object.keys(r.json?.voice ?? {}).join());
    if (prompts[0]) {
      const f = await fetch(prompts[0].url, { signal: AbortSignal.timeout(30_000) });
      check("nav-voice: signierter Link liefert Audio", f.status === 200 && (f.headers.get("content-type") ?? "").startsWith("audio"), `Status ${f.status}`);
    }
  }
  check("nav-voice: ?lang=xx -> 400 invalid", (await apiGet("/nav-voice?lang=xx", null)).status === 400);
}

async function runSaved(truth: Truth, user: TempUser, token: string): Promise<void> {
  head("10. Merkliste (/saved)");
  const L = `lang=${LANG}`;
  const free = truth.freeSpot;
  const pro = truth.proSpot;
  if (!free) { info("kein freier Spot, uebersprungen"); return; }
  await setProfile(user.id, { is_pro: false, role: "user" });
  info("Konto auf Nutzer ohne Pro zurueckgesetzt");
  const auth = bearer(token);

  // Zugriffsschutz
  for (const [m, p] of [["GET", `/saved?${L}`], ["PUT", `/saved/${free.slug}`], ["DELETE", `/saved/${free.slug}`]] as const) {
    const shown = p.replace(free.slug, "<frei>").replace(/\?.*/, "");
    for (const [label, value] of [["ohne Header", null], ["Bearer garbage", "Bearer garbage"], ["Anon-Key als Bearer", `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`]] as const) {
      const r = m === "GET" ? await apiGet(p, value) : await apiSend(m, p, value);
      check(`${m} ${shown}: ${label} -> 401 auth`, r.status === 401 && r.json?.error === "auth", `Status ${r.status}`);
    }
  }
  check("GET /saved?lang=xx -> 400 invalid", (await apiGet("/saved?lang=xx", auth)).status === 400);
  const nf = await apiSend("PUT", "/saved/does-not-exist-123", auth);
  check("PUT unbekannter Slug -> 404 not_found", nf.status === 404 && nf.json?.error === "not_found", `Status ${nf.status}`);
  const bad = await apiSend("PUT", "/saved/a%20b", auth);
  check("PUT Slug mit Leerzeichen -> 404 not_found", bad.status === 404 && bad.json?.error === "not_found", `Status ${bad.status}`);

  // Anfangszustand leer
  const g0 = await apiGet(`/saved?${L}`, auth);
  check("GET /saved: 200, no-store, Form { lang, slugs[], spots[] }",
    g0.status === 200 && cc(g0).includes("no-store") && g0.json?.lang === LANG && Array.isArray(g0.json?.slugs) && Array.isArray(g0.json?.spots),
    `Status ${g0.status} ${cc(g0)}`);
  check("GET /saved: anfangs leer", g0.json?.slugs?.length === 0 && g0.json?.spots?.length === 0);

  // PUT zweimal -> eine Zeile
  const p1 = await apiSend("PUT", `/saved/${free.slug}`, auth);
  const p2 = await apiSend("PUT", `/saved/${free.slug}`, auth);
  check("PUT zweimal: beide 200 { saved: true }", p1.status === 200 && p2.status === 200 && p1.json?.saved === true && p2.json?.saved === true, `${p1.status}/${p2.status}`);
  check("PUT: no-store", cc(p1).includes("no-store"), cc(p1));
  check("PUT zweimal: genau EINE Zeile in saved_items", (await savedRows(user.id, free.slug)) === 1);
  const g1 = await apiGet(`/saved?${L}`, auth);
  const sp1: Loose[] = g1.json?.spots ?? [];
  check("GET /saved listet den Spot (slugs und spots)", g1.json?.slugs?.includes(free.slug) && sp1.some((x) => x.slug === free.slug));
  check("GET /saved: Karte nie gesperrt, Titel == DB", sp1.every((x) => x.locked === false) && sp1.find((x) => x.slug === free.slug)?.title === free.title);

  // DELETE zweimal -> idempotent
  const d1 = await apiSend("DELETE", `/saved/${free.slug}`, auth);
  const d2 = await apiSend("DELETE", `/saved/${free.slug}`, auth);
  check("DELETE zweimal: beide 200 { saved: false }", d1.status === 200 && d2.status === 200 && d1.json?.saved === false && d2.json?.saved === false, `${d1.status}/${d2.status}`);
  check("DELETE: keine Zeile mehr", (await savedRows(user.id, free.slug)) === 0);
  check("GET /saved nach DELETE wieder leer", (await apiGet(`/saved?${L}`, auth)).json?.slugs?.length === 0);

  // Pro-Spot: Nicht-Pro -> 404, Pro -> ok
  if (pro) {
    const pn = await apiSend("PUT", `/saved/${pro.slug}`, auth);
    check("Nutzer ohne Pro: PUT Pro-Spot -> 404 not_found (wie unbekannt)", pn.status === 404 && pn.json?.error === "not_found", `Status ${pn.status}`);
    const dn = await apiSend("DELETE", `/saved/${pro.slug}`, auth);
    check("Nutzer ohne Pro: DELETE Pro-Spot -> 404 not_found", dn.status === 404 && dn.json?.error === "not_found", `Status ${dn.status}`);
    check("Nutzer ohne Pro: keine Zeile fuer den Pro-Spot", (await savedRows(user.id, pro.slug)) === 0);

    await setProfile(user.id, { is_pro: true });
    const pp = await apiSend("PUT", `/saved/${pro.slug}`, auth);
    check("Pro: PUT Pro-Spot -> 200 { saved: true }", pp.status === 200 && pp.json?.saved === true, `Status ${pp.status}`);
    const gp = await apiGet(`/saved?${L}`, auth);
    check("Pro: GET /saved enthaelt den Pro-Spot", gp.json?.slugs?.includes(pro.slug) && (gp.json?.spots ?? []).some((x: Loose) => x.slug === pro.slug && x.title === pro.title));
    // Pro entzogen (z.B. Erstattung): Der gemerkte Pro-Spot darf nicht mehr ausgeliefert werden.
    await setProfile(user.id, { is_pro: false });
    const gl = await apiGet(`/saved?${L}`, auth);
    check("Pro entzogen: Pro-Slug nirgends in GET /saved", !leaks(gl.text, pro.slug));
    check("Pro entzogen: Pro-Titel nirgends in GET /saved", !leaks(gl.text, pro.title));
    await setProfile(user.id, { is_pro: true });
    const dp = await apiSend("DELETE", `/saved/${pro.slug}`, auth);
    check("Pro: DELETE Pro-Spot -> 200 { saved: false }", dp.status === 200 && dp.json?.saved === false, `Status ${dp.status}`);
    check("Pro: keine Zeile mehr fuer den Pro-Spot", (await savedRows(user.id, pro.slug)) === 0);
    await setProfile(user.id, { is_pro: false });
  } else info("kein Pro-Spot, Pro-Faelle uebersprungen");

  // RLS mit einem zweiten Konto
  head("10b. Merkliste: RLS mit zwei Konten");
  const other = await createTempUser();
  extraUsers.push(other);
  info("zweites Wegwerf-Konto angelegt");
  const o1 = await apiSend("PUT", `/saved/${free.slug}`, bearer(other.session.access_token));
  check("Konto 2: PUT -> 200", o1.status === 200, `Status ${o1.status}`);
  const g2 = await apiGet(`/saved?${L}`, auth);
  check("Konto 1 sieht die Merkung von Konto 2 nicht (GET /saved leer)", g2.status === 200 && g2.json?.slugs?.length === 0 && g2.json?.spots?.length === 0);
  const rls1 = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  // Konto 1 braucht eine eigene Liste, damit "nur die eigene" etwas zu beweisen hat.
  const own = await apiSend("PUT", `/saved/${free.slug}`, auth);
  check("Konto 1: PUT -> 200", own.status === 200);
  const svc = serviceClient();
  const { data: lists } = await svc.from("saved_lists").select("id, user_id").in("user_id", [user.id, other.id]);
  const list1 = (lists ?? []).find((l: Loose) => l.user_id === user.id)?.id as string | undefined;
  const list2 = (lists ?? []).find((l: Loose) => l.user_id === other.id)?.id as string | undefined;
  check("beide Konten haben eine eigene Standardliste", !!list1 && !!list2 && list1 !== list2);
  const { data: rows, error: rerr } = await rls1.from("saved_items").select("list_id");
  const seen = (rows ?? []) as Loose[];
  check("Bearer-Client Konto 1: nur Zeilen der eigenen Liste sichtbar",
    !rerr && seen.length >= 1 && seen.every((r) => r.list_id === list1) && !seen.some((r) => r.list_id === list2),
    rerr ? rerr.message : `${seen.length} Zeilen`);
  const { data: lists1 } = await rls1.from("saved_lists").select("id");
  check("Bearer-Client Konto 1: nur die eigene Liste sichtbar", (lists1 ?? []).length === 1 && lists1?.[0]?.id === list1);
  // Fremde Liste beschreiben muss an der RLS scheitern.
  const { data: spRow } = await svc.from("spots").select("id").eq("slug", free.slug).maybeSingle();
  if (list2 && spRow) {
    const ins = await rls1.from("saved_items").insert({ list_id: list2, spot_id: spRow.id });
    check("Bearer-Client Konto 1: Einfuegen in fremde Liste wird abgelehnt", !!ins.error, "kein Fehler");
    const del = await rls1.from("saved_items").delete().eq("list_id", list2);
    check("Bearer-Client Konto 1: Loeschen in fremder Liste trifft nichts", !del.error && (await savedRows(other.id, free.slug)) === 1);
  }
  // Gast mit Anon-Key sieht gar nichts.
  const { data: anonRows } = await anonClient().from("saved_items").select("id");
  check("Anon-Client sieht keine Merkungen", (anonRows ?? []).length === 0);
  // Aufraeumen: Konto 1 entmerken (Konto 2 wird am Ende geloescht, Kaskade).
  await apiSend("DELETE", `/saved/${free.slug}`, auth);
}

async function runPatchMe(user: TempUser, token: string): Promise<void> {
  head("11. PATCH /me");
  const auth = bearer(token);
  const svc = serviceClient();
  const prof = async () => {
    const { data } = await svc.from("profiles").select("newsletter_opt_in, newsletter_opt_in_at, locale").eq("id", user.id).maybeSingle();
    return data as Loose;
  };

  for (const [label, value] of [["ohne Header", null], ["Bearer garbage", "Bearer garbage"]] as const) {
    const r = await apiSend("PATCH", "/me", value, { body: { newsletter: true } });
    check(`PATCH /me ${label} -> 401 auth`, r.status === 401 && r.json?.error === "auth", `Status ${r.status}`);
  }
  const invalid: [string, Parameters<typeof apiSend>[3]][] = [
    ["ohne Body", {}],
    ["leeres Objekt", { body: {} }],
    ["Sprache xx", { body: { locale: "xx" } }],
    ["Sprache keine Zeichenkette", { body: { locale: 5 } }],
    ["newsletter als Text", { body: { newsletter: "yes" } }],
    ["unbekanntes Feld", { body: { newsletter: true, role: "admin" } }],
    ["Array statt Objekt", { rawBody: "[]" }],
    ["kein JSON", { rawBody: "{nope", contentType: "application/json" }],
    ["falscher Content-Type", { rawBody: '{"newsletter":true}', contentType: "text/plain" }],
    ["zu gross", { body: { locale: "de", x: "a".repeat(5000) } }],
  ];
  for (const [label, opts] of invalid) {
    const r = await apiSend("PATCH", "/me", auth, opts);
    check(`PATCH /me ${label} -> 400 invalid`, r.status === 400 && r.json?.error === "invalid", `Status ${r.status}`);
  }
  const before = await prof();
  check("ungueltige Anfragen haben nichts veraendert", before?.newsletter_opt_in === false && before?.newsletter_opt_in_at == null);

  const on = await apiSend("PATCH", "/me", auth, { body: { newsletter: true } });
  check("newsletter: true -> 200, no-store", on.status === 200 && cc(on).includes("no-store"), `Status ${on.status} ${cc(on)}`);
  const shape = ["userId", "email", "canSeePro", "locale", "newsletter"];
  const getMe = await apiGet("/me", auth);
  check("PATCH-Antwort hat dieselben Felder wie GET /me",
    shape.every((k) => k in (on.json ?? {})) && Object.keys(on.json ?? {}).sort().join() === Object.keys(getMe.json ?? {}).sort().join());
  check("PATCH-Antwort: newsletter true, email unveraendert", on.json?.newsletter === true && on.json?.email === user.email);
  const p1 = await prof();
  const at = Date.parse(p1?.newsletter_opt_in_at ?? "");
  check("DB: newsletter_opt_in true mit frischem Zeitstempel", p1?.newsletter_opt_in === true && Number.isFinite(at) && Math.abs(Date.now() - at) < 120_000);
  const off = await apiSend("PATCH", "/me", auth, { body: { newsletter: false } });
  check("newsletter: false -> 200, newsletter false", off.status === 200 && off.json?.newsletter === false);
  const p0 = await prof();
  check("DB: Widerruf setzt den Zeitstempel zurueck auf null", p0?.newsletter_opt_in === false && p0?.newsletter_opt_in_at === null);

  const loc = await apiSend("PATCH", "/me", auth, { body: { locale: "en" } });
  check("locale: en -> 200 und locale en", loc.status === 200 && loc.json?.locale === "en", `Status ${loc.status}`);
  check("DB: profiles.locale = en", (await prof())?.locale === "en");
  check("GET /me liefert die neue Sprache", (await apiGet("/me", auth)).json?.locale === "en");
  const both = await apiSend("PATCH", "/me", auth, { body: { locale: "it", newsletter: true } });
  check("beide Felder zugleich", both.status === 200 && both.json?.locale === "it" && both.json?.newsletter === true);
  await apiSend("PATCH", "/me", auth, { body: { locale: "de", newsletter: false } });
  check("zurueck auf de / kein Newsletter", (await prof())?.locale === "de");
  // Rolle und Pro lassen sich ueber PATCH nicht setzen (Feld unbekannt -> 400, siehe oben); der
  // Privilegien-Trigger (0016) sperrt sie zusaetzlich in der DB.
  const rls = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  await rls.from("profiles").update({ is_pro: true, role: "admin" }).eq("id", user.id);
  const { data: priv } = await svc.from("profiles").select("is_pro, role").eq("id", user.id).maybeSingle();
  check("Bearer-Client kann is_pro/role nicht selbst setzen", (priv as Loose)?.is_pro === false && (priv as Loose)?.role === "user");
}

async function runLive(truth: Truth, user: TempUser, token: string): Promise<void> {
  head("12. /spots/{slug}/live");
  const L = `lang=${LANG}`;
  const live = await loadLiveTruth();
  const auth = bearer(token);
  const keys = (j: Loose) => Object.keys(j ?? {}).sort().join();

  const nf = await apiGet(`/spots/does-not-exist-123/live?${L}`, null);
  check("live: unbekannter Slug -> 404 not_found", nf.status === 404 && nf.json?.error === "not_found", `Status ${nf.status}`);
  if (truth.freeSpot) {
    const f = truth.freeSpot.slug;
    check("live: ?lang=xx -> 400 invalid", (await apiGet(`/spots/${f}/live?lang=xx`, null)).status === 400);
    const g = await apiGet(`/spots/${f}/live?${L}`, "Bearer garbage");
    check("live: Bearer garbage -> 401 auth", g.status === 401 && g.json?.error === "auth", `Status ${g.status}`);
  }

  await setProfile(user.id, { is_pro: false, role: "user" });
  if (truth.proSpot) {
    for (const [label, a] of [["Gast", null], ["Nutzer", auth]] as const) {
      const r = await apiGet(`/spots/${truth.proSpot.slug}/live?${L}`, a);
      check(`${label}: gesperrter Pro-Spot -> 200 mit weather/opening/waterTemp alle null`,
        r.status === 200 && keys(r.json) === "opening,waterTemp,weather" && r.json.weather === null && r.json.opening === null && r.json.waterTemp === null,
        `Status ${r.status}`);
      check(`${label}: gesperrter Pro-Spot: Cache-Control private, max-age=300`, cc(r) === "private, max-age=300", cc(r));
      check(`${label}: gesperrter Pro-Spot: Antwort nennt weder Slug noch Titel`, !leaks(r.text, truth.proSpot.slug) && !leaks(r.text, truth.proSpot.title));
    }
    await setProfile(user.id, { is_pro: true });
    const r = await apiGet(`/spots/${truth.proSpot.slug}/live?${L}`, auth);
    check("Pro: Pro-Spot -> 200, drei Felder vorhanden (Inhalt je nach Spot)",
      r.status === 200 && keys(r.json) === "opening,waterTemp,weather", `Status ${r.status}`);
    await setProfile(user.id, { is_pro: false });
  } else info("kein Pro-Spot, gesperrte Faelle uebersprungen");

  if (live.activityWithCoords) {
    const r = await apiGet(`/spots/${live.activityWithCoords}/live?${L}`, null);
    const days: Loose[] = r.json?.weather?.days ?? [];
    check("freier Aktiv-Spot: 200, Cache-Control private, max-age=300", r.status === 200 && cc(r) === "private, max-age=300", `Status ${r.status} ${cc(r)}`);
    check("freier Aktiv-Spot: Wetter mit Tagen { date, tempMax, tempMin, precip, code }",
      days.length > 0 && days.every((d) => typeof d.date === "string" && ["tempMax", "tempMin", "precip", "code"].every((k) => typeof d[k] === "number")),
      `${days.length} Tage`);
    check("Wetter beginnt heute oder spaeter (Europe/Vienna)", days.length > 0 && days[0].date >= new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(new Date()));
    check("live-Antwort verraet nichts ausser den drei Feldern", keys(r.json) === "opening,waterTemp,weather");
    check("live-Antwort enthaelt keine googlePlaceId", !/placeId|place_id|googlePlace/i.test(r.text));
  } else info("kein freier Aktiv-Spot mit Position, Wetter uebersprungen");

  if (live.lakeSpot) {
    const { getLakeReadingByName } = await import("@/lib/water-temp");
    const web = await getLakeReadingByName(live.lakeSpot.lake);
    const r = await apiGet(`/spots/${live.lakeSpot.slug}/live?${L}`, null);
    const wt = r.json?.waterTemp;
    if (web?.reading) {
      check("See-Spot: waterTemp == Web-Funktion (tempC, at, source)", wt?.tempC === web.reading.tempC && wt?.at === web.reading.at && wt?.source === web.reading.source && wt?.lake?.slug === web.lake.slug);
    } else {
      check("See-Spot: Web-Funktion hat keinen Wert -> API waterTemp null", r.status === 200 && wt === null, `Status ${r.status}`);
    }
  } else info("kein freier Spot mit lake_name, Wassertemperatur uebersprungen");

  const hoursSlug = live.manualHours ?? live.anyHours;
  if (hoursSlug) {
    const { computeStatus, viennaNowWM } = await import("@/lib/opening-hours");
    const r = await apiGet(`/spots/${hoursSlug}/live?${L}`, null);
    const o = r.json?.opening;
    if (live.manualHours) {
      check("Spot mit manuellen Zeiten: opening vorhanden, source manual, 7 Tage", !!o && o.source === "manual" && Array.isArray(o.week) && o.week.length === 7, `Status ${r.status}`);
    } else info("nur Google-Zeiten in der DB: opening kann ohne Places-Schluessel null sein");
    if (o) {
      const st = computeStatus(o.week, viennaNowWM(new Date()));
      check("opening.open == computeStatus (Web-Funktion)", o.open === st.open && o.changeAt === st.changeAt);
      check("opening: todayIndex 0..6, holidays hat 7 Eintraege", Number.isInteger(o.todayIndex) && o.todayIndex >= 0 && o.todayIndex <= 6 && Array.isArray(o.holidays) && o.holidays.length === 7);
    }
  } else info("kein freier Spot mit Oeffnungszeiten, uebersprungen");
}

async function runDeleteMe(truth: Truth): Promise<void> {
  head("13. DELETE /me");
  const victim = await createTempUser();
  extraUsers.push(victim);
  const token = victim.session.access_token;
  const auth = bearer(token);
  const svc = serviceClient();
  info("drittes Wegwerf-Konto angelegt");

  for (const [label, value] of [["ohne Header", null], ["Bearer garbage", "Bearer garbage"], ["Anon-Key als Bearer", `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`]] as const) {
    const r = await apiSend("DELETE", "/me", value);
    check(`DELETE /me ${label} -> 401 auth`, r.status === 401 && r.json?.error === "auth", `Status ${r.status}`);
  }
  // Nur ein echtes "nicht gefunden" heisst "weg"; jeder andere Fehler wirft, damit ein
  // Netzfehler nie als "Konto geloescht" durchgeht.
  const exists = async () => {
    const r = await svc.auth.admin.getUserById(victim.id);
    if (r.error) {
      if (r.error.status === 404 || r.error.code === "user_not_found") return false;
      throw new Error(`getUserById: ${r.error.message}`);
    }
    return !!r.data?.user;
  };
  for (const [label, opts] of [
    ["unbekanntes Feld", { body: { foo: 1 } }],
    ["Code keine Zeichenkette", { body: { appleAuthorizationCode: 5 } }],
    ["Code leer", { body: { appleAuthorizationCode: "" } }],
    ["Code zu lang", { body: { appleAuthorizationCode: "a".repeat(3000) } }],
  ] as [string, Parameters<typeof apiSend>[3]][]) {
    const r = await apiSend("DELETE", "/me", auth, opts);
    check(`DELETE /me ${label} -> 400 invalid`, r.status === 400 && r.json?.error === "invalid", `Status ${r.status}`);
  }
  check("abgelehnte Anfragen haben das Konto nicht geloescht", await exists());

  // Daten anlegen, die mit verschwinden muessen. Der Aufbau wird geprueft, sonst bewiese
  // "danach leer" nichts.
  if (truth.freeSpot) {
    const put = await apiSend("PUT", `/saved/${truth.freeSpot.slug}`, auth);
    check("Aufbau: PUT /saved -> 200", put.status === 200, `Status ${put.status}`);
    check("Aufbau: Merkung steht in saved_items", (await savedRows(victim.id, truth.freeSpot.slug)) === 1);
  }
  const nl = await apiSend("PATCH", "/me", auth, { body: { newsletter: true } });
  check("Aufbau: PATCH /me -> 200", nl.status === 200, `Status ${nl.status}`);
  const { error: usageErr } = await svc
    .from("ai_usage")
    .insert({ subject: `u:${victim.id}`, day: new Date().toISOString().slice(0, 10), count: 1 });
  check("Aufbau: ai_usage-Zeile eingefuegt", !usageErr, usageErr?.message ?? "");
  const { data: usageRow } = await svc.from("ai_usage").select("subject").eq("subject", `u:${victim.id}`);
  check("Aufbau: ai_usage-Zeile ist da", (usageRow ?? []).length === 1);

  const del = await apiSend("DELETE", "/me", auth);
  check("DELETE /me -> 200 { deleted: true, appleRevoked: null } (kein Apple-Konto), no-store",
    del.status === 200 && del.json?.deleted === true && del.json?.appleRevoked === null && cc(del).includes("no-store"), `Status ${del.status} ${cc(del)}`);
  check("auth.users: Konto ist weg", !(await exists()));
  const { data: pr } = await svc.from("profiles").select("id").eq("id", victim.id).maybeSingle();
  check("profiles: Zeile ist weg", !pr);
  const { data: sl } = await svc.from("saved_lists").select("id").eq("user_id", victim.id);
  check("saved_lists: keine Zeile mehr", (sl ?? []).length === 0);
  const { data: au } = await svc.from("ai_usage").select("subject").eq("subject", `u:${victim.id}`);
  check("ai_usage: keine Zeile mehr", (au ?? []).length === 0);
  const me = await apiGet("/me", auth);
  check("GET /me danach -> 401 auth", me.status === 401 && me.json?.error === "auth", `Status ${me.status}`);
  const again = await apiSend("DELETE", "/me", auth);
  check("DELETE /me ein zweites Mal -> 401 auth (Konto existiert nicht mehr)", again.status === 401 && again.json?.error === "auth", `Status ${again.status}`);
  if (truth.freeSpot) {
    const put = await apiSend("PUT", `/saved/${truth.freeSpot.slug}`, auth);
    check("PUT /saved danach -> 401 auth", put.status === 401 && put.json?.error === "auth", `Status ${put.status}`);
  }
}

// ── Hauptlauf ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  for (const v of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[v]) { console.error(`${v} fehlt (.env.local).`); process.exitCode = 2; return; }
  }

  head("0. Erreichbarkeit");
  try {
    const a = await apiGet(`/bootstrap?lang=${LANG}`);
    const w = await webGet(`/${LANG}`, null);
    if (!check("API erreichbar (/bootstrap 200)", a.status === 200, `Status ${a.status}`) ||
        !check("Web erreichbar (< 500)", w.status < 500, `Status ${w.status}`)) {
      console.log("\nAbbruch: Server nicht bereit.");
      return;
    }
    check("bootstrap: apiVersion 1, Kategorien ohne slug",
      a.json?.apiVersion === 1 && Array.isArray(a.json?.categories) &&
        a.json.categories.every((c: Loose) => !("slug" in c)));
  } catch (e) {
    console.log(`  FEHLT Server nicht erreichbar: ${(e as Error).message}`);
    failed++;
    return;
  }

  info(`liegengebliebene Wegwerf-Konten geloescht: ${await sweepTempUsers()}`);

  head("1. Ground Truth aus der Datenbank");
  const truth = await loadTruth();
  info(`freier Spot: ${truth.freeSpot ? `${truth.freeSpot.slug} (Route: ${truth.freeSpot.hasRoute})` : "keiner"}`);
  info(`Pro-Spot: ${truth.proSpot ? "vorhanden" : "KEINER"}`);
  info(`veroeffentlichte Touren: ${truth.tourSlugs.length}, Pro-Tour: ${truth.proTour ? `ja (free_stops ${truth.proTour.freeStops})` : "nein"}, freie Tour: ${truth.freeTour ? `${truth.freeTour.slug} (free_stops ${truth.freeTour.freeStops})` : "nein"}, Entwurf: ${truth.draft ? "ja" : "nein"}`);
  check("Ground Truth: freier Spot vorhanden", !!truth.freeSpot);
  check("Ground Truth: Pro-Spot vorhanden", !!truth.proSpot);

  head("2. Zugriffsschutz ohne Konto");
  const anyTour = truth.tourSlugs[0] ?? null;
  const paths: string[] = [`/bootstrap?lang=${LANG}`, `/explore?lang=${LANG}`, `/tours?lang=${LANG}`, `/me`];
  if (truth.freeSpot) paths.push(`/spots/${truth.freeSpot.slug}?lang=${LANG}`);
  if (anyTour) paths.push(`/tours/${anyTour}?lang=${LANG}`);
  const badHeaders: [string, string][] = [
    ["Bearer garbage", "Bearer garbage"],
    ["Bearer ohne Token", "Bearer"],
    ["Basic abc", "Basic abc"],
    ["Anon-Key als Bearer", `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`],
  ];
  for (const p of paths) {
    const shown = p.replace(/\/spots\/[^?]+/, "/spots/<frei>").replace(/\/tours\/[^?]+/, "/tours/<slug>").replace(/\?.*/, "");
    for (const [label, value] of badHeaders) {
      const r = await apiGet(p, value);
      check(`${shown}: ${label} -> 401 auth`, r.status === 401 && r.json?.error === "auth", `Status ${r.status}`);
    }
  }
  // Selbstgebaute Tokens: muessen OHNE Auth-Server-Roundtrip als 401 auth enden (nicht 503).
  {
    const b64 = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const hs = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "00000000-0000-0000-0000-000000000000", role: "authenticated", exp })}.${b64("sig")}`;
    const rnd = Math.random().toString(36).slice(2, 10);
    const sig = randomBytes(64).toString("base64url");
    const goodPayload = b64({ sub: randomUUID(), role: "authenticated", exp });
    // Wohlgeformt, aber die kid gibt es nicht: muss am kid-Abgleich enden, nicht an Muell im Payload.
    const es = `${b64({ alg: "ES256", typ: "JWT", kid: `nope-${rnd}` })}.${goodPayload}.${sig}`;
    // Payload-Segment ist gueltiges base64url, enthaelt aber ungueltiges UTF-8 (0xC3 0x28).
    const badUtf8 = Buffer.concat([Buffer.from('{"sub":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]).toString("base64url");
    const utf = `${b64({ alg: "ES256", typ: "JWT", kid: `nope-${rnd}` })}.${badUtf8}.${sig}`;
    // RS256 mit der ECHTEN kid des Projekts: der Algorithmus passt nicht zum Schluessel.
    const jr = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    const realKid = ((await jr.json()) as { keys?: { kid?: string }[] }).keys?.find((k) => k.kid)?.kid;
    check("JWKS des Projekts: echte kid gefunden", !!realKid);
    const rs = `${b64({ alg: "RS256", typ: "JWT", kid: realKid ?? "missing" })}.${goodPayload}.${sig}`;
    const fakes: [string, string][] = [
      ["Bearer abc.abc.abc", "Bearer abc.abc.abc"],
      ["HS256-Fake-Token", `Bearer ${hs}`],
      ["ES256 mit unbekannter kid", `Bearer ${es}`],
      ["Payload mit ungueltigem UTF-8", `Bearer ${utf}`],
      ["RS256 mit echter kid", `Bearer ${rs}`],
    ];
    for (const p of [`/explore?lang=${LANG}`, "/me"]) {
      for (const [label, value] of fakes) {
        const r = await apiGet(p, value);
        check(`${p.replace(/\?.*/, "")}: ${label} -> 401 auth`, r.status === 401 && r.json?.error === "auth", `Status ${r.status}`);
      }
    }
  }
  const meGuest = await apiGet("/me", null);
  check("/me ohne Header -> 401 auth", meGuest.status === 401 && meGuest.json?.error === "auth", `Status ${meGuest.status}`);
  for (const p of [`/bootstrap`, `/explore`, `/tours`, ...(truth.freeSpot ? [`/spots/${truth.freeSpot.slug}`] : [])]) {
    const r = await apiGet(`${p}?lang=xx`, null);
    check(`${p.replace(/\/spots\/.+/, "/spots/<frei>")}?lang=xx -> 400 invalid`,
      r.status === 400 && r.json?.error === "invalid", `Status ${r.status}`);
  }
  const nf = await apiGet(`/spots/does-not-exist-123?lang=${LANG}`, null);
  check("/spots/does-not-exist-123 -> 404 not_found", nf.status === 404 && nf.json?.error === "not_found", `Status ${nf.status}`);
  const nft = await apiGet(`/tours/does-not-exist-123?lang=${LANG}`, null);
  check("/tours/does-not-exist-123 -> 404 not_found", nft.status === 404 && nft.json?.error === "not_found", `Status ${nft.status}`);

  head("3. Wegwerf-Konto anlegen");
  const user = await createTempUser();
  tempUser = user;
  info("Konto angelegt (Adresse nicht ausgegeben), Sitzung erhalten");
  const token = user.session.access_token;
  const cookie = await webCookieHeader(user.session);
  info("Web-Cookies erzeugt");

  // Reihenfolge ist Absicht: Gast vor und nach Pro beweist, dass der Cache keine Pro-Fassung einfriert.
  await runTier("Gast", false, null, null, truth, user.email, false);
  await runTier("Nutzer", false, token, cookie, truth, user.email, true);
  await setProfile(user.id, { is_pro: true });
  info("is_pro gesetzt");
  await runTier("Pro", true, token, cookie, truth, user.email, true);
  await runTier("Gast (nochmal)", false, null, null, truth, user.email, false);

  head("4. Audio-Menge: gesperrte Stufen nicht mehr als Pro");
  if (truth.proTour) {
    const g = proAudioCounts["Gast"] ?? -1;
    const n = proAudioCounts["Nutzer"] ?? -1;
    const p = proAudioCounts["Pro"] ?? -1;
    info(`Pro-Tour Audio-Pfade: Gast ${g}, Nutzer ${n}, Pro ${p}`);
    check("Pro-Tour: Gast hat hoechstens so viele Audio-Pfade wie Pro", g >= 0 && g <= p);
    check("Pro-Tour: Nutzer hat hoechstens so viele Audio-Pfade wie Pro", n >= 0 && n <= p);
  } else info("keine Pro-Tour, uebersprungen");

  head("5. Manipulierter Token");
  {
    const parts = token.split(".");
    const sig = parts[2];
    const i = Math.floor(sig.length / 2);
    const flipped = sig.slice(0, i) + (sig[i] === "A" ? "B" : "A") + sig.slice(i + 1);
    const bad = [parts[0], parts[1], flipped].join(".");
    for (const p of ["/me", `/explore?lang=${LANG}`]) {
      const r = await apiGet(p, bearer(bad));
      check(`${p.replace(/\?.*/, "")}: Signatur veraendert -> 401 auth`, r.status === 401 && r.json?.error === "auth", `Status ${r.status}`);
    }
  }

  head("5b. RLS als echter Client");
  {
    const rls = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await rls.from("profiles").select("id");
    // Nie die Gesamtzahl der Profile ausgeben, nur zwei Ja/Nein-Aussagen.
    const own = !error && !!data?.some((r) => r.id === user.id);
    const others = !error && !!data?.some((r) => r.id !== user.id);
    check("profiles: genau die eigene Zeile sichtbar", own && !others,
      error ? error.message : `eigene Zeile: ${own ? "ja" : "nein"}, weitere Zeilen: ${others ? "ja" : "nein"}`);
  }

  head("6. Entwurf (Admin-Stufe)");
  if (truth.draft) {
    await setProfile(user.id, { role: "admin" });
    info("role = admin gesetzt");
    const d = truth.draft;
    const a = await apiGet(`/tours/${d.slug}?lang=${LANG}`, bearer(token));
    check("Admin: API /tours/<Entwurf> -> 404 (nie Entwuerfe)", a.status === 404 && a.json?.error === "not_found", `Status ${a.status}`);
    const aList = await apiGet(`/tours?lang=${LANG}`, bearer(token));
    check("Admin: Entwurf nicht in /tours", !(aList.json?.tours ?? []).some((t: Loose) => t.slug === d.slug));
    const wa = await webGet(`/${LANG}/touren/${d.slug}`, cookie);
    check("Admin: Web /touren/<Entwurf> -> 200", wa.status === 200, `Status ${wa.status}`);
    if (d.title) check("Admin: Web zeigt den Entwurf (Titel im HTML)", has(wa.text, d.title));
    const wg = await webGet(`/${LANG}/touren/${d.slug}`, null);
    // Mit loading.tsx kann der Status schon 200 sein, bevor notFound() greift: dann zaehlt der Inhalt.
    const hidden = wg.status === 404 || (d.title != null && !leaks(wg.text, d.title));
    check("Gast: Web /touren/<Entwurf> zeigt den Entwurf nicht", hidden, `Status ${wg.status}`);
    if (wg.status !== 404) info(`Gast-Web lieferte ${wg.status} statt 404 (Streaming), Inhalt ohne Entwurf`);
  } else info("kein Entwurf in der DB, uebersprungen");

  // Die DB hat keinen Entwurf, die End-zu-Ende-Pruefung in Abschnitt 6 faellt also aus.
  // Dass die Admin-Frage LAZY ist (nur bei Fehlschlag der Veroeffentlicht-Suche), gehoert
  // aber zum Vertrag (docs/41 4.2). Das beweisen wir hier im Prozess am echten Modul.
  head("8. Entwurfs-Vorschau: Admin-Frage nur bei Fehlschlag (im Prozess)");
  {
    let getTourDetailFor: ((slug: string, locale: string, canSeePro: boolean, isAdmin: () => Promise<boolean>) => Promise<unknown>) | null = null;
    try {
      ({ getTourDetailFor } = await import("@/lib/tours"));
    } catch (e) {
      check("Modul src/lib/tours.ts im Prozess ladbar", false, (e as Error).message);
    }
    if (getTourDetailFor) {
      const spy = (answer: boolean) => {
        const s = { calls: 0, fn: async () => { s.calls++; return answer; } };
        return s;
      };
      if (truth.proTour) {
        const s1 = spy(false);
        const r1 = await getTourDetailFor(truth.proTour.slug, LANG, false, s1.fn);
        check("veroeffentlichte Pro-Tour (ohne Pro): Ergebnis vorhanden", r1 != null);
        check("veroeffentlichte Pro-Tour (ohne Pro): Admin-Frage 0 Mal", s1.calls === 0, `${s1.calls} Aufrufe`);
        const s4 = spy(false);
        const r4 = await getTourDetailFor(truth.proTour.slug, LANG, true, s4.fn);
        check("veroeffentlichte Pro-Tour (mit Pro): Ergebnis vorhanden", r4 != null);
        check("veroeffentlichte Pro-Tour (mit Pro): Admin-Frage 0 Mal", s4.calls === 0, `${s4.calls} Aufrufe`);
      } else info("keine veroeffentlichte Pro-Tour, Fall 1 und 4 uebersprungen");
      const s2 = spy(false);
      const r2 = await getTourDetailFor("does-not-exist-123", LANG, false, s2.fn);
      check("unbekannter Slug (Admin-Frage false): Ergebnis null", r2 === null);
      check("unbekannter Slug (Admin-Frage false): Admin-Frage genau 1 Mal", s2.calls === 1, `${s2.calls} Aufrufe`);
      const s3 = spy(true);
      const r3 = await getTourDetailFor("does-not-exist-123", LANG, false, s3.fn);
      check("unbekannter Slug (Admin-Frage true): bleibt null", r3 === null);
      check("unbekannter Slug (Admin-Frage true): Admin-Frage genau 1 Mal", s3.calls === 1, `${s3.calls} Aufrufe`);
    }
  }

  // Phase 3. Jeder Abschnitt ist isoliert: Wirft einer (Netz, Datenbank), steht ein FEHLT
  // dafuer da, und die uebrigen laufen weiter.
  const section = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      check(`Abschnitt "${name}" ohne Ausnahme`, false, (e as Error).message);
    }
  };
  await section("Apple", () => runAppleUnit());
  await section("nav-voice", () => runNavVoice());
  await section("Merkliste", () => runSaved(truth, user, token));
  await section("PATCH /me", () => runPatchMe(user, token));
  await section("live", () => runLive(truth, user, token));
  await section("DELETE /me", () => runDeleteMe(truth));
}

try {
  await main();
} catch (e) {
  failed++;
  console.log(`\n  FEHLT Unerwarteter Fehler: ${(e as Error).message}`);
} finally {
  await cleanup();
  if (tempUser) {
    console.log(`\nWegwerf-Konto geloescht: ${deletedConfirmed ? "ja (bestaetigt)" : "NEIN, NICHT BESTAETIGT, bitte app-api-check+...@example.com im Supabase-Dashboard pruefen"}`);
    if (!deletedConfirmed) failed++;
  }
  console.log(failed ? `\n${failed} Pruefung(en) fehlgeschlagen, ${okCount} ok.` : `\nAlles gruen (${okCount} ok).`);
  process.exitCode = failed ? 1 : 0;
}
