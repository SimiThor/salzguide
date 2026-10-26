import {
  appActGuard,
  appError,
  appFailure,
  appGuard,
  appJson,
  appReadJson,
  appUserRateLimit,
} from "@/lib/app-api";
import type { AppBuilder, AppBuilderResult } from "@/lib/app-api-types";
import { appCanSeePro, createBearerClient } from "@/lib/app-auth";
import {
  BUILDER_BURST,
  BUILDER_DAILY,
  BUILDER_INTERESTS,
  BUILDER_MAX_FREE_TEXT,
  BUILDER_MAX_TOURS,
  builderAreas,
  interestLabels,
  parseBuilderBody,
  toMyTourSummary,
} from "@/lib/app-builder";
import { buildAndSaveTour } from "@/lib/tour-generate-core";
import { countUserTours, insertUserTour, listUserTourSummaries } from "@/lib/user-tours-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Claude (30 s, eine Wiederholung) plus Routendienst (20 s) plus Datenbank.
export const maxDuration = 120;

const MAX_BODY_BYTES = 2000;

/**
 * Was der Runden-Bauer braucht: Gebiete, Interessen und ob dieser Betrachter bauen darf.
 * Optionale Anmeldung (ein Gast sieht den Bauer gesperrt: `blocked: "login"`).
 */
export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const canGenerate = ctx.userId ? await appCanSeePro(ctx.userId) : false;
    const body: AppBuilder = {
      lang: ctx.lang,
      canGenerate,
      blocked: canGenerate ? null : ctx.userId ? "pro" : "login",
      areas: await builderAreas(ctx.lang),
      interests: BUILDER_INTERESTS,
      maxFreeText: BUILDER_MAX_FREE_TEXT,
      maxTours: BUILDER_MAX_TOURS,
    };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}

/**
 * Runde bauen und fuer das Konto speichern (derselbe Kern wie die Web-Aktion generateTour).
 *
 * Nur Pro, nur echte Anmeldung (Gaeste und anonyme Konten: 401), Pro wird serverseitig
 * geprueft und zusaetzlich von der RLS beim Speichern (0072). Bauen kostet Geld (Claude,
 * Routendienst), deshalb: 3 Laeufe in 10 Minuten und 10 am Tag je Konto, bei Ausfall der
 * Zaehlung gilt "nein" (fail-closed), dazu hoechstens 50 gespeicherte Runden je Konto.
 * Das Web hat diese Grenzen nicht.
 */
export async function POST(req: Request) {
  const ctx = await appActGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const raw = await appReadJson(req, MAX_BODY_BYTES);
    const input = raw ? parseBuilderBody(raw) : null;
    if (!input) return appError("invalid", 400);

    // Die Sprache der Anfrage steht schon im Kontext (?lang=); ein lang im Body muss dazu passen.
    if (raw && raw.lang !== undefined && raw.lang !== ctx.lang) return appError("invalid", 400);

    if (!(await appCanSeePro(ctx.userId))) return appError("pro", 403);

    const client = createBearerClient(ctx.token);
    const have = await countUserTours(client);
    if (have === null) return appError("unavailable", 503);
    if (have >= BUILDER_MAX_TOURS) return appError("limit", 409);

    if (!(await appUserRateLimit(ctx.userId, "builder-burst", BUILDER_BURST.windowSeconds, BUILDER_BURST.max, true)))
      return appError("rate_limit", 429);
    if (!(await appUserRateLimit(ctx.userId, "builder-daily", BUILDER_DAILY.windowSeconds, BUILDER_DAILY.max, true)))
      return appError("rate_limit", 429);

    const r = await buildAndSaveTour({
      areaId: input.areaId,
      interests: await interestLabels(ctx.lang, input.interestKeys),
      freeText: input.freeText,
      locale: ctx.lang,
      canSeePro: true,
      save: (s) => insertUserTour(client, ctx.userId, s),
      ai: { retries: 1, timeoutMs: 30_000 },
    });
    if (!r.ok) {
      if (r.error === "area") return appError("not_found", 404);
      if (r.error === "too_few" || r.error === "no_start") return appError("too_few", 422);
      if (r.error === "pro") return appError("pro", 403);
      return appError("unavailable", 503);
    }
    if (!r.id) return appError(r.saveError === "pro" ? "pro" : "unavailable", r.saveError === "pro" ? 403 : 503);

    // Die Kachel aus der frisch gespeicherten Zeile (RLS: eigene), nicht aus dem Generator.
    const mine = (await listUserTourSummaries(client, ctx.lang)).find((s) => s.id === r.id);
    if (!mine) return appError("unavailable", 503);
    const out: AppBuilderResult = { lang: ctx.lang, id: r.id, tour: toMyTourSummary(mine) };
    return appJson(out, "no-store", 201);
  } catch (e) {
    return appFailure(req, e);
  }
}
