import "server-only";
import { createHash } from "node:crypto";
import { createServiceClient } from "./supabase/service";

/**
 * Zaehler je KONTO ueber hit_rate_limit (Migration 0055), Schluessel gehasht. EINE Stelle fuer
 * die App-API (appUserRateLimit) und die Web-Aktion des Runden-Bauers, damit beide denselben
 * Zaehler treffen. `failClosed`: Faellt die Zaehlung aus, gilt "nein" (Routen, die Geld kosten);
 * sonst "ja" (Zaehler sollen Schleifen bremsen, nicht die App abschalten).
 */
export async function userRateLimit(
  userId: string,
  bucket: string,
  windowSeconds: number,
  max: number,
  failClosed = false,
): Promise<boolean> {
  try {
    const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
    const hash = createHash("sha256").update(`${userId}:${salt}`).digest("hex").slice(0, 32);
    const { data, error } = await createServiceClient().rpc("hit_rate_limit", {
      p_subject: `app-user:${bucket}:${hash}`,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (failClosed && (error || typeof data !== "boolean")) return false;
    return data !== false;
  } catch {
    return !failClosed;
  }
}
