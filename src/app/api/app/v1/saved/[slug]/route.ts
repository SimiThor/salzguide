import { clientCountry } from "@/lib/analytics";
import { appActGuard, appError, appFailure, appJson } from "@/lib/app-api";
import type { AppSavedState } from "@/lib/app-api-types";
import { createBearerClient } from "@/lib/app-auth";
import { setSavedFor } from "@/lib/saved-core";

export const runtime = "nodejs";

// Merken und Entmerken, IDEMPOTENT (anders als toggleSaved im Web, das umschaltet): Eine App
// mit schlechtem Netz wiederholt Anfragen, und ein zweites PUT darf nicht wieder entmerken.
// Pro-Spots, die die RLS für diesen Nutzer ausblendet, sind für uns "unbekannt" (404), genau
// wie ein falscher Slug: Die API verrät nicht, dass es den Spot gibt.
async function setSaved(
  req: Request,
  params: Promise<{ slug: string }>,
  saved: boolean,
): Promise<Response> {
  const ctx = await appActGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    // Gleiche Grenzen wie /spots/{slug}: Slugs haben kein festes Format.
    const slug = (await params).slug;
    if (!slug || slug.length > 200 || /[\s/\\]/.test(slug)) return appError("not_found", 404);

    const outcome = await setSavedFor(createBearerClient(ctx.token), ctx.userId, slug, saved, {
      // Der Standard-User-Agent von URLSession enthält kein "iPhone": classifyDevice hielte die
      // App für Desktop. "other" ist ehrlich, bis /track ein eigenes Feld hat (docs/41 4.3).
      device: "other",
      country: clientCountry(req),
      // Ohne ?lang= liefert appLang "de" als Standard; als Analytics-Sprache wäre das falsch.
      locale: new URL(req.url).searchParams.get("lang") ? ctx.lang : null,
    });
    if (outcome === "not_found") return appError("not_found", 404);
    if (outcome === "failed") throw new Error(`saved ${saved ? "put" : "delete"} failed`);

    const body: AppSavedState = { saved };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}

export function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return setSaved(req, params, true);
}

export function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return setSaved(req, params, false);
}
