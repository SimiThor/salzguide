import { appError, appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppSpot } from "@/lib/app-api-types";
import { appCanSeePro } from "@/lib/app-auth";
import { loadSpotDetail } from "@/lib/spots";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    // Spot-Slugs legt der Admin nur mit trim() an, ein festes Format gibt es nicht (anders als
    // bei Touren). Darum nur grobe Grenzen, der Slug geht unverändert (Groß/Klein) an die DB.
    // Ungültig ist 404 und nicht 400: Die API verrät nicht, was "gültig" wäre.
    const slug = (await params).slug;
    if (!slug || slug.length > 200 || /[\s/\\]/.test(slug)) return appError("not_found", 404);

    const canSeePro = await appCanSeePro(ctx.userId);
    const spot = await loadSpotDetail(slug, ctx.lang, canSeePro);
    if (!spot) return appError("not_found", 404);

    const body: AppSpot = { lang: ctx.lang, tier: canSeePro ? "pro" : "public", spot };
    return appJson(body, "private");
  } catch (e) {
    return appFailure(req, e);
  }
}
