import { appError, appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppSpotLive } from "@/lib/app-api-types";
import { appCanSeePro, createBearerClient, createGuestClient } from "@/lib/app-auth";
import { loadSpotLive } from "@/lib/spot-live";
import { loadSpotDetail } from "@/lib/spots";

export const runtime = "nodejs";

/**
 * Wetter, Öffnungszeiten, Wassertemperatur. Alles wird aus dem MASKIERTEN Spot-Detail
 * abgeleitet (siehe loadSpotLive): Für einen gesperrten Spot gibt es weder Position noch
 * Place-ID noch See, die Antwort ist leer und verrät den Ort nicht.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const slug = (await params).slug;
    if (!slug || slug.length > 200 || /[\s/\\]/.test(slug)) return appError("not_found", 404);

    const canSeePro = await appCanSeePro(ctx.userId);
    const spot = await loadSpotDetail(slug, ctx.lang, canSeePro);
    if (!spot) return appError("not_found", 404);

    // Öffnungszeiten lesen mit der Sicht des Betrachters (RLS wie im Web).
    const client = ctx.token ? createBearerClient(ctx.token) : createGuestClient();
    const body: AppSpotLive = await loadSpotLive(spot, client, ctx.lang);
    return appJson(body, "private-5min");
  } catch (e) {
    return appFailure(req, e);
  }
}
