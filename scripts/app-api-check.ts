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
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  createTempUser,
  setProfile,
  webCookieHeader,
  deleteTempUser,
  sweepTempUsers,
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

async function cleanup(): Promise<void> {
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
