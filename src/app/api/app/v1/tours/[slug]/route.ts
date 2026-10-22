import { appError, appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppTour } from "@/lib/app-api-types";
import { appCanSeePro } from "@/lib/app-auth";
import { getTourDetailFor } from "@/lib/tours";
import { safeTourSlug } from "@/lib/url";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const slug = safeTourSlug((await params).slug);
    if (!slug) return appError("not_found", 404);

    const canSeePro = await appCanSeePro(ctx.userId);
    // Keine Entwurfs-Vorschau über die App: Der Admin-Check ist fest "nein".
    const tour = await getTourDetailFor(slug, ctx.lang, canSeePro, async () => false);
    if (!tour) return appError("not_found", 404);

    const body: AppTour = { lang: ctx.lang, tier: canSeePro ? "pro" : "public", tour };
    // no-store: Die Audio-URLs sind signiert und zwei Stunden gültig.
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
