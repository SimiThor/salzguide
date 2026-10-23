import { appError, appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppSaved } from "@/lib/app-api-types";
import { createBearerClient } from "@/lib/app-auth";
import { getSavedSlugsFor, getSavedSpotsFor } from "@/lib/saved";

export const runtime = "nodejs";

/**
 * Die Merkliste des Nutzers. Dieselben Lese-Funktionen wie das Web, nur mit dem Bearer-Client:
 * Die RLS entscheidet (eigene Listen, Pro-Spots nur für Pro), nichts wird hier gefiltert.
 */
export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    if (!ctx.userId || !ctx.token) return appError("auth", 401);
    const client = createBearerClient(ctx.token);
    const [slugs, spots] = await Promise.all([
      getSavedSlugsFor(client),
      getSavedSpotsFor(client, ctx.lang),
    ]);
    const body: AppSaved = { lang: ctx.lang, slugs: [...slugs], spots };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
