import { appActGuard, appError, appFailure, appJson, appUserRateLimit } from "@/lib/app-api";
import { appCanSeePro, createBearerClient } from "@/lib/app-auth";
import { loadMyTourPackage } from "@/lib/app-builder";
import { isUserTourId } from "@/lib/user-tours-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Jeder Abruf rechnet die Route neu (bis 20 s Frist beim Routendienst).
export const maxDuration = 30;

/**
 * Offline-Paket einer eigenen Runde, in der Form von GET /tours/{slug}/package
 * (`AppTourPackage`): Tour-Detail, Route mit Schritten, Kartenausschnitt, Bilder, Audio,
 * contentHash. Eigene Runden haben keine gespeicherte Navigationsroute; sie wird je Abruf aus
 * unserem Routendienst gerechnet (Start, Halte, zurueck zum Start) und nie abgelegt.
 * Fremde und unbekannte Runden = 404. 30 Abrufe in 10 Minuten je Konto.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await appActGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const id = (await params).id;
    if (!isUserTourId(id)) return appError("not_found", 404);
    if (!(await appUserRateLimit(ctx.userId, "my-package", 600, 30))) return appError("rate_limit", 429);

    const r = await loadMyTourPackage({
      client: createBearerClient(ctx.token),
      id,
      lang: ctx.lang,
      canSeePro: () => appCanSeePro(ctx.userId),
    });
    if (r.kind === "not_found") return appError("not_found", 404);
    if (r.kind === "unavailable") {
      if (r.code === "no-route") return appError("no_route", 422);
      if (r.code === "invalid") return appError("invalid", 422);
      return appError("unavailable", 503);
    }
    return appJson(r.pkg, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
