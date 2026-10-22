import { appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppTours } from "@/lib/app-api-types";
import { getPublishedTours } from "@/lib/tours";

export const runtime = "nodejs";

// Tourenliste ist für alle gleich (Struktur, kein Audio); Anmeldung optional.
export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const body: AppTours = { lang: ctx.lang, tours: await getPublishedTours(ctx.lang) };
    return appJson(body, "private");
  } catch (e) {
    return appFailure(req, e);
  }
}
