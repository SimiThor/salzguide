// Prüft den Toni-Chat der App-API (POST/GET /api/app/v1/toni) gegen einen LAUFENDEN Server und
// das echte Supabase.
// Aufruf: npm run toni:check -- --base=http://localhost:3006 [--live=2]
//
// WAS GEPRÜFT WIRD
//  - Anmeldung: Gast braucht eine Geräte-ID, kaputtes Token = 401, anonymes Konto = 401.
//  - Eingabe: leer, zu lang, falsche Form = 400 invalid, keine Cookies nötig.
//  - Limits OHNE KI-Aufruf: Der Zähler wird vorab per Service-Key auf das Tageslimit gesetzt
//    (Gast 3, Gratis 5, Pro 15), die nächste Anfrage muss 402 mit dem richtigen scope liefern.
//    So kostet die Prüfung nichts. Dazu: Burst-Limit (429), Tageszähler wird geteilt (die
//    Web-Route /api/ai/chat meldet für dasselbe Konto ebenfalls 402).
//  - Status (GET): Limit und "noch X heute" je Stufe, ohne den Zähler zu verändern.
//  - Live (--live=N, Standard 2, 0 = aus): echte Anthropic-Aufrufe, KOSTEN GELD. Gratis-Konto:
//    Antwort mit aiGenerated, remaining zählt herunter, KEINE Pro-Spots in den Karten. Pro-Konto:
//    Antwort kommt, Limit 15.
// Wegwerf-Konten (app-api-check+...@example.com) und Zähler werden IMMER wieder gelöscht.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  anonClient,
  createTempUser,
  deleteTempUser,
  serviceClient,
  setProfile,
  webCookieHeader,
} from "./lib/temp-user.ts";
import type { TempUser } from "./lib/temp-user.ts";

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
const info = (m: string) => console.log(`  ..    ${m}`);
const head = (m: string) => console.log(`\n${m}`);

function arg(name: string): string | null {
  const p = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : null;
}
const base = (arg("base") ?? "").replace(/\/+$/, "");
if (!base) {
  console.error("--base fehlt. Beispiel: npm run toni:check -- --base=http://localhost:3006");
  process.exit(2);
}
const liveCalls = Number(arg("live") ?? "2");
// --save=Datei: die erste Live-Antwort als Fixture ablegen (für die Tests der App).
const savePath = arg("save");

const GUEST_LIMIT = 3;
const FREE_LIMIT = 5;
const PRO_LIMIT = 15;

type Res = { status: number; json: Record<string, unknown> | null; headers: Headers };
async function call(
  method: "GET" | "POST",
  path: string,
  opts: { token?: string | null; device?: string | null; body?: unknown; rawBody?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.device) headers["x-sg-device"] = opts.device;
  let body: string | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    headers["content-type"] = "application/json";
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${base}${path}`, { method, headers, body });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json, headers: res.headers };
}
const ask = (text: string, o: { token?: string | null; device?: string | null } = {}) =>
  call("POST", "/api/app/v1/toni?lang=de", {
    ...o,
    body: { messages: [{ role: "user", content: text }] },
  });

const svc = serviceClient();
const subjects: string[] = [];
const users: TempUser[] = [];

async function setUsage(subject: string, count: number) {
  subjects.push(subject);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const { error } = await svc
    .from("ai_usage")
    .upsert({ subject, day, count, updated_at: new Date().toISOString() });
  if (error) throw new Error(`ai_usage setzen: ${error.message}`);
}
async function clearBurst(subject: string) {
  // hit_ai_burst legt Zeilen in ai_burst an; für den nächsten Teilabschnitt zurücksetzen.
  await svc.from("ai_burst").delete().eq("subject", subject);
}

async function main() {
  const free = await createTempUser();
  users.push(free);
  const pro = await createTempUser();
  users.push(pro);
  await setProfile(pro.id, { is_pro: true });

  head("1 Anmeldung und Eingabe");
  const noDev = await ask("Hallo");
  check("Gast ohne Geräte-ID = 400 invalid", noDev.status === 400 && noDev.json?.error === "invalid");
  const badDev = await ask("Hallo", { device: "nicht-eine-uuid" });
  check("Gast mit kaputter Geräte-ID = 400", badDev.status === 400);
  const badTok = await ask("Hallo", { token: "abc.def.ghi" });
  check("kaputtes Token = 401 auth", badTok.status === 401 && badTok.json?.error === "auth");
  const getBad = await call("GET", "/api/app/v1/toni?lang=de", { token: "abc.def.ghi" });
  check("GET mit kaputtem Token = 401", getBad.status === 401);
  const lang = await call("POST", "/api/app/v1/toni?lang=xx", {
    device: randomUUID(),
    body: { messages: [{ role: "user", content: "Hi" }] },
  });
  check("unbekannte Sprache = 400", lang.status === 400);

  const anon = await anonClient().auth.signInAnonymously();
  if (anon.data?.session) {
    const r = await ask("Hallo", { token: anon.data.session.access_token });
    check("anonyme Anmeldung = 401 (kein KI-Aufruf)", r.status === 401, `status ${r.status}`);
    if (anon.data.user) await svc.auth.admin.deleteUser(anon.data.user.id);
  } else {
    info("anonyme Anmeldungen sind im Projekt aus: Fall nicht prüfbar (und im Web nicht vorhanden)");
  }

  const tok = free.session.access_token;
  const empty = await call("POST", "/api/app/v1/toni?lang=de", {
    token: tok,
    body: { messages: [] },
  });
  check("leerer Verlauf = 400", empty.status === 400);
  const longMsg = await ask("x".repeat(801), { token: tok });
  check("zu lange Nachricht = 400", longMsg.status === 400);
  const wrongShape = await call("POST", "/api/app/v1/toni?lang=de", {
    token: tok,
    body: { messages: "Hallo" },
  });
  check("falsche Form = 400", wrongShape.status === 400);
  const badConv = await call("POST", "/api/app/v1/toni?lang=de", {
    token: tok,
    body: { messages: [{ role: "user", content: "Hi" }], conversationId: 5 },
  });
  check("conversationId keine Zeichenkette = 400", badConv.status === 400);
  const junk = await call("POST", "/api/app/v1/toni?lang=de", { token: tok, rawBody: "{nope" });
  check("kaputtes JSON = 400", junk.status === 400);
  const big = await call("POST", "/api/app/v1/toni?lang=de", {
    token: tok,
    rawBody: JSON.stringify({ messages: [{ role: "user", content: "a".repeat(120_000) }] }),
  });
  check("Body über 100 KB = 400", big.status === 400);

  head("2 Status (GET) je Stufe, ohne zu zählen");
  await setUsage(`u:${free.id}`, 2);
  await setUsage(`u:${pro.id}`, 0);
  const sFree = await call("GET", "/api/app/v1/toni?lang=de", { token: tok });
  check(
    "Gratis: scope free, Limit 5, noch 3",
    sFree.status === 200 && sFree.json?.scope === "free" && sFree.json?.limit === FREE_LIMIT && sFree.json?.remaining === 3,
    JSON.stringify(sFree.json),
  );
  const sFree2 = await call("GET", "/api/app/v1/toni?lang=de", { token: tok });
  check("GET zählt nicht (zweimal derselbe Stand)", sFree2.json?.remaining === 3);
  const sPro = await call("GET", "/api/app/v1/toni?lang=de", { token: pro.session.access_token });
  check(
    "Pro: scope pro, Limit 15, noch 15",
    sPro.json?.scope === "pro" && sPro.json?.limit === PRO_LIMIT && sPro.json?.remaining === PRO_LIMIT,
    JSON.stringify(sPro.json),
  );
  const gdev = randomUUID();
  const sGuest = await call("GET", "/api/app/v1/toni?lang=de", { device: gdev });
  check(
    "Gast: scope guest, Limit 3, noch 3",
    sGuest.json?.scope === "guest" && sGuest.json?.limit === GUEST_LIMIT && sGuest.json?.remaining === GUEST_LIMIT,
    JSON.stringify(sGuest.json),
  );
  check("Status ist no-store", (sFree.headers.get("cache-control") ?? "").includes("no-store"));

  head("3 Tageslimit je Stufe (402, ohne KI-Aufruf)");
  await setUsage(`g:${gdev}`, GUEST_LIMIT);
  const lg = await ask("Hallo", { device: gdev });
  check("Gast am Limit = 402 scope guest", lg.status === 402 && lg.json?.error === "limit" && lg.json?.scope === "guest", JSON.stringify(lg.json));
  await setUsage(`u:${free.id}`, FREE_LIMIT);
  const lf = await ask("Hallo", { token: tok });
  check("Gratis am Limit = 402 scope free", lf.status === 402 && lf.json?.scope === "free", JSON.stringify(lf.json));
  await setUsage(`u:${pro.id}`, PRO_LIMIT);
  const lp = await ask("Hallo", { token: pro.session.access_token });
  check("Pro am Limit = 402 scope pro", lp.status === 402 && lp.json?.scope === "pro", JSON.stringify(lp.json));
  const after = await call("GET", "/api/app/v1/toni?lang=de", { token: tok });
  check("nach dem Limit: GET zeigt noch 0", after.json?.remaining === 0, JSON.stringify(after.json));
  const gone = lg.json && !("text" in lg.json) && !("cards" in lg.json);
  check("402 enthält keinen Antworttext und keine Karten", Boolean(gone));

  head("4 Zähler wird mit dem Web geteilt");
  try {
    const cookie = await webCookieHeader(free.session);
    const wres = await fetch(`${base}/api/ai/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hallo" }], locale: "de" }),
    });
    const wj = (await wres.json().catch(() => null)) as { error?: string; scope?: string } | null;
    check(
      "Web-Route sieht denselben Stand: 402 scope free",
      wres.status === 402 && wj?.error === "limit" && wj?.scope === "free",
      `status ${wres.status} ${JSON.stringify(wj)}`,
    );
  } catch (e) {
    check("Web-Route erreichbar", false, String(e));
  }

  head("5 Burst-Limit (429)");
  const burstDev = randomUUID();
  await setUsage(`g:${burstDev}`, GUEST_LIMIT);
  await clearBurst(`g:${burstDev}`);
  const codes: number[] = [];
  for (let i = 0; i < 8; i++) codes.push((await ask("Hallo", { device: burstDev })).status);
  check(
    "ab der 7. Anfrage in einer Minute 429 rate_limit",
    codes.slice(0, 6).every((c) => c === 402) && codes.slice(6).every((c) => c === 429),
    codes.join(","),
  );
  await clearBurst(`g:${burstDev}`);

  head("6 Live (echte KI-Aufrufe)");
  if (liveCalls <= 0) {
    info("übersprungen (--live=0)");
  } else {
    // Gratis-Konto: Zähler auf 0, eine echte Frage nach Geheimtipps.
    await setUsage(`u:${free.id}`, 0);
    await clearBurst(`u:${free.id}`);
    const r = await ask("Ein Badesee zum Abkühlen und wie warm ist das Wasser gerade?", { token: tok });
    check("Gratis: 200 mit Text", r.status === 200 && typeof r.json?.text === "string" && (r.json.text as string).length > 10, `status ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    if (r.status === 200 && r.json) {
      if (savePath) writeFileSync(savePath, JSON.stringify(r.json, null, 2));
      check("aiGenerated true und X-AI-Generated-Header", r.json.aiGenerated === true && r.headers.get("x-ai-generated") === "true");
      check("remaining zählt herunter (4 von 5)", r.json.remaining === FREE_LIMIT - 1 && r.json.limit === FREE_LIMIT, JSON.stringify({ rem: r.json.remaining, lim: r.json.limit }));
      check("kein Gedankenstrich im Text", !/[—–]/.test(String(r.json.text)));
      const cards = (r.json.cards ?? {}) as { spots?: { slug: string }[] };
      const slugs = (cards.spots ?? []).map((s) => s.slug);
      info(`${slugs.length} Spot-Karten`);
      const { data: proRows } = await svc.from("spots").select("slug").eq("is_pro", true);
      const proSet = new Set((proRows ?? []).map((x: { slug: string }) => x.slug));
      check("Gratis: keine Pro-Spots in den Karten", slugs.every((s) => !proSet.has(s) && !s.startsWith("locked-")));
      const text = String(r.json.text);
      check("Gratis: kein Pro-Spot-Slug im Antworttext", ![...proSet].some((s) => text.includes(`/spot/${s}`)));
      check("Verlauf gespeichert (conversationId)", typeof r.json.conversationId === "string");
      const used = await svc.from("ai_usage").select("count").eq("subject", `u:${free.id}`).maybeSingle();
      check("Zähler im Web-Schlüssel u:<id> = 1", used.data?.count === 1, JSON.stringify(used.data));
    }
  }
  if (liveCalls >= 2) {
    await setUsage(`u:${pro.id}`, 0);
    await clearBurst(`u:${pro.id}`);
    const r = await ask("Ein ruhiger Spot für heute Abend?", { token: pro.session.access_token });
    check("Pro: 200 mit Text, Limit 15, noch 14", r.status === 200 && r.json?.scope === "pro" && r.json?.limit === PRO_LIMIT && r.json?.remaining === PRO_LIMIT - 1, `status ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  }
}

async function cleanup() {
  for (const s of subjects) await svc.from("ai_usage").delete().eq("subject", s);
  for (const s of subjects) await svc.from("ai_burst").delete().eq("subject", s);
  let allGone = true;
  for (const u of users) allGone = (await deleteTempUser(u.id).catch(() => false)) && allGone;
  console.log(`\nWegwerf-Konten gelöscht: ${allGone ? "ja" : "NEIN, bitte prüfen"}`);
}
let cleaned = false;
async function finish() {
  if (cleaned) return;
  cleaned = true;
  await cleanup().catch((e) => console.log("Aufräumen fehlgeschlagen:", e));
}
process.on("SIGINT", () => void finish().then(() => process.exit(130)));
process.on("SIGTERM", () => void finish().then(() => process.exit(143)));

try {
  await main();
} catch (e) {
  failed++;
  console.log("Abbruch:", e);
} finally {
  await finish();
}
console.log(`\n${okCount} ok, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
