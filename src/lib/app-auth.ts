import "server-only";
// Die Fehlerprüfer kommen aus supabase-js (re-exportiert auth-js), das ein direktes
// Abhängigkeit-Paket ist; auth-js selbst steht nicht in der package.json.
import {
  createClient,
  isAuthApiError,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createServiceClient } from "./supabase/service";

// Anmeldung der App-API (/api/app/v1). Die App schickt `Authorization: Bearer <access token>`.
// Cookies werden hier NIE gelesen: Die API gilt nur für Bearer, sonst wäre sie ein zweiter,
// ungeprüfter Weg neben dem Web (und CSRF-anfällig).
//
// LESEN vs. HANDELN, wie in lib/viewer.ts: Zum Lesen reicht die lokale Prüfung (getClaims:
// Signatur gegen das öffentliche Schlüsselset des Projekts, kein Netz-Roundtrip). Handelnde
// Routen (spätere Phasen) fragen zusätzlich auth.getUser(token) beim Auth-Server, damit ein
// gesperrter oder gelöschter Account sofort draußen ist.

export type AppAuth =
  | { ok: true; userId: string | null; token: string | null }
  | { ok: false; reason: "auth" | "unavailable" };

// EIN Anon-Client, nur für getClaims(token) mit ausdrücklichem Token. Das Teilen ist
// unbedenklich: Mit explizitem jwt-Argument liest und schreibt getClaims keinen Sitzungszustand
// (persistSession aus). Das Schlüsselset (JWKS) cached auth-js modulglobal (GLOBAL_JWKS, je
// storageKey, ca. 10 Min.), nicht am Client; geteilt wird nur, um nicht pro Anfrage einen Client
// zu bauen. Er trägt NIE die Sitzung eines Nutzers; Abfragen im Namen eines Nutzers laufen
// über createBearerClient (frischer Client pro Aufruf).
let authClient: SupabaseClient | null = null;

function getAuthClient(): SupabaseClient {
  // Nicht auf Modulebene bauen: Fehlt eine ENV, soll der Fehler beim ersten Zugriff kommen
  // und nicht den Build kippen (gleiches Muster wie supabase/service.ts).
  authClient ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  return authClient;
}

const MAX_TOKEN_LENGTH = 4096;

const B64URL = /^[A-Za-z0-9_-]+$/;

// fatal: ungültiges UTF-8 wirft, statt still durch U+FFFD ersetzt zu werden. So ist ein Segment
// mit kaputten Bytes schon in der Vorprüfung "auth" und erreicht nie auth-js.
const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodePart(part: string): Record<string, unknown> | null {
  if (!B64URL.test(part)) return null;
  const v: unknown = JSON.parse(utf8.decode(Buffer.from(part, "base64url")));
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Vorprüfung ohne Netz: Form und Header. Liefert alg und kid, wenn der Token von der Form her
 * lokal prüfbar ist (ES256/RS256 mit kid; dieses Projekt signiert mit ES256), sonst null.
 * HS*-Tokens ließe getClaims über den getUser-Fallback beim Auth-Server prüfen: ein Angreifer
 * könnte so jede Anfrage dorthin weiterreichen.
 */
function parseToken(token: string): { alg: string; kid: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((x) => !x || !B64URL.test(x))) return null;
    const header = decodePart(parts[0]);
    const payload = decodePart(parts[1]);
    if (!header || !payload) return null;
    const { alg, kid } = header;
    if (alg !== "ES256" && alg !== "RS256") return null;
    if (typeof kid !== "string" || kid.length === 0) return null;
    return { alg, kid };
  } catch {
    return null;
  }
}

// Öffentliche Schlüssel dieses Projekts (JWKS). Wir halten sie selbst, statt auth-js zu
// überlassen, was bei unbekannter kid passiert: auth-js lädt dann bei JEDER Anfrage das JWKS neu,
// und fehlt die kid weiterhin, fragt es zusätzlich den Auth-Server (getUser). Eine vom Angreifer
// frei wählbare kid würde so jede Anfrage zu zwei Aufrufen gegen Supabase verstärken. Darum:
// kid nur gegen DIESEN Cache prüfen, bei Fehlschlag höchstens einmal je 60 s nachladen (das
// deckt eine echte Schlüsselrotation ab) und danach hart ablehnen.
type Jwk = NonNullable<NonNullable<Parameters<SupabaseClient["auth"]["getClaims"]>[1]>["keys"]>[number];

const JWKS_TTL_MS = 10 * 60_000;
// Mit Cache: unbekannte kid höchstens alle 60 s nachladen (Schlüsselrotation).
const JWKS_MIN_REFRESH_MS = 60_000;
// Ohne Cache (Kaltstart, Ausfall): höchstens alle 10 s einen neuen Versuch, sonst würde jede
// Anfrage während eines Supabase-Ausfalls einen Abruf auslösen.
const JWKS_MIN_RETRY_EMPTY_MS = 10_000;
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
let jwksLastAttempt = 0;
// Ist der letzte Abruf gelungen? Nur dann darf eine fehlende kid als "gibt es nicht" (401) gelten.
let jwksLastOk = false;
let jwksRefresh: Promise<void> | null = null;

// Nur plausible Schlüssel behalten: kid als nicht leerer String, kty EC oder RSA.
function usableKeys(keys: unknown[]): Jwk[] {
  return keys.filter((k): k is Jwk => {
    if (!k || typeof k !== "object") return false;
    const { kid, kty } = k as { kid?: unknown; kty?: unknown };
    return typeof kid === "string" && kid.length > 0 && (kty === "EC" || kty === "RSA");
  });
}

// Wirft nie. true = Cache ersetzt. Bei Fehler bleibt ein alter, guter Cache unangetastet.
async function loadJwks(): Promise<boolean> {
  try {
    // Derselbe Pfad wie in auth-js (`${url}/auth/v1` + `/.well-known/jwks.json`).
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data: unknown = await res.json();
    const keys = (data as { keys?: unknown })?.keys;
    if (!Array.isArray(keys)) return false;
    const usable = usableKeys(keys);
    // Leeres oder unbrauchbares Schlüsselset zählt als Fehlschlag und ersetzt nichts.
    if (usable.length === 0) return false;
    jwksCache = { keys: usable, fetchedAt: Date.now() };
    return true;
  } catch {
    // Netzfehler oder Timeout: Cache unverändert lassen.
    return false;
  }
}

// Ein gemeinsamer Abruf für alle gleichzeitigen Anfragen. Scheitert er, bleibt der alte Cache
// stehen; ob er noch taugt, entscheidet findJwk.
function refreshJwks(): Promise<void> {
  if (jwksRefresh) return jwksRefresh;
  jwksLastAttempt = Date.now();
  // Promise ZUERST zuweisen, dann aufräumen: Der Aufräumer hängt am Promise und nicht in der
  // async-Funktion, damit ein früher Fehler kein erledigtes Promise für immer stehen lässt.
  const p = loadJwks().then((ok) => {
    jwksLastOk = ok;
  });
  jwksRefresh = p;
  void p.finally(() => {
    jwksRefresh = null;
  });
  return p;
}

/**
 * Schlüssel zur kid. null = die kid fehlt in einem erfolgreich geladenen Schlüsselset (401);
 * "unavailable" = wir wissen es nicht, weil kein brauchbares oder erfolgreich geprüftes
 * Schlüsselset vorliegt (503).
 */
async function findJwk(kid: string): Promise<Jwk | null | "unavailable"> {
  const now = Date.now();
  const fresh = jwksCache !== null && now - jwksCache.fetchedAt < JWKS_TTL_MS;
  const hit = fresh ? jwksCache!.keys.find((k) => k.kid === kid) : undefined;
  if (hit) return hit;
  // Miss oder veralteter Cache: nachladen, aber gedrosselt (60 s mit Cache, 10 s ohne).
  // Läuft schon ein Abruf, warten wir auf ihn, statt vorschnell zu urteilen.
  const gap = jwksCache ? JWKS_MIN_REFRESH_MS : JWKS_MIN_RETRY_EMPTY_MS;
  if (jwksRefresh || now - jwksLastAttempt >= gap) await refreshJwks();
  // Ein gescheitertes Nachladen darf den veralteten Cache weiter nutzen (kein Massen-Logout).
  const found = jwksCache?.keys.find((k) => k.kid === kid);
  if (found) return found;
  // Ein Netzfehler darf nie App-Nutzer ausloggen: Fehlt die kid und der letzte Abruf schlug fehl
  // (oder es gibt gar keinen Cache), antworten wir 503. Eine zufällige kid während eines
  // Ausfalls ebenfalls mit 503 zu beantworten ist unbedenklich. 401 nur, wenn das Schlüsselset
  // erfolgreich geladen wurde und die kid wirklich nicht darin steht.
  if (!jwksCache || !jwksLastOk) return "unavailable";
  return null;
}

/**
 * Wer fragt? Kein Header = Gast. Ein Header, der nicht exakt `Bearer <token>` ist, ist
 * KEIN Gast, sondern ein Fehler: Die App soll einen kaputten Header nicht stillschweigend
 * als ausgeloggt erleben.
 */
export async function appViewer(req: Request): Promise<AppAuth> {
  const header = req.headers.get("authorization");
  if (header === null) return { ok: true, userId: null, token: null };

  const m = /^bearer ([^\s]+)$/i.exec(header.trim());
  const token = m?.[1];
  if (!token || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "auth" };

  const parsed = parseToken(token);
  if (!parsed) return { ok: false, reason: "auth" };

  // Unbekannte kid oder falscher Algorithmus (z. B. RS256 gegen den EC-Schlüssel des Projekts)
  // endet hier, bevor Krypto oder Auth-Server im Spiel sind.
  const jwk = await findJwk(parsed.kid);
  if (jwk === "unavailable") return { ok: false, reason: "unavailable" };
  if (!jwk) return { ok: false, reason: "auth" };
  if (typeof jwk.alg === "string" && jwk.alg !== parsed.alg) return { ok: false, reason: "auth" };

  // Anonyme Anmeldungen (is_anonymous) gehen hier als Nicht-Pro-Leser durch; die Schreib-Routen
  // von Phase 3 müssen sie vorher ablehnen.
  try {
    const { data, error } = await getAuthClient().auth.getClaims(token, {
      // Genau dieser Schlüssel: auth-js findet die kid in `keys` und lädt nichts nach.
      keys: [jwk],
    });
    if (error) {
      // Unterscheidung, damit die App bei einem Supabase-Aussetzer NICHT ausloggt:
      //  - AuthRetryableFetchError: Netzwerkfehler oder 502/503/504 beim Auth-Server
      //    (z. B. beim Abruf des Schlüsselsatzes oder im getUser-Fallback für HS-Tokens).
      //  - AuthApiError mit Status >= 500 oder 429 (Rate-Limit): Auth-Server, nicht der Token.
      //  - AuthUnknownError: nicht lesbare Antwort des Auth-Servers (kein Token-Urteil).
      //  Alles andere (AuthInvalidJwtError: abgelaufen, Signatur falsch, kaputt gebaut;
      //  AuthApiError 4xx) heißt wirklich: dieser Token taugt nicht.
      if (isAuthRetryableFetchError(error)) return { ok: false, reason: "unavailable" };
      if (isAuthApiError(error) && (error.status >= 500 || error.status === 429)) {
        return { ok: false, reason: "unavailable" };
      }
      if (error.name === "AuthUnknownError") return { ok: false, reason: "unavailable" };
      return { ok: false, reason: "auth" };
    }
    const claims = data?.claims;
    const sub = claims?.sub;
    // role === "authenticated" schließt den öffentlichen Anon-Key (role "anon") aus, der
    // ebenfalls ein gültig signiertes JWT ist, aber keinen Nutzer meint.
    // exp muss eine Zahl sein: auth-js lässt ein nicht numerisches exp bei der Ablaufprüfung durch.
    if (
      typeof sub !== "string" ||
      !sub ||
      claims?.role !== "authenticated" ||
      typeof claims?.exp !== "number"
    ) {
      return { ok: false, reason: "auth" };
    }
    return { ok: true, userId: sub, token };
  } catch (e) {
    // Echte Netzwerkfehler kommen von auth-js als zurückgegebener AuthRetryableFetchError (oben
    // behandelt). Was hier GEWORFEN ankommt, sind Token-Probleme (z. B. importKey/verify lehnen
    // einen kaputten Schlüssel oder eine kaputte Signatur ab); nur ein durchgereichter
    // Retryable-Fehler zählt als Ausfall.
    return { ok: false, reason: isAuthRetryableFetchError(e) ? "unavailable" : "auth" };
  }
}

/**
 * Darf dieser (bereits GEPRÜFTE) Nutzer Pro-Inhalte sehen? Gleiche Regel wie
 * viewerCanSeePro() in lib/spots.ts, nur mit der ID aus dem Bearer-Token. Gelesen wird mit
 * dem Service-Client (die ID ist verifiziert, es gibt keine Nutzer-Eingabe). Keine Zeile =
 * nein. Ein DB-Fehler WIRFT dagegen: Die App darf einen DB-Aussetzer nicht für "Pro weg"
 * halten und die Offline-Vollversionen eines zahlenden Nutzers löschen; die Routen antworten
 * dann 503 (appFailure). Das Web bleibt in viewerCanSeePro bei seinem fail-closed.
 */
export async function appCanSeePro(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await createServiceClient()
    .from("profiles")
    .select("is_pro, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.is_pro) || data?.role === "admin";
}

/**
 * Frischer Client im Namen des Nutzers: RLS gilt mit SEINER Identität. Pro Aufruf neu, weil
 * der Authorization-Header am Client hängt. Nie eine Sitzung oder einen Token auf den
 * geteilten Service-Client legen: Der nächste Aufrufer liefe dann mit fremden Rechten.
 */
export function createBearerClient(token: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}
