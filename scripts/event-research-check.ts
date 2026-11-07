// Prüft, dass die KI-Wochenrecherche den ECHTEN Grund meldet, wenn sie scheitert.
// Aufruf: npm run event-research:check
//
// Hintergrund: Bis 11/2026 meldete der Admin bei JEDEM Fehler „Keine Recherche-Ergebnisse –
// bitte Anthropic-Guthaben & Web-Suche prüfen", auch bei einem Zeitlimit. Man suchte am
// Guthaben, das voll war.
//
// Läuft OHNE Netz und OHNE Schlüssel: `fetch` wird durch nachgestellte Anthropic-Antworten
// ersetzt, die Anker fallen ohne Supabase-ENV auf die eingebaute Liste zurück. Kostet nichts.
import { researchWeek } from "@/lib/event-research";
import { describeAnthropicHttpError, describeAnthropicThrow } from "@/lib/anthropic-error";
import { fetchWithRetry } from "@/lib/ai-fetch";
import { translateEventAllLangsOneShot } from "@/lib/event-translate";

let okCount = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    okCount++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FEHLT ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

const OLD_TEXT = "Guthaben & Web-Suche";
const apiErr = (type: string, message: string) =>
  JSON.stringify({ type: "error", error: { type, message } });
const json = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });
const timeoutError = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

// Ersetzt fetch für Anthropic durch eine Folge von Antworten (Funktion = wirft).
type Step = Response | (() => never);
let anthropicCalls = 0;
function stubFetch(steps: Step[]): void {
  anthropicCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.anthropic.com/")) throw new Error(`unerwarteter Aufruf: ${url}`);
    const step = steps[Math.min(anthropicCalls, steps.length - 1)];
    anthropicCalls++;
    if (typeof step === "function") step();
    return (step as Response).clone();
  }) as typeof fetch;
}

const research = (budgetMs = 60_000) =>
  researchWeek("2026-11-16", "2026-11-22", "sk-test-nicht-echt", { deadline: Date.now() + budgetMs });

console.log("\nGrund-Texte (anthropic-error.ts)");
{
  const credit = describeAnthropicHttpError(
    400,
    apiErr("invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
  );
  check("Guthaben leer -> nennt Guthaben", credit.includes("Guthaben"), credit);
  const auth = describeAnthropicHttpError(401, apiErr("authentication_error", "invalid x-api-key"));
  check("401 -> Schlüssel abgelehnt", auth.includes("Schlüssel") && !auth.includes("Guthaben"), auth);
  const model = describeAnthropicHttpError(404, apiErr("not_found_error", "model: claude-sonnet-4-6"));
  check("404 -> Modell nicht gefunden + Modellname", model.includes("Modell") && model.includes("claude-sonnet-4-6"), model);
  const over = describeAnthropicHttpError(529, apiErr("overloaded_error", "Overloaded"));
  check("529 -> überlastet", over.includes("überlastet"), over);
  const rate = describeAnthropicHttpError(429, apiErr("rate_limit_error", "rate limited"));
  check("429 -> Rate-Limit", rate.includes("Rate-Limit"), rate);
  const bad = describeAnthropicHttpError(400, apiErr("invalid_request_error", "tools.0: unknown type"));
  check("400 sonst -> abgelehnt + API-Meldung", bad.includes("abgelehnt") && bad.includes("unknown type"), bad);
  const html = describeAnthropicHttpError(502, "<html>Bad Gateway</html>");
  check("kein JSON -> trotzdem Status", html.includes("502"), html);
  const long = describeAnthropicHttpError(400, apiErr("invalid_request_error", "x".repeat(2000)));
  check("lange Meldung wird gekürzt", long.length < 300, `Länge ${long.length}`);
  const to = describeAnthropicThrow(timeoutError(), 120000);
  check("Zeitlimit -> nennt Zeitlimit + Sekunden", to.includes("Zeitlimit") && to.includes("120 s"), to);
  const net = describeAnthropicThrow(new TypeError("fetch failed"), 120000);
  check("Netzfehler -> nicht erreichbar", net.includes("nicht erreichbar"), net);
}

console.log("\nresearchWeek mit nachgestellter API");
const realFetch = globalThis.fetch;
try {
  stubFetch([json(400, apiErr("invalid_request_error", "Your credit balance is too low."))]);
  let r = await research();
  check("Guthaben leer -> ok:false mit Guthaben-Grund", !r.ok && r.reason.includes("Guthaben"), JSON.stringify(r));

  stubFetch([json(404, apiErr("not_found_error", "model: claude-sonnet-4-6"))]);
  r = await research();
  check("Modell weg -> Grund nennt Modell, nicht Guthaben",
    !r.ok && r.reason.includes("Modell") && !r.reason.includes(OLD_TEXT), JSON.stringify(r));

  stubFetch([() => { throw timeoutError(); }]);
  r = await research();
  check("Zeitlimit -> Grund nennt Zeitlimit, nicht Guthaben",
    !r.ok && r.reason.includes("Zeitlimit") && !r.reason.includes("Guthaben"), JSON.stringify(r));
  // Der eigentliche Ausfall: Nach 120 s Zeitlimit startete die Suche neu und sprengte die 300 s.
  check("Zeitlimit -> KEIN Neustart der Recherche", anthropicCalls === 1, `Aufrufe: ${anthropicCalls}`);
  check("Zeitlimit -> Limit = Restbudget (60 s), nicht fest 120 s",
    !r.ok && r.reason.includes("60 s"), JSON.stringify(r));

  // 529 überlastet: kurzer zweiter Versuch ist weiter erlaubt (kostet Sekunden, nicht Minuten).
  stubFetch([
    json(529, apiErr("overloaded_error", "Overloaded")),
    json(200, JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "- Event C" }] })),
  ]);
  r = await research();
  check("529 -> ein Wiederholungsversuch, dann ok", r.ok && anthropicCalls === 2, JSON.stringify(r));

  stubFetch([json(200, "{}")]);
  r = await research(5_000);
  check("Budget fast leer -> kein Aufruf, Grund nennt Zeitbudget",
    !r.ok && r.reason.includes("Zeitbudget") && anthropicCalls === 0, JSON.stringify(r));

  // pause_turn verbraucht Zeit: Der Folgeaufruf bekommt nur die Restzeit.
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount++;
    await new Promise((res) => setTimeout(res, 300));
    return json(200, JSON.stringify({
      stop_reason: callCount < 3 ? "pause_turn" : "end_turn",
      content: [{ type: "text", text: "- Event D" }],
    }));
  }) as typeof fetch;
  r = await research(10_500);
  check("pause_turn-Kette endet an der Frist statt 8× weiterzulaufen",
    !r.ok && r.reason.includes("Zeitbudget"), JSON.stringify(r));

  stubFetch([json(200, JSON.stringify({ stop_reason: "end_turn", content: [] }))]);
  r = await research();
  check("leere Antwort -> Grund nennt fehlenden Text + stop_reason",
    !r.ok && r.reason.includes("ohne Recherche-Text") && r.reason.includes("end_turn"), JSON.stringify(r));

  stubFetch([
    json(200, JSON.stringify({ stop_reason: "pause_turn", content: [{ type: "text", text: "suche…" }] })),
    json(200, JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "- Event A" }] })),
  ]);
  r = await research();
  check("pause_turn wird fortgesetzt -> ok mit Text", r.ok && r.text === "- Event A" && r.calls === 2, JSON.stringify(r));

  stubFetch([json(200, JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "- Event B" }] }))]);
  r = await research();
  check("Normalfall -> ok mit Text", r.ok && r.text === "- Event B", JSON.stringify(r));
} finally {
  globalThis.fetch = realFetch;
}

console.log("\nfetchWithRetry (ai-fetch.ts) und Übersetzung");
try {
  // Alle ANDEREN Aufrufer übergeben keine Optionen: Dort muss ein Zeitlimit weiter neu starten.
  stubFetch([() => { throw timeoutError(); }]);
  await fetchWithRetry("https://api.anthropic.com/v1/messages", {}, 1, 1000).catch(() => null);
  check("Standard: Zeitlimit startet weiterhin neu (andere Aufrufer unverändert)",
    anthropicCalls === 2, `Aufrufe: ${anthropicCalls}`);

  // Spät gemeldeter 529: Der Neustart darf die Frist nicht mit vollem Zeitlimit überziehen.
  // Der Stub hält sich an das AbortSignal, misst also das Zeitlimit, das wirklich gesetzt wird.
  let calls = 0;
  globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const sig = init?.signal;
    await new Promise<void>((res, rej) => {
      const t = setTimeout(res, calls === 1 ? 700 : 5000);
      sig?.addEventListener("abort", () => { clearTimeout(t); rej(sig.reason); });
    });
    return json(529, apiErr("overloaded_error", "Overloaded"));
  }) as typeof fetch;
  const t0 = Date.now();
  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {}, 1, 10_000, {
    retryOnTimeout: false,
    deadline: t0 + 1500,
  }).catch((e: unknown) => e);
  const took = Date.now() - t0;
  check("später 529 + Frist: endet an der Frist statt nach vollem Zeitlimit",
    took < 2500, `Dauer ${took} ms, Aufrufe ${calls}`);
  check("später 529 + Frist: liefert ehrlichen Status statt Absturz",
    res instanceof Response ? res.status === 529 : String(res).includes("Timeout"),
    String(res instanceof Response ? res.status : res));

  // Übersetzung mit Frist: ein hängender Aufruf endet an der Frist und wird nicht neu gestartet.
  calls = 0;
  globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const sig = init?.signal;
    // AbortSignal.timeout hält Node nicht am Leben; ein echter Socket schon. Daher ein Timer.
    await new Promise<void>((res, rej) => {
      const keep = setTimeout(res, 5000);
      sig?.addEventListener("abort", () => { clearTimeout(keep); rej(sig.reason); });
    });
    return json(200, "{}");
  }) as typeof fetch;
  const t1 = Date.now();
  const tr = await translateEventAllLangsOneShot(
    { title: "Testevent", description: "Ein Satz." },
    "sk-test-nicht-echt",
    { deadline: t1 + 800 },
  );
  check("Übersetzung + Frist: hängender Aufruf endet an der Frist, kein Neustart",
    !tr.ok && Date.now() - t1 < 2000 && calls === 1, `Dauer ${Date.now() - t1} ms, Aufrufe ${calls}`);
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${okCount} ok, ${failed} fehlgeschlagen`);
if (failed) process.exit(1);
