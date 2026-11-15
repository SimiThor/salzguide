import { appError, appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppSavedEvents } from "@/lib/app-api-types";
import { createBearerClient } from "@/lib/app-auth";
import { getSavedEventsFor } from "@/lib/events";

export const runtime = "nodejs";

/**
 * Die gemerkten, noch nicht vergangenen Events des Nutzers (getSavedEventsFor, dieselbe Abfrage
 * wie die Merkliste im Web). Im Namen des Nutzers gelesen: die RLS begrenzt auf die eigenen.
 * Vergangene Events fallen wie im Web heraus; `ids` sind genau die der gelieferten Events.
 */
export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    if (!ctx.userId || !ctx.token) return appError("auth", 401);
    const events = await getSavedEventsFor(createBearerClient(ctx.token), ctx.lang);
    const body: AppSavedEvents = { lang: ctx.lang, ids: events.map((e) => e.id), events };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
