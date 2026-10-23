import { NextResponse } from "next/server";
import { LOCALE_CODES } from "@/i18n/locales";
import { clientIp } from "@/lib/analytics";
import { appReadJson, appRateLimit, appUserRateLimit } from "@/lib/app-api";
import { logOps } from "@/lib/ops";
import type { LngLat } from "@/lib/routing/types";
import { foreignOrigin } from "@/lib/same-origin";
import { planReroute, rerouteTour } from "@/lib/tour-reroute";
import { loadCuratedChain, loadMyChain, myTourIdOf, MY_TOUR_PREFIX } from "@/lib/tour-chain";
import { safeTourSlug } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Route fuer den Fahrbildschirm im WEB (docs/42, Abschnitt 8.3): dieselbe Rechnung wie
// POST /api/app/v1/route (lib/tour-reroute.ts), nur mit der Anmeldung des Browsers (Cookie,
// derselbe Betrachter wie die Tour-Seite, inklusive Entwurfs-Vorschau fuer Admins) und mit
// Pruefung der Herkunft. Der Browser fragt NUR hierher; der Routendienst und sein Token bleiben
// auf dem Server. Nichts wird gespeichert, keine Koordinate geloggt.
//
// Antworten: { route } oder { error } mit festem Code. 422 no_route = kein Weg; 400 too_far =
// Position zu weit von der Runde; 503 no_token = Dienst nicht eingerichtet oder Token abgelehnt;
// 503 unavailable = Dienst nicht erreichbar (die Navigation haelt die alte Linie und fasst nach).

const ALLOWED = new Set(["from", "keep", "locale", "alongM", "viaAlongM"]);
// Ein Radler kann vor dem Start noch an der Anfahrt sein; der Routendienst kappt Spruenge
// ueber 30 km ohnehin.
const MAX_FROM_LINE_M = 30_000;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fail = (code: string, status: number) =>
  NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  // Nur die eigene Seite. Ein Aufruf von fremder Herkunft ist kein Fahrbildschirm.
  if (foreignOrigin(req)) return fail("forbidden", 403);
  if (!(await appRateLimit(req))) return fail("rate_limit", 429);
  try {
    const slug = safeTourSlug((await params).slug);
    const body = await appReadJson(req, 4000);
    if (!slug || !body || Object.keys(body).some((k) => !ALLOWED.has(k))) return fail("invalid", 400);

    const locale = typeof body.locale === "string" && LOCALE_CODES.includes(body.locale) ? body.locale : null;
    const from: LngLat | null =
      Array.isArray(body.from) && body.from.length === 2 && finite(body.from[0]) && finite(body.from[1]) &&
      Math.abs(body.from[0]) <= 180 && Math.abs(body.from[1]) <= 90
        ? [body.from[0], body.from[1]]
        : null;
    if (!locale || !from) return fail("invalid", 400);
    if (!Array.isArray(body.keep) || body.keep.some((k) => !Number.isInteger(k))) return fail("invalid", 400);
    if (body.alongM !== undefined && (!finite(body.alongM) || body.alongM < 0 || body.alongM > 1e6)) return fail("invalid", 400);
    let viaAlongM: Record<string, number> | undefined;
    if (body.viaAlongM !== undefined) {
      const o = body.viaAlongM;
      if (!o || typeof o !== "object" || Array.isArray(o)) return fail("invalid", 400);
      const entries = Object.entries(o as Record<string, unknown>);
      if (entries.length > 40 || entries.some(([, v]) => !finite(v))) return fail("invalid", 400);
      viaAlongM = Object.fromEntries(entries) as Record<string, number>;
    }

    // Je IP 120 Anfragen in 10 Minuten (Hotel-WLAN teilt sich eine Adresse); die Navigation
    // rechnet hoechstens alle 10 s (Rad) bzw. 20 s (Fuss) neu.
    const ip = clientIp(req);
    if (ip && !(await appUserRateLimit(`ip:${ip}`, "webroute", 600, 120))) return fail("rate_limit", 429);

    // Eigene Runden ("meine-<uuid>", KI-Builder) und kuratierte Runden. Beide laden nur die
    // Kette, mit denselben Regeln wie die Seiten (RLS bzw. veroeffentlicht, Entwurf nur Admin).
    let chain;
    if (slug.startsWith(MY_TOUR_PREFIX)) {
      const id = myTourIdOf(slug);
      if (!id) return fail("not_found", 404);
      chain = await loadMyChain(id);
    } else {
      chain = await loadCuratedChain(slug, async () => {
        // `await import`: admin-guard ist server-only und gehoert nicht in jeden Bündel-Graphen.
        const { getAdminUserId } = await import("@/lib/admin-guard");
        return Boolean(await getAdminUserId());
      });
    }
    if (!chain) return fail("not_found", 404);

    const planned = planReroute(chain, {
      from,
      keep: body.keep as number[],
      alongM: body.alongM as number | undefined,
      viaAlongM,
      keepIsGeo: true,
      maxFromLineM: MAX_FROM_LINE_M,
    });
    // Eigene Codes, damit der Fahrbildschirm sagen kann, was los ist: zu weit weg von der Runde
    // heisst etwas anderes als "Dienst nicht erreichbar".
    if (!planned.ok) return fail(planned.reason === "too-far" ? "too_far" : "invalid", 400);

    const r = await rerouteTour(chain, planned.plan);
    if (!r.ok) {
      // Gemeldet hat es schon der Dienst-Aufruf (routing_failed, config_missing), ohne Koordinaten.
      if (r.code === "no-route") return fail("no_route", 422);
      if (r.code === "invalid") return fail("invalid", 400);
      // Kein Zugang oder nicht eingerichtet: Die Navigation kann nichts tun als es zu sagen.
      if (r.code === "config" || r.code === "auth") return fail("no_token", 503);
      return fail("unavailable", 503);
    }
    return NextResponse.json({ route: r.route }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    await logOps("server_error", { error, path: new URL(req.url).pathname, group: "web-route" });
    return fail("unavailable", 503);
  }
}
