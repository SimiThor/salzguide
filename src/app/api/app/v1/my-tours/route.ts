import { appActGuard, appFailure, appJson } from "@/lib/app-api";
import type { AppMyTours } from "@/lib/app-api-types";
import { createBearerClient } from "@/lib/app-auth";
import { toMyTourSummary } from "@/lib/app-builder";
import { listUserTourSummaries } from "@/lib/user-tours-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meine Runden: die gespeicherten Runden des Nutzers, neueste zuerst. Derselbe Kern wie
 * `listUserTours` im Web, nur mit dem Bearer-Client: Die RLS entscheidet (nur eigene Zeilen).
 * Pflicht-Anmeldung, anonyme Konten und Gaeste = 401.
 */
export async function GET(req: Request) {
  const ctx = await appActGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const rows = await listUserTourSummaries(createBearerClient(ctx.token), ctx.lang);
    const body: AppMyTours = { lang: ctx.lang, tours: rows.map(toMyTourSummary) };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
