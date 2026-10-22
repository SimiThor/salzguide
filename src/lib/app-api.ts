import "server-only";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { DEFAULT_LOCALE, LOCALE_CODES } from "@/i18n/locales";
import { clientIp } from "@/lib/analytics";
import { logOps } from "@/lib/ops";
import { createServiceClient } from "@/lib/supabase/service";
import { appViewer } from "@/lib/app-auth";
import type { AppErrorCode } from "@/lib/app-api-types";

// Gemeinsame Helfer der Routen unter /api/app/v1. Keine CORS-Header mit Absicht: Die native
// App braucht keine, und Browser auf fremden Origins sollen die Antworten nicht lesen können.

/**
 * Erfolgsantwort. "private" darf die App kurz zwischenspeichern, "no-store" nie (Audio-URLs,
 * Profil). `Vary: Authorization`, weil dieselbe URL je nach Nutzer eine andere Fassung liefert.
 */
export function appJson(body: unknown, cache: "private" | "no-store", status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": cache === "private" ? "private, max-age=60" : "private, no-store",
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

/** Für den Catch jeder Route: melden (ohne Query, ohne Token) und neutral mit 503 antworten. */
export async function appFailure(req: Request, error: unknown): Promise<NextResponse> {
  await logOps("server_error", {
    error,
    path: new URL(req.url).pathname,
    group: "app-api",
  });
  return appError("unavailable", 503);
}
