import { clientCountry } from "@/lib/analytics";
import { appActGuard, appError, appFailure, appJson } from "@/lib/app-api";
import type { AppSavedState } from "@/lib/app-api-types";
import { createBearerClient } from "@/lib/app-auth";
import { isEventId, setSavedEventFor } from "@/lib/saved-event-core";

export const runtime = "nodejs";

// Event merken und entmerken, IDEMPOTENT (anders als toggleSavedEvent im Web). Handeln:
// anonyme Konten und Gäste bekommen 401. Unbekannte oder nicht veröffentlichte Events = 404.
async function setSaved(
  req: Request,
  params: Promise<{ id: string }>,
  saved: boolean,
): Promise<Response> {
  const ctx = await appActGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const id = (await params).id;
    if (!isEventId(id)) return appError("not_found", 404);

    const outcome = await setSavedEventFor(createBearerClient(ctx.token), ctx.userId, id, saved, {
      device: "other",
      country: clientCountry(req),
      locale: new URL(req.url).searchParams.get("lang") ? ctx.lang : null,
    });
    if (outcome === "not_found") return appError("not_found", 404);
    if (outcome === "failed") throw new Error(`saved event ${saved ? "put" : "delete"} failed`);

    const body: AppSavedState = { saved };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}

export function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return setSaved(req, params, true);
}

export function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return setSaved(req, params, false);
}
