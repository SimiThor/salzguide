import { appActGuard, appError, appFailure, appJson } from "@/lib/app-api";
import type { AppMyTourDeleted, AppTour } from "@/lib/app-api-types";
import { appCanSeePro, createBearerClient } from "@/lib/app-auth";
import { isUserTourId, loadUserTourDetail, removeUserTour } from "@/lib/user-tours-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Eine eigene Runde, in der Form von GET /tours/{slug} (`AppTour`): Die App zeigt sie mit
 * ihrem Tour-Detail. Sicht des Betrachters wie im Web (Stopps ab dem dritten ohne Pro
 * gesperrt, signierte Links nur fuer freie Stopps). Fremde und unbekannte Runden = 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await appActGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const id = (await params).id;
    if (!isUserTourId(id)) return appError("not_found", 404);
    const tour = await loadUserTourDetail(createBearerClient(ctx.token), id, ctx.lang, () => appCanSeePro(ctx.userId));
    if (!tour) return appError("not_found", 404);
    const body: AppTour = { lang: ctx.lang, tier: tour.canSeePro ? "pro" : "public", tour };
    // no-store: Die Audio-URLs sind signiert und zwei Stunden gueltig.
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}

/**
 * Eigene Runde loeschen. IDEMPOTENT: Eine Runde, die es nicht (mehr) gibt oder die einem
 * anderen gehoert, antwortet genauso mit 200 (die RLS loescht nur eigene Zeilen; es wird
 * nicht verraten, ob die ID existiert). Nur eine keine-UUID-ID ist 400.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await appActGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const id = (await params).id;
    if (!isUserTourId(id)) return appError("invalid", 400);
    if (!(await removeUserTour(createBearerClient(ctx.token), id))) return appError("unavailable", 503);
    const body: AppMyTourDeleted = { deleted: true };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
