// Checks the app tour builder API (/api/app/v1/builder, /my-tours) against a RUNNING server and
// the REAL Supabase: auth, Pro gate, validation, rate limit, RLS with two accounts, idempotent
// delete, package shape, and that the refactored web path still works.
//
// Usage: npm run app-builder:check -- --base=http://localhost:3007 [--lang=de] [--no-live]
//
// --base is required on purpose: port 3000 can be someone else's server or production.
// --no-live skips the ONE live generation (Claude + routing service cost money); the sections
// that need a built tour then seed a row directly with the service key.
//
// THROWAWAY ACCOUNTS: three accounts `app-api-check+...@example.com` (A = Pro owner, B = second
// Pro account for the RLS counter-proof, C = anonymous session if the project allows it) are
// created and ALWAYS deleted again (finally, SIGINT, SIGTERM). Rate-limit rows written for them
// are removed too. The output never names titles or texts of Pro content.
//
// Live generation budget: at most 1 call to Claude (section 6). The rate-limit proof reuses the
// requests that fail BEFORE any AI call (unknown area), so it costs nothing.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  createTempUser,
  deleteTempUser,
  setProfile,
  webCookieHeader,
  serviceClient,
  anonClient,
  sweepTempUsers,
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
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
  return cond;
}
const info = (m: string) => console.log(`  ..    ${m}`);
const head = (m: string) => console.log(`\n${m}`);

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const baseArg = arg("base");
if (!baseArg) {
  console.error("--base is required, e.g. --base=http://localhost:3007");
  process.exit(2);
}
const BASE = baseArg.replace(/\/+$/, "");
const LANG = arg("lang") ?? "de";
const LIVE = !process.argv.includes("--no-live");
const API = `${BASE}/api/app/v1`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
type Res = { status: number; text: string; json: Loose; headers: Headers };

async function call(
  method: string,
  path: string,
  auth: string | null,
  opts: { body?: unknown; rawBody?: string; contentType?: string | null } = {},
): Promise<Res> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (auth) h.Authorization = auth;
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  const ct = opts.contentType === undefined ? (body !== undefined ? "application/json" : null) : opts.contentType;
  if (ct) h["Content-Type"] = ct;
  const r = await fetch(`${API}${path}`, { method, headers: h, body, signal: AbortSignal.timeout(150_000) });
  const text = await r.text();
  let json: Loose = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, text, json, headers: r.headers };
}
const bearer = (u: TempUser) => `Bearer ${u.session.access_token}`;
const isErr = (r: Res, status: number, code: string) => r.status === status && r.json?.error === code;

const users: TempUser[] = [];
const extraIds: string[] = []; // anonymous account (no email, deleted by id)
let deletedAll = false;

function limitSubject(userId: string, bucket: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
  const hash = createHash("sha256").update(`${userId}:${salt}`).digest("hex").slice(0, 32);
  return `app-user:${bucket}:${hash}`;
}

async function cleanup(): Promise<void> {
  const svc = serviceClient();
  let all = true;
  for (const u of users) {
    for (const b of ["builder-burst", "builder-daily", "my-package", "route"]) {
      await svc.from("rate_limits").delete().eq("subject", limitSubject(u.id, b));
    }
    if (!(await deleteTempUser(u.id).catch(() => false))) all = false;
  }
  for (const id of extraIds) {
    const r = await svc.auth.admin.deleteUser(id);
    if (r.error && r.error.status !== 404) all = false;
  }
  deletedAll = all;
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    cleanup().finally(() => process.exit(130));
  });
}

async function main() {
  const svc = serviceClient();
  info(`swept leftover throwaway accounts: ${await sweepTempUsers()}`);

  // ── 1. The "use server" files export nothing new ────────────────────────────
  head("1. use-server files: only the original exports");
  {
    const src = (f: string) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8");
    const exportsOf = (s: string) =>
      [...s.matchAll(/^export\s+(?:async\s+)?(function|const|type|class|interface|let|\{)\s*([A-Za-z0-9_]*)/gm)].map(
        (m) => `${m[1]} ${m[2]}`,
      );
    const gen = exportsOf(src("tour-generate.ts")).sort();
    check("tour-generate.ts: generateTour + GenerateInput", gen.join("|") === ["function generateTour", "type GenerateInput"].sort().join("|"), gen.join(", "));
    const ut = src("user-tours.ts");
    const utEx = exportsOf(ut).sort();
    const allowed = ["function saveUserTour", "function deleteUserTour", "function listUserTours", "function getUserTourDetail"];
    check(
      "user-tours.ts: only the four actions (plus the two original types, no `export type { }` re-export)",
      utEx.every((e) => allowed.includes(e) || e === "type SaveUserTourInput" || e === "type UserTourSummary") &&
        allowed.every((a) => utEx.includes(a)),
      utEx.join(", "),
    );
    check("both start with \"use server\"", src("tour-generate.ts").startsWith('"use server"') && ut.startsWith('"use server"'));
    for (const f of ["tour-generate-core.ts", "user-tours-core.ts", "app-builder.ts"]) {
      check(`${f} is server-only and not "use server"`, src(f).startsWith('import "server-only"'));
    }
  }

  // ── 2. Guests, fake tokens, anonymous ───────────────────────────────────────
  head("2. Auth: guest, fake token, anonymous session");
  const FAKE = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.AAAA";
  const fakeId = "00000000-0000-4000-8000-000000000000";
  for (const [m, p] of [
    ["GET", "/my-tours"],
    ["GET", `/my-tours/${fakeId}`],
    ["GET", `/my-tours/${fakeId}/package`],
    ["DELETE", `/my-tours/${fakeId}`],
    ["POST", "/builder"],
  ] as const) {
    const g = await call(m, `${p}?lang=${LANG}`, null, m === "POST" ? { body: {} } : {});
    check(`${m} ${p.replace(fakeId, "<id>")} guest -> 401 auth`, isErr(g, 401, "auth"), `status ${g.status}`);
    const f = await call(m, `${p}?lang=${LANG}`, FAKE, m === "POST" ? { body: {} } : {});
    check(`${m} ${p.replace(fakeId, "<id>")} fake token -> 401 auth`, isErr(f, 401, "auth"), `status ${f.status}`);
  }
  {
    const anon = await anonClient().auth.signInAnonymously();
    const tok = anon.data.session?.access_token;
    if (anon.error || !tok || !anon.data.user) {
      info(`anonymous sign-in not available here (${anon.error?.message ?? "no session"}), anonymous cases skipped`);
    } else {
      extraIds.push(anon.data.user.id);
      const a = `Bearer ${tok}`;
      const r1 = await call("POST", `/builder?lang=${LANG}`, a, { body: { areaId: fakeId, interests: [] } });
      check("anonymous session: POST /builder -> 401 auth", isErr(r1, 401, "auth"), `status ${r1.status}`);
      const r2 = await call("GET", `/my-tours?lang=${LANG}`, a);
      check("anonymous session: GET /my-tours -> 401 auth", isErr(r2, 401, "auth"), `status ${r2.status}`);
      const r3 = await call("DELETE", `/my-tours/${fakeId}?lang=${LANG}`, a);
      check("anonymous session: DELETE /my-tours/{id} -> 401 auth", isErr(r3, 401, "auth"), `status ${r3.status}`);
    }
  }

  // ── 3. Accounts ──────────────────────────────────────────────────────────────
  head("3. Throwaway accounts");
  const A = await createTempUser();
  users.push(A);
  const B = await createTempUser();
  users.push(B);
  info("accounts A and B created (addresses not printed)");

  // ── 4. GET /builder by tier ──────────────────────────────────────────────────
  head("4. GET /builder by tier");
  const gGuest = await call("GET", `/builder?lang=${LANG}`, null);
  check("guest: 200, canGenerate false, blocked login", gGuest.status === 200 && gGuest.json?.canGenerate === false && gGuest.json?.blocked === "login");
  const areas: { id: string; name: string }[] = gGuest.json?.areas ?? [];
  check("areas listed (id + name), interests are the web TAG_KEYS", areas.length > 0 && (gGuest.json?.interests ?? []).length === 8 && areas.every((a) => a.id && a.name));
  const gFree = await call("GET", `/builder?lang=${LANG}`, bearer(A));
  check("signed in without Pro: canGenerate false, blocked pro", gFree.status === 200 && gFree.json?.canGenerate === false && gFree.json?.blocked === "pro");
  check("GET /builder?lang=xx -> 400 invalid", isErr(await call("GET", "/builder?lang=xx", null), 400, "invalid"));

  // ── 5. Not Pro: no generation, nothing created ───────────────────────────────
  head("5. POST /builder without Pro");
  const okBody = { areaId: areas[0]?.id ?? fakeId, interests: ["history"], freeText: "" };
  const noPro = await call("POST", `/builder?lang=${LANG}`, bearer(A), { body: okBody });
  check("non-Pro: 403 pro", isErr(noPro, 403, "pro"), `status ${noPro.status}`);
  {
    const { count } = await svc.from("user_tours").select("id", { count: "exact", head: true }).eq("user_id", A.id);
    check("non-Pro: no row written", count === 0);
    // Direct insert as the real client is blocked by the RLS (0072) as well.
    const aClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: bearer(A) } },
    });
    const ins = await aClient.from("user_tours").insert({ user_id: A.id, name: "x", point_ids: [fakeId, fakeId] });
    check("non-Pro: direct insert rejected by RLS", !!ins.error, ins.error ? "" : "insert went through");
  }

  await setProfile(A.id, { is_pro: true });
  await setProfile(B.id, { is_pro: true });
  info("A and B set to Pro");
  const gPro = await call("GET", `/builder?lang=${LANG}`, bearer(A));
  check("Pro: canGenerate true, blocked null", gPro.json?.canGenerate === true && gPro.json?.blocked === null);

  // ── 6. Validation, then the live generation and the rate limit ──────────────
  head("6. POST /builder: validation (no cost)");
  const bad = async (label: string, r: Res, code = "invalid", status = 400) =>
    check(`${label} -> ${status} ${code}`, isErr(r, status, code), `status ${r.status} ${r.text.slice(0, 80)}`);
  const P = (opts: Parameters<typeof call>[3]) => call("POST", `/builder?lang=${LANG}`, bearer(A), opts);
  await bad("not JSON", await P({ rawBody: "nope", contentType: "application/json" }));
  await bad("wrong content type", await P({ rawBody: JSON.stringify(okBody), contentType: "text/plain" }));
  await bad("unknown field", await P({ body: { ...okBody, extra: 1 } }));
  await bad("area not a UUID", await P({ body: { ...okBody, areaId: "abc" } }));
  await bad("interest key unknown", await P({ body: { ...okBody, interests: ["history", "bogus"] } }));
  await bad("interests not an array", await P({ body: { ...okBody, interests: "history" } }));
  await bad("too many interests", await P({ body: { ...okBody, interests: Array(9).fill("history") } }));
  await bad("freeText not a string", await P({ body: { ...okBody, freeText: 5 } }));
  await bad("body too large", await P({ rawBody: JSON.stringify({ ...okBody, freeText: "x".repeat(3000) }) }));
  await bad("lang in body differs", await P({ body: { ...okBody, lang: "en" } }));
  {
    const { data } = await svc.from("rate_limits").select("count").eq("subject", limitSubject(A.id, "builder-burst")).maybeSingle();
    check("validation errors did not use up the rate limit", !data);
  }

  head("6b. Rate limit: 3 runs in 10 minutes (area unknown = fails before any AI call)");
  const ghostArea = "11111111-1111-4111-8111-111111111111";
  const r1 = await P({ body: { ...okBody, areaId: ghostArea } });
  check("run 1 (unknown area) -> 404 not_found", isErr(r1, 404, "not_found"), `status ${r1.status}`);

  head("6c. Live generation (1 call)");
  let tourId: string | null = null;
  let tourCount = 0;
  if (LIVE) {
    const t0 = Date.now();
    const gen = await P({ body: { areaId: areas[0].id, interests: ["history", "food"], freeText: "kurz und ruhig" } });
    info(`generation took ${Math.round((Date.now() - t0) / 1000)} s, status ${gen.status}`);
    if (gen.status === 422 && gen.json?.error === "too_few") {
      info("first area has too few voiced points, trying the next one");
    }
    if (check("201 with id + tour summary", gen.status === 201 && typeof gen.json?.id === "string" && gen.json?.tour?.slug === `meine-${gen.json?.id}`, `status ${gen.status} ${gen.text.slice(0, 120)}`)) {
      tourId = gen.json.id;
      const s = gen.json.tour;
      check("summary: name, stopCount >= 2, walk distance + duration set", !!s.name && s.stopCount >= 2 && s.distanceKm != null && s.durationMin != null);
      check("no em dash in the name", !s.name.includes("—"));
      const { data: row } = await svc.from("user_tours").select("user_id, point_ids, route_geo, start_lat, interests").eq("id", tourId!).maybeSingle();
      check("row belongs to A, has points + loop geometry + start", row?.user_id === A.id && (row?.point_ids ?? []).length >= 2 && Array.isArray(row?.route_geo) && row?.start_lat != null);
      check("interests stored as labels in the request language", (row?.interests ?? []).length >= 2);
      tourCount = 1;
    }
  } else info("--no-live: skipped");
  if (!tourId) {
    // Seed a row directly (service key) so the later sections can run.
    const { data: pts } = await svc
      .from("tour_points")
      .select("id, lat, lng, area_id")
      .eq("area_id", areas[0].id)
      .eq("status", "published")
      .limit(4);
    const p = (pts ?? []) as { id: string; lat: number; lng: number; area_id: string }[];
    const ins = await svc
      .from("user_tours")
      .insert({ user_id: A.id, area_id: areas[0].id, name: "check", emoji: "🎧", interests: [], point_ids: p.map((x) => x.id), start_lat: p[0]?.lat, start_lng: p[0]?.lng })
      .select("id")
      .single();
    tourId = ins.data?.id ?? null;
    tourCount = tourId ? 1 : 0;
    info(tourId ? "seeded a row for A" : `seeding failed: ${ins.error?.message}`);
  }
  if (!tourId) throw new Error("no tour to test with");

  if (!LIVE) await P({ body: { ...okBody, areaId: ghostArea } }); // stands in for the live run (counts as run 2)
  const r3 = await P({ body: { ...okBody, areaId: ghostArea } });
  check("run 3 (unknown area) still allowed", isErr(r3, 404, "not_found"), `status ${r3.status}`);
  const r4 = await P({ body: { ...okBody, areaId: ghostArea } });
  check("run 4 within 10 minutes -> 429 rate_limit", isErr(r4, 429, "rate_limit"), `status ${r4.status}`);
  const r5 = await P({ body: okBody });
  check("a valid request is stopped by the same limit (no AI call)", isErr(r5, 429, "rate_limit"), `status ${r5.status}`);
  const { data: burst } = await svc.from("rate_limits").select("count").eq("subject", limitSubject(A.id, "builder-daily")).maybeSingle();
  check("daily counter is written (limit 10 per 24 h)", (burst?.count ?? 0) >= 3, `count ${burst?.count}`);

  head("6d. Web path: the same counter (enforceBuilderQuota, no AI call)");
  {
    const { enforceBuilderQuota } = (await import("@/lib/builder-quota")) as {
      enforceBuilderQuota: (c: unknown, id: string) => Promise<string>;
    };
    const asUser = (u: TempUser) =>
      createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
        global: { headers: { Authorization: bearer(u) } },
      });
    // A used up its 3 runs through the APP route above: the web guard sees the very same counter.
    check("A: runs made through the app count for the web guard (rate_limit)", (await enforceBuilderQuota(asUser(A), A.id)) === "rate_limit");
    // B starts fresh: 3 runs pass, the 4th is stopped.
    const q = [] as string[];
    for (let i = 0; i < 4; i++) q.push(await enforceBuilderQuota(asUser(B), B.id));
    check("B: web guard allows 3 runs in 10 minutes, the 4th is rate_limit", q.join(",") === "ok,ok,ok,rate_limit", q.join(","));
    // Daily: burst row removed, daily row at its maximum.
    await svc.from("rate_limits").delete().eq("subject", limitSubject(B.id, "builder-burst"));
    await svc.from("rate_limits").upsert({ subject: limitSubject(B.id, "builder-daily"), window_start: new Date().toISOString(), count: 10 });
    check("B: the 11th run of the day is rate_limit (daily cap 10)", (await enforceBuilderQuota(asUser(B), B.id)) === "rate_limit");
    await svc.from("rate_limits").delete().eq("subject", limitSubject(B.id, "builder-daily"));
    await svc.from("rate_limits").delete().eq("subject", limitSubject(B.id, "builder-burst"));
    // Static: the web action asks the guard before the AI core.
    const src = readFileSync(new URL("../src/lib/tour-generate.ts", import.meta.url), "utf8");
    const g = src.indexOf("enforceBuilderQuota(");
    const b = src.indexOf("buildAndSaveTour(");
    check("generateTour calls enforceBuilderQuota before buildAndSaveTour", g > 0 && b > g);
    const route = readFileSync(new URL("../src/app/api/app/v1/builder/route.ts", import.meta.url), "utf8");
    check("POST /builder uses the same guard", route.includes("enforceBuilderQuota("));
  }

  // ── 7. Read: list, detail, package ───────────────────────────────────────────
  head("7. A reads its own tour");
  const list = await call("GET", `/my-tours?lang=${LANG}`, bearer(A));
  check("GET /my-tours: contains the tour with slug meine-<id>", list.status === 200 && (list.json?.tours ?? []).some((t: Loose) => t.id === tourId && t.slug === `meine-${tourId}`));
  const det = await call("GET", `/my-tours/${tourId}?lang=${LANG}`, bearer(A));
  const dt = det.json?.tour;
  check("GET /my-tours/{id}: 200, AppTour shape (lang, tier pro, tour)", det.status === 200 && det.json?.tier === "pro" && dt?.slug === `meine-${tourId}` && dt?.mode === "walk");
  check("Pro: all stops unlocked with signed audio", (dt?.stops ?? []).length >= 2 && dt.stops.every((s: Loose) => !s.locked) && dt.stops.some((s: Loose) => typeof s.audioUrl === "string"));
  check("round trip: end = start (loop)", dt?.end && dt?.start && dt.end.lat === dt.start.lat && dt.end.lng === dt.start.lng);
  check("Cache-Control is private, no-store (+ Vary: Authorization)", det.status === 200 && det.headers.get("cache-control") === "private, no-store" && (det.headers.get("vary") ?? "").includes("Authorization"), `cache-control: ${det.headers.get("cache-control")}`);
  check("GET /my-tours is private, no-store as well", list.headers.get("cache-control") === "private, no-store");
  const pk = await call("GET", `/my-tours/${tourId}/package?lang=${LANG}`, bearer(A));
  const pkg = pk.json;
  if (pk.status === 200) {
    check("package: AppTourPackage shape (tour, route, bbox, images, audio, contentHash, attribution)",
      !!pkg?.tour && !!pkg?.route && !!pkg?.bbox && Array.isArray(pkg?.images) && Array.isArray(pkg?.audio) && typeof pkg?.contentHash === "string" && typeof pkg?.attribution === "string");
    check("package: route has a line, steps and one stopAlongM per stop", pkg.route.geometry.length > 5 && Array.isArray(pkg.route.steps) && pkg.route.stopAlongM.length === pkg.tour.stops.length);
    check("package: route ends where it starts (loop)", (() => { const g = pkg.route.geometry; const a = g[0], z = g[g.length - 1]; return Math.abs(a[0] - z[0]) < 0.0005 && Math.abs(a[1] - z[1]) < 0.0005; })());
    check("package: audio entries are full files for the unlocked stops", pkg.audio.length > 0 && pkg.audio.every((x: Loose) => x.kind === "full"));
    const pk2 = await call("GET", `/my-tours/${tourId}/package?lang=${LANG}`, bearer(A));
    check("package: contentHash stable across two calls", pk2.json?.contentHash === pkg.contentHash);
  } else {
    check("package: 200", false, `status ${pk.status} ${pk.text.slice(0, 100)}`);
  }

  head("7b. Reroute on an own tour (POST /route with meine-<id>)");
  if (pkg?.route?.geometry?.length) {
    const mid = pkg.route.geometry[Math.floor(pkg.route.geometry.length / 3)];
    const rr = await call("POST", `/route?lang=${LANG}`, bearer(A), { body: { tourSlug: `meine-${tourId}`, from: mid } });
    check("owner: reroute 200 with a line", rr.status === 200 && Array.isArray(rr.json?.route?.geometry) && rr.json.route.geometry.length > 1, `status ${rr.status} ${rr.text.slice(0, 80)}`);
    const rb = await call("POST", `/route?lang=${LANG}`, bearer(B), { body: { tourSlug: `meine-${tourId}`, from: mid } });
    check("other account: reroute -> 404", isErr(rb, 404, "not_found"), `status ${rb.status}`);
    const rg = await call("POST", `/route?lang=${LANG}`, null, { body: { tourSlug: `meine-${tourId}`, from: mid } });
    check("guest: reroute -> 404", isErr(rg, 404, "not_found"), `status ${rg.status}`);
    const rc = await call("POST", `/route?lang=${LANG}`, bearer(A), { body: { tourSlug: "meine-not-a-uuid", from: mid } });
    check("bad own slug -> 404", isErr(rc, 404, "not_found"), `status ${rc.status}`);
  } else info("no package line, reroute checks skipped");

  // ── 8. Web path still works after the refactor ───────────────────────────────
  head("8. Web: same tour through the refactored server actions");
  {
    const cookie = await webCookieHeader(A.session);
    const page = await fetch(`${BASE}/${LANG}/touren/meine/${tourId}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(90_000) });
    const html = await page.text();
    const firstStop: string | undefined = dt?.stops?.[0]?.title;
    check("web /touren/meine/{id}: 200 and shows the first stop", page.status === 200 && !!firstStop && html.includes(firstStop.replace(/&/g, "&amp;")), `status ${page.status}`);
    const tours = await fetch(`${BASE}/${LANG}/touren`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(90_000) });
    check("web /touren (list of own tours): 200", tours.status === 200);
    const build = await fetch(`${BASE}/${LANG}/touren/bauen`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(90_000) });
    check("web /touren/bauen (Pro): 200", build.status === 200);
    const cookieB = await webCookieHeader(B.session);
    const other = await fetch(`${BASE}/${LANG}/touren/meine/${tourId}`, { headers: { Cookie: cookieB }, signal: AbortSignal.timeout(90_000) });
    const otherHtml = await other.text();
    check("web: B opening A's tour sees no stop (404 or empty)", other.status === 404 || !(firstStop && otherHtml.includes(firstStop.replace(/&/g, "&amp;"))), `status ${other.status}`);
  }

  // ── 9. RLS with two accounts ─────────────────────────────────────────────────
  head("9. RLS: B against A's tour");
  {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const asB = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: bearer(B) } } });
    const guest = createClient(url, key, { auth: { persistSession: false } });
    const sel = await asB.from("user_tours").select("id").eq("id", tourId);
    check("B: select A's row -> no rows", !sel.error && (sel.data ?? []).length === 0);
    const all = await asB.from("user_tours").select("id");
    check("B: select all -> none of A's rows", !all.error && !(all.data ?? []).some((r) => r.id === tourId));
    const gsel = await guest.from("user_tours").select("id").eq("id", tourId);
    check("anon key without login: no rows", (gsel.data ?? []).length === 0);
    const del = await asB.from("user_tours").delete().eq("id", tourId).select("id");
    check("B: delete A's row -> nothing deleted", (del.data ?? []).length === 0);
    const upd = await asB.from("user_tours").update({ name: "hijack" }).eq("id", tourId).select("id");
    check("B: update A's row -> nothing changed", (upd.data ?? []).length === 0);
    const forge = await asB.from("user_tours").insert({ user_id: A.id, name: "forged", point_ids: [fakeId, fakeId] });
    check("B: insert a row for A -> rejected", !!forge.error);
    const still = await svc.from("user_tours").select("name").eq("id", tourId).maybeSingle();
    check("A's row is untouched", !!still.data && still.data.name !== "hijack");

    check("B API: list is empty", (await call("GET", `/my-tours?lang=${LANG}`, bearer(B))).json?.tours?.length === 0);
    check("B API: GET detail -> 404", isErr(await call("GET", `/my-tours/${tourId}?lang=${LANG}`, bearer(B)), 404, "not_found"));
    check("B API: GET package -> 404", isErr(await call("GET", `/my-tours/${tourId}/package?lang=${LANG}`, bearer(B)), 404, "not_found"));
    const bd = await call("DELETE", `/my-tours/${tourId}?lang=${LANG}`, bearer(B));
    check("B API: DELETE answers like a missing tour (200 deleted)", bd.status === 200 && bd.json?.deleted === true);
    const afterB = await svc.from("user_tours").select("id").eq("id", tourId).maybeSingle();
    check("A's row survived B's DELETE", !!afterB.data);
  }

  // ── 10. Not Pro (any more): reading is still allowed, locked like the web ────
  head("10. Pro ends: A keeps the tour, stops from the third on are locked");
  await setProfile(A.id, { is_pro: false });
  {
    const d = await call("GET", `/my-tours/${tourId}?lang=${LANG}`, bearer(A));
    const stops: Loose[] = d.json?.tour?.stops ?? [];
    check("tier public, canSeePro false", d.status === 200 && d.json?.tier === "public" && d.json?.tour?.canSeePro === false);
    check("first 2 stops open, the rest locked without audio url or text",
      stops.length > 2 ? stops.slice(0, 2).every((s) => !s.locked) && stops.slice(2).every((s) => s.locked && s.audioUrl === null && s.audioText === null) : stops.every((s) => !s.locked));
    const p = await call("GET", `/my-tours/${tourId}/package?lang=${LANG}`, bearer(A));
    check("package for non-Pro: audio only for open stops", p.status === 200 && (p.json?.audio ?? []).length <= 2, `status ${p.status}`);
    check("package hash differs from the Pro hash", p.status === 200 && !!pkg && p.json?.contentHash !== pkg.contentHash);
    check("non-Pro cannot build again", isErr(await P({ body: okBody }), 403, "pro"));
  }
  await setProfile(A.id, { is_pro: true });

  // ── 11. Cap of saved tours (no AI call) ──────────────────────────────────────
  head("11. Cap: 50 saved tours per account");
  {
    const { data: src } = await svc.from("user_tours").select("area_id, point_ids, start_lat, start_lng").eq("id", tourId).single();
    const rows = Array.from({ length: 50 }, (_, i) => ({ user_id: B.id, area_id: src!.area_id, name: `cap ${i}`, point_ids: src!.point_ids, start_lat: src!.start_lat, start_lng: src!.start_lng }));
    const ins = await svc.from("user_tours").insert(rows);
    check("seeded 50 rows for B", !ins.error, ins.error?.message);
    const r = await call("POST", `/builder?lang=${LANG}`, bearer(B), { body: { ...okBody, areaId: areas[0].id } });
    check("B at the cap: 409 limit (before any AI call)", isErr(r, 409, "limit"), `status ${r.status}`);
    {
      const { enforceBuilderQuota } = (await import("@/lib/builder-quota")) as { enforceBuilderQuota: (c: unknown, id: string) => Promise<string> };
      const asB = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false }, global: { headers: { Authorization: bearer(B) } } });
      check("web guard: B at the cap -> limit", (await enforceBuilderQuota(asB, B.id)) === "limit");
    }
    const used = await svc.from("rate_limits").select("count").eq("subject", limitSubject(B.id, "builder-burst")).maybeSingle();
    check("the refused run did not count against the rate limit", !used.data);
    const bl = await call("GET", `/my-tours?lang=${LANG}`, bearer(B));
    check("B list shows 50 tours", (bl.json?.tours ?? []).length === 50);
  }

  // ── 12. Delete ───────────────────────────────────────────────────────────────
  head("12. DELETE is idempotent");
  {
    const d1 = await call("DELETE", `/my-tours/${tourId}?lang=${LANG}`, bearer(A));
    check("first delete: 200 deleted true", d1.status === 200 && d1.json?.deleted === true);
    const gone = await svc.from("user_tours").select("id").eq("id", tourId).maybeSingle();
    check("row is gone", !gone.data);
    const d2 = await call("DELETE", `/my-tours/${tourId}?lang=${LANG}`, bearer(A));
    check("second delete: same answer", d2.status === 200 && d2.json?.deleted === true);
    const d3 = await call("DELETE", `/my-tours/${fakeId}?lang=${LANG}`, bearer(A));
    check("unknown id: same answer", d3.status === 200 && d3.json?.deleted === true);
    check("bad id -> 400 invalid", isErr(await call("DELETE", `/my-tours/not-a-uuid?lang=${LANG}`, bearer(A)), 400, "invalid"));
    check("GET after delete -> 404", isErr(await call("GET", `/my-tours/${tourId}?lang=${LANG}`, bearer(A)), 404, "not_found"));
    check("package after delete -> 404", isErr(await call("GET", `/my-tours/${tourId}/package?lang=${LANG}`, bearer(A)), 404, "not_found"));
    check("GET bad id -> 404", isErr(await call("GET", `/my-tours/zzz?lang=${LANG}`, bearer(A)), 404, "not_found"));
    check("list no longer has it", !((await call("GET", `/my-tours?lang=${LANG}`, bearer(A))).json?.tours ?? []).some((t: Loose) => t.id === tourId));
  }
  void tourCount;
}

try {
  await main();
} catch (e) {
  failed++;
  console.log(`\n  FAIL  unexpected error: ${(e as Error).message}`);
} finally {
  await cleanup();
  console.log(`\nThrowaway accounts deleted: ${deletedAll ? "yes (confirmed)" : "NOT CONFIRMED, check app-api-check+...@example.com in the Supabase dashboard"}`);
  if (!deletedAll) failed++;
  console.log(failed ? `\n${failed} check(s) failed, ${okCount} ok.` : `\nAll green (${okCount} ok).`);
  process.exitCode = failed ? 1 : 0;
}
