import { appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppWater } from "@/lib/app-api-types";
import { appCanSeePro } from "@/lib/app-auth";
import { freshLakes, getLakeSpotsFor, getWaterMaps } from "@/lib/water-temp";

export const runtime = "nodejs";

/**
 * Wassertemperaturen der Badeseen, dieselben Funktionen wie die Webseite /wasser: nur Seen mit
 * aktueller (höchstens 7 Tage), plausibler Messung. Die Spots am See sind je Betrachter
 * maskiert (Pro-Spots als `locked-N`-Teaser), die Entscheidung fällt hier, außerhalb des Caches.
 */
export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const canSeePro = await appCanSeePro(ctx.userId);
    const [maps, lakeSpots] = await Promise.all([
      getWaterMaps(),
      getLakeSpotsFor(ctx.lang, canSeePro),
    ]);
    const body: AppWater = {
      lang: ctx.lang,
      tier: canSeePro ? "pro" : "public",
      lakes: freshLakes(maps, lakeSpots, Date.now()),
    };
    return appJson(body, "private");
  } catch (e) {
    return appFailure(req, e);
  }
}
