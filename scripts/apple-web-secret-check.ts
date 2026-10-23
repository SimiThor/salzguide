// Prüft das Web-Secret für "Mit Apple anmelden" OHNE Apple- oder Supabase-Verkehr.
// Aufruf: npm run apple-web-secret:check
//
// 1. Das Secret: Kopf (alg, kid), Ansprüche (iss, sub = Services-ID, aud, iat, exp <= 180 Tage,
//    unter Apples Höchstgrenze von 6 Monaten) und eine gültige ES256-Signatur (P1363),
//    mit einem Wegwerf-Schlüssel.
// 2. Der Aufruf an die Management API: Methode, Adresse (Projekt-Referenz aus der URL),
//    Kopf, und der Körper enthält GENAU ein Feld (external_apple_secret). Fetch ist eine Attrappe.
// 3. Fehlerwege: fehlende ENV, HTTP-Fehler; das Secret steht in keiner Rückgabe.
import { generateKeyPairSync, verify } from "node:crypto";
import { rotateAppleWebSecret, projectRefFromUrl } from "@/lib/apple-web-secret";
import { appleLoginEnabled } from "@/lib/auth-providers";
import { appleSiwaWebConfig, buildAppleClientSecret } from "@/lib/apple-revoke";

let failed = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const bad = (m: string, d?: unknown) => { failed++; console.log(`  FAIL ${m}`, d ?? ""); };
const check = (c: boolean, m: string, d?: unknown) => (c ? ok(m) : bad(m, d));

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.APPLE_SIWA_KEY_ID = "KEY1234567";
process.env.APPLE_SIWA_TEAM_ID = "TEAM123456";
process.env.APPLE_SIWA_PRIVATE_KEY = pem.replace(/\n/g, "\\n");
process.env.APPLE_SIWA_SERVICES_ID = "com.salzguide.web";
process.env.APPLE_SIWA_CLIENT_ID = "com.salzguide.app";
process.env.SUPABASE_MANAGEMENT_TOKEN = "sbp_testtoken";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";

const NOW = 1_800_000_000_000;
const dec = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString());

console.log("\n1. Secret fürs Web");
{
  const cfg = appleSiwaWebConfig();
  check(cfg?.clientId === "com.salzguide.web", "sub = Services-ID, nicht Bundle-ID");
  const jwt = buildAppleClientSecret(cfg!, NOW, 180 * 86400);
  const [h, c, s] = jwt.split(".");
  const head = dec(h), cl = dec(c);
  check(head.alg === "ES256" && head.kid === "KEY1234567", "Kopf alg/kid", head);
  check(cl.iss === "TEAM123456", "iss = Team-ID");
  check(cl.sub === "com.salzguide.web", "sub");
  check(cl.aud === "https://appleid.apple.com", "aud");
  check(cl.iat === NOW / 1000, "iat");
  check(cl.exp - cl.iat === 180 * 86400, "exp = iat + 180 Tage");
  check(cl.exp - cl.iat <= 15777000, "unter Apples Höchstgrenze (6 Monate)");
  const sig = Buffer.from(s, "base64url");
  check(sig.length === 64, "Signatur 64 Bytes (P1363)");
  check(
    verify("SHA256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig),
    "Signatur gültig",
  );
  // Bundle-ID-Secret des Widerrufs bleibt unberührt (kurze Laufzeit, andere sub).
  const rev = dec(buildAppleClientSecret({ ...cfg!, clientId: "com.salzguide.app" }, NOW).split(".")[1]);
  check(rev.exp - rev.iat === 300, "Widerruf-Secret weiter 300 s");
}

console.log("\n2. Management-API-Aufruf");
{
  check(projectRefFromUrl("https://abcdefghijklmnop.supabase.co") === "abcdefghijklmnop", "Projekt-Referenz");
  check(projectRefFromUrl("https://evil.com/abcdefghijklmnop.supabase.co") === null, "fremder Host abgewiesen");
  let seen: { url: string; init: RequestInit } | null = null;
  const stub = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const r = await rotateAppleWebSecret(stub, NOW);
  check(r.status === "rotated", "Ergebnis rotated", r);
  const s = seen as { url: string; init: RequestInit } | null;
  check(s?.url === "https://api.supabase.com/v1/projects/abcdefghijklmnop/config/auth", "Adresse", s?.url);
  check(s?.init.method === "PATCH", "PATCH");
  const hdr = s?.init.headers as Record<string, string>;
  check(hdr?.Authorization === "Bearer sbp_testtoken", "Bearer-Token");
  const body = JSON.parse(String(s?.init.body));
  check(Object.keys(body).length === 1 && typeof body.external_apple_secret === "string", "Körper: nur external_apple_secret", Object.keys(body));
  const cl = dec(body.external_apple_secret.split(".")[1]);
  check(cl.sub === "com.salzguide.web" && cl.exp - cl.iat === 180 * 86400, "gesendetes Secret: Web, 180 Tage");
  check(!JSON.stringify(r).includes(body.external_apple_secret), "Secret nicht in der Rückgabe");
}

console.log("\n3. Fehlerwege");
{
  const fail500 = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
  const r1 = await rotateAppleWebSecret(fail500, NOW);
  check(r1.status === "failed" && r1.reason === "management api http 500", "HTTP 500 -> failed", r1);
  const boom = (async () => { throw new Error("secret=abc"); }) as unknown as typeof fetch;
  const r2 = await rotateAppleWebSecret(boom, NOW);
  check(r2.status === "failed" && !JSON.stringify(r2).includes("abc"), "Ausnahme ohne Nachricht", r2);
  delete process.env.SUPABASE_MANAGEMENT_TOKEN;
  const r3 = await rotateAppleWebSecret(fail500, NOW);
  check(r3.status === "not_configured" && r3.missing.includes("SUPABASE_MANAGEMENT_TOKEN"), "Token fehlt -> not_configured", r3);
}

console.log("\n4. Apple-Knopf (appleLoginEnabled)");
{
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  const realFetch = globalThis.fetch;
  const settings = (apple: boolean) =>
    (async () => new Response(JSON.stringify({ external: { apple, google: true } }), { status: 200 })) as unknown as typeof fetch;
  globalThis.fetch = settings(true);
  process.env.APPLE_SIWA_SERVICES_ID = "com.salzguide.web";
  check((await appleLoginEnabled()) === true, "Apple an + Services-ID -> Knopf");
  delete process.env.APPLE_SIWA_SERVICES_ID;
  check((await appleLoginEnabled()) === false, "Apple an, aber keine Services-ID -> kein Knopf (nur App)");
  process.env.APPLE_SIWA_SERVICES_ID = "  ";
  check((await appleLoginEnabled()) === false, "leere Services-ID -> kein Knopf");
  process.env.APPLE_SIWA_SERVICES_ID = "com.salzguide.web";
  globalThis.fetch = settings(false);
  check((await appleLoginEnabled()) === false, "Services-ID, aber Apple in Supabase aus -> kein Knopf");
  globalThis.fetch = realFetch;
}

console.log(failed ? `\n${failed} FEHLER` : "\nalles gut");
process.exit(failed ? 1 : 0);
