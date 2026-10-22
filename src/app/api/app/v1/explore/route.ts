import { appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppExplore } from "@/lib/app-api-types";
import { appCanSeePro } from "@/lib/app-auth";
import { loadExploreData } from "@/lib/spots";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    // Die Betrachter-Entscheidung fällt HIER, außerhalb von unstable_cache; in den Cache
    // geht nur der fertige Wert (pro|public), sonst fröre ein Pro-Kunde seine Fassung ein.
    const canSeePro = await appCanSeePro(ctx.userId);
    const data = await loadExploreData(ctx.lang, canSeePro);
    const body: AppExplore = { lang: ctx.lang, tier: canSeePro ? "pro" : "public", ...data };
    return appJson(body, "private");
  } catch (e) {
    return appFailure(req, e);
  }
}
