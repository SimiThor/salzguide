import "server-only";
import { createPrivateKey, createSign } from "node:crypto";

// Apple-Token widerrufen, wenn ein Konto mit "Mit Apple anmelden" gelöscht wird (docs/41
// Abschnitt 5; App-Store-Richtlinie 5.1.1(v)). Supabase speichert Apples Refresh-Token beim
// nativen Login nicht. Darum meldet sich der Nutzer beim Löschen noch einmal mit Apple an,
// die App schickt den frischen authorizationCode, und der Server tauscht ihn hier gegen ein
// Refresh-Token und widerruft es.
//
// ENV (alle vier nötig, nur in Vercel, nie im Repo):
//   APPLE_SIWA_KEY_ID       Key-ID des Sign-in-with-Apple-Schlüssels (.p8)
//   APPLE_SIWA_TEAM_ID      Team-ID des Entwicklerkontos
//   APPLE_SIWA_PRIVATE_KEY  Inhalt der .p8-Datei (PEM; "\n" als Text ist erlaubt)
//   APPLE_SIWA_CLIENT_ID    Bundle-ID der App
// Das ist ein EIGENER Schlüssel, getrennt vom App-Store-Server-Schlüssel (Phase 7).

const APPLE_ISSUER = "https://appleid.apple.com";
const TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`;
const TIMEOUT_MS = 8000;
// Das Client-Secret braucht nur für diese zwei Aufrufe zu gelten. Apple erlaubt bis zu
// 6 Monate, kürzer ist sicherer.
const SECRET_TTL_SECONDS = 300;

export type AppleSiwaConfig = {
  keyId: string;
  teamId: string;
  privateKey: string;
  clientId: string;
};

/** Die Konfiguration aus der ENV, oder null, solange etwas fehlt. */
export function appleSiwaConfig(): AppleSiwaConfig | null {
  const keyId = process.env.APPLE_SIWA_KEY_ID?.trim();
  const teamId = process.env.APPLE_SIWA_TEAM_ID?.trim();
  const clientId = process.env.APPLE_SIWA_CLIENT_ID?.trim();
  // Viele Hoster speichern mehrzeilige Werte mit wörtlichem "\n".
  const privateKey = process.env.APPLE_SIWA_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!keyId || !teamId || !clientId || !privateKey) return null;
  return { keyId, teamId, privateKey, clientId };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/**
 * Das Client-Secret für Apple: ein ES256-JWT, vom eigenen Schlüssel signiert. Mit node:crypto
 * gebaut, ohne neue Abhängigkeit. Die Signatur muss im IEEE-P1363-Format (r||s, 64 Bytes)
 * stehen, wie JWS es verlangt; Nodes Standard wäre DER und Apple lehnte sie ab.
 */
export function buildAppleClientSecret(cfg: AppleSiwaConfig, nowMs: number = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: "ES256", kid: cfg.keyId, typ: "JWT" };
  const claims = {
    iss: cfg.teamId,
    iat,
    exp: iat + SECRET_TTL_SECONDS,
    aud: APPLE_ISSUER,
    sub: cfg.clientId,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign("SHA256")
    .update(input)
    .sign({ key: createPrivateKey(cfg.privateKey), dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

export type AppleRevokeResult =
  | { status: "revoked" }
  | { status: "not_configured" }
  | { status: "failed"; reason: string };

async function postForm(url: string, form: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Apple-Token des Nutzers widerrufen. WIRFT NIE: Die Löschung des Kontos darf nie an Apple
 * scheitern (Recht auf Löschung), der Aufrufer meldet das Ergebnis nur. Der Code und alle
 * Token tauchen in keiner Rückgabe und keinem Fehlertext auf.
 */
export async function revokeAppleToken(authorizationCode: string): Promise<AppleRevokeResult> {
  const cfg = appleSiwaConfig();
  if (!cfg) return { status: "not_configured" };
  try {
    const secret = buildAppleClientSecret(cfg);

    const tokenRes = await postForm(TOKEN_URL, {
      client_id: cfg.clientId,
      client_secret: secret,
      code: authorizationCode,
      grant_type: "authorization_code",
    });
    if (!tokenRes.ok) return { status: "failed", reason: `token http ${tokenRes.status}` };
    const tokens = (await tokenRes.json()) as { refresh_token?: unknown };
    const refresh = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
    if (!refresh) return { status: "failed", reason: "token: kein refresh_token" };

    const revokeRes = await postForm(REVOKE_URL, {
      client_id: cfg.clientId,
      client_secret: secret,
      token: refresh,
      token_type_hint: "refresh_token",
    });
    if (!revokeRes.ok) return { status: "failed", reason: `revoke http ${revokeRes.status}` };
    return { status: "revoked" };
  } catch (e) {
    // Nur Art und Name des Fehlers, nie seine Nachricht: Sie könnte Teile der Anfrage enthalten.
    return { status: "failed", reason: `ausnahme ${e instanceof Error ? e.name : "unbekannt"}` };
  }
}
