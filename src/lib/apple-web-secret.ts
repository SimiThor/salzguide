import "server-only";
import { appleSiwaWebConfig, buildAppleClientSecret } from "./apple-revoke";

// Client-Secret für "Mit Apple anmelden" im WEB, automatisch erneuert (docs/41 Abschnitt 5).
//
// Apple verlangt für den Web-Ablauf ein Client-Secret (ES256-JWT), das höchstens 6 Monate
// gilt. Supabase speichert es im Apple-Provider. Wird es nicht rechtzeitig getauscht, bricht
// der Apple-Login im Web still ab. Darum erzeugt der Cron /api/cron/apple-secret monatlich
// ein neues (Laufzeit 180 Tage, also mehrere verpasste Läufe Puffer) und schreibt es über
// die Supabase Management API in die Auth-Konfiguration.
//
// GESENDET WIRD NUR `external_apple_secret`. Nie `external_apple_client_id` (dort stehen
// Services-ID UND Bundle-ID, das Überschreiben würde den App-Login brechen) und nichts
// anderes: PATCH ändert nur die genannten Felder.
//
// ENV: APPLE_SIWA_KEY_ID / _TEAM_ID / _PRIVATE_KEY (wie der Widerruf), APPLE_SIWA_SERVICES_ID
// (Services-ID des Webs), SUPABASE_MANAGEMENT_TOKEN (persönliches Zugriffstoken),
// NEXT_PUBLIC_SUPABASE_URL (daraus kommt die Projekt-Referenz).

export const WEB_SECRET_TTL_SECONDS = 180 * 24 * 60 * 60;
const MANAGEMENT_API = "https://api.supabase.com";
const TIMEOUT_MS = 10000;

/** "https://abcd.supabase.co" -> "abcd". Null bei allem, was nicht so aussieht. */
export function projectRefFromUrl(url: string | undefined): string | null {
  try {
    const host = new URL(url ?? "").hostname;
    const m = /^([a-z0-9]{10,})\.supabase\.co$/.exec(host);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Der Anfragekörper: genau ein Feld. Eigene Funktion, damit die Prüfung es festnageln kann. */
export function managementPatchBody(secret: string): { external_apple_secret: string } {
  return { external_apple_secret: secret };
}

export type RotateResult =
  | { status: "rotated"; expiresAt: string }
  | { status: "not_configured"; missing: string[] }
  | { status: "failed"; reason: string };

/** Welche ENV fehlt (nur Namen, nie Werte). */
export function missingWebSecretEnv(): string[] {
  const missing: string[] = [];
  if (!appleSiwaWebConfig()) {
    missing.push(
      "APPLE_SIWA_KEY_ID/APPLE_SIWA_TEAM_ID/APPLE_SIWA_PRIVATE_KEY/APPLE_SIWA_SERVICES_ID",
    );
  }
  if (!process.env.SUPABASE_MANAGEMENT_TOKEN?.trim()) missing.push("SUPABASE_MANAGEMENT_TOKEN");
  if (!projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  return missing;
}

/**
 * Neues Secret bauen und bei Supabase eintragen. WIRFT NIE. Das Secret taucht in keiner
 * Rückgabe und keinem Fehlertext auf; bei Fehlern nur Statuscode bzw. Name der Ausnahme.
 * `fetchImpl` nur für die Prüfung (Attrappe).
 */
export async function rotateAppleWebSecret(
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<RotateResult> {
  const missing = missingWebSecretEnv();
  const cfg = appleSiwaWebConfig();
  const ref = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN?.trim();
  if (missing.length > 0 || !cfg || !ref || !token) return { status: "not_configured", missing };
  try {
    const secret = buildAppleClientSecret(cfg, nowMs, WEB_SECRET_TTL_SECONDS);
    const res = await fetchImpl(`${MANAGEMENT_API}/v1/projects/${ref}/config/auth`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(managementPatchBody(secret)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: "failed", reason: `management api http ${res.status}` };
    return {
      status: "rotated",
      expiresAt: new Date(nowMs + WEB_SECRET_TTL_SECONDS * 1000).toISOString(),
    };
  } catch (e) {
    return { status: "failed", reason: `ausnahme ${e instanceof Error ? e.name : "unbekannt"}` };
  }
}
