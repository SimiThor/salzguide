// Prüft die Kostenbremsen der KI (27.11.2026): Prompt-Caching (fester Teil der Anleitung je Frage gleich),
// Tagesgrenze über alle Toni-Fragen, fail-closed bei ausgefallener Zählung, Meldung bei leerem Claude-Guthaben.
// Ohne Netz, ohne Datenbank: Supabase und Anthropic sind Attrappen. Aufruf: npm run ai-cost:check
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-key";

const { buildSystemPrompt, withCacheMark } = await import("@/lib/ai-assistant");
const { admitAiRequest, aiGlobalCaps, AI_GLOBAL_DAILY_DEFAULT, AI_GLOBAL_MONTHLY_DEFAULT } = await import("@/lib/ai-chat-core");
const { builderGlobalDailyCap, BUILDER_GLOBAL_DAILY_DEFAULT } = await import("@/lib/builder-quota");
const { fetchWithRetry } = await import("@/lib/ai-fetch");

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "ok   " : "FEHLT"} ${name}${ok ? "" : `\n        erwartet: ${JSON.stringify(want)}\n        bekommen: ${JSON.stringify(got)}`}`);
}

// Attrappe für Supabase-RPCs und Anthropic. `rpc[name]` liefert den Wert oder "error" (Fehlerantwort).
const rpc: Record<string, unknown> = {};
const calls: string[] = [];
const subjects: string[] = [];
let anthropic: { status: number; body: string } = { status: 200, body: "{}" };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "api.anthropic.com") return new Response(anthropic.body, { status: anthropic.status });
  const m = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(url.pathname);
  if (m) {
    calls.push(m[1]);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { p_subject?: string }) : {};
    if (body.p_subject) subjects.push(body.p_subject);
    const v = body.p_subject && body.p_subject in rpc ? rpc[body.p_subject] : rpc[m[1]];
    if (v === "error") return new Response(JSON.stringify({ message: "kaputt" }), { status: 500, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(v ?? null), { status: 200, headers: { "content-type": "application/json" } });
  }
  // Ops-Zähler und Logbuch: still annehmen.
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const lines: string[] = [];
const orig = { log: console.log, warn: console.warn, error: console.error };
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  console.warn = console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    return await f();
  } finally {
    console.warn = orig.warn;
    console.error = orig.error;
  }
};

try {
  console.log("\n1. Prompt-Caching: fester Teil je Frage gleich");
  const a = buildSystemPrompt({ isPro: false, todayLabel: "Freitag, 27. November", dateRef: "Fr 27.11.", locale: "de", interests: "Seen", page: "/de/spot/x" });
  const b = buildSystemPrompt({ isPro: true, todayLabel: "Montag, 30. November", locale: "en", interests: null, page: null });
  eq("fester Teil unabhängig von Datum, Sprache, Pro, Seite, Interessen", a.stable === b.stable, true);
  eq("fester Teil enthält kein Datum und keine Sprache", [a.stable.includes("27. November"), a.stable.includes("Aktuelle App-Sprache: de")], [false, false]);
  eq("Kontext enthält Datum, Sprache, Seite, Interessen", [a.dynamic.includes("27. November"), a.dynamic.includes("Aktuelle App-Sprache: de"), a.dynamic.includes("/de/spot/x"), a.dynamic.includes("Seen")], [true, true, true, true]);
  eq("fester Teil lang genug fürs Caching (über 1024 Token, grob 4 Zeichen je Token)", a.stable.length > 4 * 1024, true);
  const marked = withCacheMark([{ role: "user", content: "Hallo" }, { role: "assistant", content: [{ type: "text", text: "Hi" }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] }]);
  eq("nur die letzte Nachricht bekommt die Marke", [JSON.stringify(marked[0]), (marked[2].content as Record<string, unknown>[])[0].cache_control], [JSON.stringify({ role: "user", content: "Hallo" }), { type: "ephemeral" }]);
  eq("Text wird zum Textblock mit Marke", withCacheMark([{ role: "user", content: "Hi" }])[0].content, [{ type: "text", text: "Hi", cache_control: { type: "ephemeral" } }]);

  console.log("\n2. Grenzen über alle (Tag, Monat) und fail-closed (admitAiRequest)");
  const ask = () => quiet(() => admitAiRequest({ subject: "s", limit: 5, isPro: false, scope: "guest", ipSubject: "ip", path: "/test" }));
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dayKey = `ai:global-day:${day}`;
  const monthKey = `ai:global-month:${day.slice(0, 7)}`;
  Object.assign(rpc, { hit_ai_burst: true, hit_rate_limit: true, bump_ai_usage: 1 });
  subjects.length = 0;
  eq("alles in Ordnung: zugelassen", (await ask()).ok, true);
  eq("  Zähler je Wiener Kalendertag und -monat", [subjects.includes(dayKey), subjects.includes(monthKey)], [true, true]);
  rpc[dayKey] = false;
  const paused = await ask();
  eq("Tagesgrenze erreicht: 429 ai_paused", [paused.ok, !paused.ok && paused.status, !paused.ok && paused.body.error], [false, 429, "ai_paused"]);
  eq("  Meldung an Anton", lines.some((l) => l.includes("Tagesgrenze aller Toni-Fragen")), true);
  delete rpc[dayKey];
  rpc[monthKey] = false;
  const month = await ask();
  eq("Monatsgrenze erreicht: 429 ai_paused", [!month.ok && month.status, !month.ok && month.body.error], [429, "ai_paused"]);
  delete rpc[monthKey];
  // Prüfung 27.11.2026: Abgewiesenes darf die gemeinsame Grenze NICHT hochzählen (sonst schaltet ein Skript Toni für alle ab).
  rpc.bump_ai_usage = 99;
  subjects.length = 0;
  const overPersonal = await ask();
  eq("über dem persönlichen Limit: 402, gemeinsamer Zähler NICHT berührt", [!overPersonal.ok && overPersonal.status, subjects.includes(dayKey)], [402, false]);
  rpc.bump_ai_usage = 1;
  rpc.hit_ai_burst = false;
  subjects.length = 0;
  const burst = await ask();
  eq("Burst abgewiesen: gemeinsamer Zähler NICHT berührt", [!burst.ok && burst.status, subjects.includes(dayKey)], [429, false]);
  rpc.hit_ai_burst = true;
  for (const step of ["hit_ai_burst", "hit_rate_limit", "bump_ai_usage"]) {
    const keep = rpc[step];
    rpc[step] = "error";
    const r = await ask();
    eq(`Zählung ${step} fällt aus: 503, Claude wird nicht gefragt`, [r.ok, !r.ok && r.status], [false, 503]);
    rpc[step] = keep;
  }
  rpc.bump_ai_usage = "text statt Zahl";
  const odd = await ask();
  eq("Zählung liefert Unsinn: 503", [odd.ok, !odd.ok && odd.status], [false, 503]);
  rpc.bump_ai_usage = 1;
  eq("Grenzen aus Vercel: Standard, gültige Zahlen, Unsinn", [aiGlobalCaps({}), aiGlobalCaps({ AI_GLOBAL_DAILY_CAP: "300", AI_GLOBAL_MONTHLY_CAP: "5000" }), aiGlobalCaps({ AI_GLOBAL_DAILY_CAP: "-5", AI_GLOBAL_MONTHLY_CAP: "abc" })], [{ day: AI_GLOBAL_DAILY_DEFAULT, month: AI_GLOBAL_MONTHLY_DEFAULT }, { day: 300, month: 5000 }, { day: AI_GLOBAL_DAILY_DEFAULT, month: AI_GLOBAL_MONTHLY_DEFAULT }]);
  eq("Runden-Bauer: Grenze aus Vercel", [builderGlobalDailyCap({}), builderGlobalDailyCap({ BUILDER_GLOBAL_DAILY_CAP: "40" })], [BUILDER_GLOBAL_DAILY_DEFAULT, 40]);

  console.log("\n3. Claude-Guthaben leer: Meldung");
  lines.length = 0;
  anthropic = { status: 400, body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }) };
  const res = await quiet(() => fetchWithRetry("https://api.anthropic.com/v1/messages", { method: "POST" }, 0));
  eq("Antwort bleibt lesbar für den Aufrufer", [res.status, (await res.text()).includes("credit balance")], [400, true]);
  eq("Meldung ai_credit_exhausted geschrieben", lines.some((l) => l.includes("ai_credit_exhausted") || l.includes("Guthaben aufgebraucht")), true);
  lines.length = 0;
  anthropic = { status: 400, body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits." } }) };
  await quiet(() => fetchWithRetry("https://api.anthropic.com/v1/messages", { method: "POST" }, 0));
  eq("Limit in der Anthropic Console erreicht: ebenfalls Meldung", lines.some((l) => l.includes("Guthaben aufgebraucht")), true);
  lines.length = 0;
  anthropic = { status: 400, body: JSON.stringify({ type: "error", error: { message: "messages: text content blocks must be non-empty" } }) };
  await quiet(() => fetchWithRetry("https://api.anthropic.com/v1/messages", { method: "POST" }, 0));
  eq("anderer 400-Fehler: keine Guthaben-Meldung", lines.some((l) => l.includes("Guthaben")), false);
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exit(1);

export {};
