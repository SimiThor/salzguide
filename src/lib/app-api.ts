import "server-only";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { DEFAULT_LOCALE, LOCALE_CODES } from "@/i18n/locales";
import { clientIp } from "@/lib/analytics";
import { logOps } from "@/lib/ops";
import { createServiceClient } from "@/lib/supabase/service";
import { appActor, appViewer, createBearerClient } from "@/lib/app-auth";
import type { User } from "@supabase/supabase-js";
import type { AppErrorCode, AppMe } from "@/lib/app-api-types";

// Gemeinsame Helfer der Routen unter /api/app/v1. Keine CORS-Header mit Absicht: Die native
// App braucht keine, und Browser auf fremden Origins sollen die Antworten nicht lesen können.

/**
 * Erfolgsantwort. "private" darf die App kurz zwischenspeichern, "no-store" nie (Audio-URLs,
 * Profil). `Vary: Authorization`, weil dieselbe URL je nach Nutzer eine andere Fassung liefert.
 */
export function appJson(
  body: unknown,
  cache: "private" | "private-5min" | "no-store",
  status = 200,
): NextResponse {
  const cacheControl =
    cache === "private"
      ? "private, max-age=60"
      : cache === "private-5min"
        ? "private, max-age=300"
        : "private, no-store";
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": cacheControl,
      Vary: "Authorization",
    },
  });
}

/** Fehlerantwort mit festem Code. Nie ein roher Fehlertext: Die App wertet nur den Code aus. */
export function appError(code: AppErrorCode, status: number): NextResponse {
  return NextResponse.json(
    { error: code },
    { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } },
  );
}

/** Sprache aus `?lang=`. Fehlt sie: Deutsch. Unbekannt: null (Route antwortet 400 invalid). */
export function appLang(req: Request): string | null {
  const lang = new URL(req.url).searchParams.get("lang");
  if (lang === null || lang === "") return DEFAULT_LOCALE;
  return LOCALE_CODES.includes(lang) ? lang : null;
}

const RATE_WINDOW_SECONDS = 300;
const RATE_MAX_PER_IP = 300;

// Pseudonymisiert wie in api/track: In rate_limits steht nie eine Klartext-IP.
function ipSubject(ip: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
  return `app-ip:${createHash("sha256").update(`${ip}:${salt}`).digest("hex").slice(0, 32)}`;
}

/**
 * Darf diese IP noch fragen? Nutzt hit_rate_limit (Migration 0055), wie /api/track.
 *
 * GROSSZÜGIG (300 in 5 Minuten), weil sich hinter dem WLAN eines Hotels oder Campingplatzes
 * viele Gäste eine Adresse teilen und die App beim Start mehrere Aufrufe auf einmal macht.
 * FÄLLT OFFEN AUS: Hakt die Datenbank oder fehlt die IP, wird durchgelassen. Das Limit soll
 * Schleifen bremsen, nicht die App abschalten, wenn die Zählung selbst ausfällt.
 */
export async function appRateLimit(req: Request): Promise<boolean> {
  const ip = clientIp(req);
  if (!ip) return true;
  try {
    const { data } = await createServiceClient().rpc("hit_rate_limit", {
      p_subject: ipSubject(ip),
      p_window_seconds: RATE_WINDOW_SECONDS,
      p_max: RATE_MAX_PER_IP,
    });
    return data !== false;
  } catch {
    return true;
  }
}

/**
 * Zusätzliche Grenze je KONTO für teure Routen (z. B. Apple-Kauf: bis zu 50 Signaturprüfungen
 * je Anfrage). Die IP-Grenze oben ist großzügig und für Hotel-WLANs gebaut; ein einzelnes Konto
 * hat kein Recht auf 300 Anfragen. Gleiche Regeln: Schlüssel gehasht, fällt offen aus.
 */
export async function appUserRateLimit(
  userId: string,
  bucket: string,
  windowSeconds: number,
  max: number,
): Promise<boolean> {
  try {
    const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
    const hash = createHash("sha256").update(`${userId}:${salt}`).digest("hex").slice(0, 32);
    const { data } = await createServiceClient().rpc("hit_rate_limit", {
      p_subject: `app-user:${bucket}:${hash}`,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    return data !== false;
  } catch {
    return true;
  }
}

export type AppContext = { lang: string; userId: string | null; token: string | null };

/**
 * Vorspann jeder Route, in fester Reihenfolge: Limit (429), Sprache (400), Betrachter
 * (401 bei kaputtem/abgelaufenem Token, 503 wenn Supabase gerade nicht antwortet).
 * Liefert den Kontext oder eine fertige Antwort, die die Route unverändert zurückgibt.
 */
export async function appGuard(req: Request): Promise<AppContext | NextResponse> {
  if (!(await appRateLimit(req))) return appError("rate_limit", 429);

  const lang = appLang(req);
  if (!lang) return appError("invalid", 400);

  const viewer = await appViewer(req);
  if (!viewer.ok) {
    return viewer.reason === "auth" ? appError("auth", 401) : appError("unavailable", 503);
  }
  return { lang, userId: viewer.userId, token: viewer.token };
}

export type AppActContext = AppContext & { userId: string; token: string; user: User };

/**
 * Vorspann jeder SCHREIBENDEN Route: wie appGuard (Limit, Sprache), aber der Betrachter wird
 * zusätzlich beim Auth-Server bestätigt (appActor). Gast, anonyme Anmeldung, gelöschtes oder
 * gesperrtes Konto = 401; Ausfall des Auth-Servers = 503.
 */
export async function appActGuard(req: Request): Promise<AppActContext | NextResponse> {
  if (!(await appRateLimit(req))) return appError("rate_limit", 429);

  const lang = appLang(req);
  if (!lang) return appError("invalid", 400);

  const actor = await appActor(req);
  if (!actor.ok) {
    return actor.reason === "auth" ? appError("auth", 401) : appError("unavailable", 503);
  }
  return { lang, userId: actor.userId, token: actor.token, user: actor.user };
}

/**
 * JSON-Body einer schreibenden Route lesen: höchstens `maxBytes`, nur application/json, ein
 * Objekt. null = ungültig (Route antwortet 400 invalid). Leerer Body zählt als `{}`.
 */
export async function appReadJson(
  req: Request,
  maxBytes = 4000,
): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const raw = await req.text();
  if (raw.length > maxBytes) return null;
  if (raw.trim() === "") return {};
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Für den Catch jeder Route: melden (ohne Query, ohne Token) und neutral mit 503 antworten. */
export async function appFailure(req: Request, error: unknown): Promise<NextResponse> {
  await logOps("server_error", {
    error,
    path: new URL(req.url).pathname,
    group: "app-api",
  });
  return appError("unavailable", 503);
}

/**
 * Die eigene Profilzeile als AppMe (GET /me und Antwort von PATCH /me). Im Namen des Nutzers
 * gelesen: RLS liefert nur die eigene Zeile. Die Spalten sind ausgewählt, nicht "*", damit nie
 * Rolle oder Stripe-Felder in die Antwort geraten.
 *
 * null = Token oder Konto taugt nicht, die Route antwortet 401 (die App loggt aus). Alles
 * andere ist ein Ausfall und WIRFT (Route: appFailure, 503).
 */
export async function appLoadMe(
  userId: string,
  token: string,
  fallbackLang: string,
): Promise<AppMe | null> {
  const { data, error, status } = await createBearerClient(token)
    .from("profiles")
    .select("email, locale, newsletter_opt_in, is_pro, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    // PostgREST lehnt den JWT selbst ab (PGRST301/302/303, HTTP 401): Token taugt nicht, die
    // App soll ausloggen. 403 gehört NICHT dazu: Das ist ein GRANT-/RLS-Fehler auf unserer
    // Seite und muss als 503 mit Ops-Alarm sichtbar werden, statt still alle App-Nutzer
    // auszuloggen.
    if (
      error.code === "PGRST301" ||
      error.code === "PGRST302" ||
      error.code === "PGRST303" ||
      status === 401
    ) {
      return null;
    }
    throw error;
  }
  // Keine Zeile: Das Konto gibt es nicht mehr. Die App soll ausloggen.
  if (!data) return null;
  return {
    userId,
    email: (data.email as string | null) ?? null,
    canSeePro: Boolean(data.is_pro) || data.role === "admin",
    locale: (data.locale as string | null) ?? fallbackLang,
    newsletter: Boolean(data.newsletter_opt_in),
  };
}
