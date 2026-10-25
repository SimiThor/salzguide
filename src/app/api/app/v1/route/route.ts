import { LOCALE_CODES, DEFAULT_LOCALE } from "@/i18n/locales";
import { clientIp } from "@/lib/analytics";
import {
  appError,
  appFailure,
  appJson,
  appRateLimit,
  appReadJson,
  appUserRateLimit,
} from "@/lib/app-api";
import type { AppReroute } from "@/lib/app-api-types";
import { appCanSeePro, appViewer } from "@/lib/app-auth";
import type { LngLat } from "@/lib/routing/types";
import { planReroute, rerouteTour } from "@/lib/tour-reroute";
import { getTourDetailFor } from "@/lib/tours";
import { safeTourSlug } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Routendienst-Frist beim Umrouten 8 s (docs/42 Abschnitt 6) plus Datenbank.
export const maxDuration = 20;

const ALLOWED = new Set(["tourSlug", "from", "mode", "lang", "keep", "alongM", "viaAlongM"]);
const MAX_BODY_BYTES = 4000;
const MAX_VIA_ENTRIES = 40;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseFrom(v: unknown): LngLat | null {
  if (!Array.isArray(v) || v.length !== 2 || !finite(v[0]) || !finite(v[1])) return null;
  if (Math.abs(v[0]) > 180 || Math.abs(v[1]) > 90) return null;
  return [v[0], v[1]];
}

/**
 * Umrouten (docs/42 Abschnitt 7): neue Linie und Abbiegeschritte ab der Position des Gastes
 * über die noch offenen Stopps der Runde. Optionale Anmeldung wie GET /tours/{slug}.
 *
 * KEIN freier Routendienst: Der Server baut die Kette selbst aus der Runde (nur mit den
 * Koordinaten, die /tours/{slug} diesem Betrachter zeigt), `from` muss nahe an der Linie
 * der Runde liegen. Ergebnisse werden NICHT gespeichert, Koordinaten nie geloggt.
 *
 * Grenzen: IP (wie alle Routen) und dazu 60 Anfragen in 10 Minuten je Konto bzw. 120 je IP
 * für Gäste (Hotel-WLAN teilt sich eine Adresse). stepNav rechnet höchstens alle 10 s (Rad)
 * bzw. 20 s (Fuss) neu, das sind 60 bzw. 30 in 10 Minuten.
 */
export async function POST(req: Request) {
  if (!(await appRateLimit(req))) return appError("rate_limit", 429);
  try {
    const body = await appReadJson(req, MAX_BODY_BYTES);
    if (!body || Object.keys(body).some((k) => !ALLOWED.has(k))) return appError("invalid", 400);

    const queryLang = new URL(req.url).searchParams.get("lang");
    const lang = typeof body.lang === "string" ? body.lang : queryLang || DEFAULT_LOCALE;
    if (!LOCALE_CODES.includes(lang)) return appError("invalid", 400);

    const viewer = await appViewer(req);
    if (!viewer.ok) return viewer.reason === "auth" ? appError("auth", 401) : appError("unavailable", 503);

    const ip = clientIp(req);
    const subject = viewer.userId ?? (ip ? `ip:${ip}` : null);
    if (subject && !(await appUserRateLimit(subject, "route", 600, viewer.userId ? 60 : 120)))
      return appError("rate_limit", 429);

    const slug = typeof body.tourSlug === "string" ? safeTourSlug(body.tourSlug) : null;
    const from = parseFrom(body.from);
    if (!slug || !from) return appError("invalid", 400);
    if (body.mode !== undefined && body.mode !== "bike" && body.mode !== "walk") return appError("invalid", 400);
    if (body.alongM !== undefined && (!finite(body.alongM) || body.alongM < 0 || body.alongM > 1e6))
      return appError("invalid", 400);
    let keep: number[] | undefined;
    if (body.keep !== undefined) {
      if (!Array.isArray(body.keep) || body.keep.some((k) => !Number.isInteger(k))) return appError("invalid", 400);
      keep = body.keep as number[];
    }
    let viaAlongM: Record<string, number> | undefined;
    if (body.viaAlongM !== undefined) {
      const o = body.viaAlongM;
      if (!o || typeof o !== "object" || Array.isArray(o)) return appError("invalid", 400);
      const entries = Object.entries(o as Record<string, unknown>);
      if (entries.length > MAX_VIA_ENTRIES || entries.some(([, v]) => !finite(v))) return appError("invalid", 400);
      viaAlongM = Object.fromEntries(entries) as Record<string, number>;
    }

    // Wie GET /tours/{slug}: dieselbe Sicht des Betrachters, keine Entwurfs-Vorschau.
    const canSeePro = await appCanSeePro(viewer.userId);
    const detail = await getTourDetailFor(slug, lang, canSeePro, async () => false);
    if (!detail) return appError("not_found", 404);
    if (body.mode !== undefined && body.mode !== detail.mode) return appError("invalid", 400);

    const planned = planReroute(detail, { from, keep, alongM: body.alongM as number | undefined, viaAlongM });
    if (!planned.ok) return appError("invalid", 400);

    const r = await rerouteTour(detail, planned.plan);
    if (!r.ok) {
      // Gemeldet hat es schon der Dienst-Aufruf (routing_failed, config_missing), ohne Koordinaten.
      if (r.code === "no-route") return appError("no_route", 422);
      if (r.code === "invalid") return appError("invalid", 400);
      return appError("unavailable", 503);
    }
    const out: AppReroute = { lang, tier: canSeePro ? "pro" : "public", route: r.route };
    return appJson(out, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
