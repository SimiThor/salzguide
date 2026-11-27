import { appActGuard, appError, appFailure, appJson, appUserRateLimit } from "@/lib/app-api";
import { retireGuestAccount } from "@/lib/apple-purchase-core";
import { supabaseAppleStore } from "@/lib/apple-purchase";

// POST /api/app/v1/me/retire-guest: Das Gerät hat sich angemeldet und braucht sein bisheriges Gast-Konto (anonym, Kauf
// ohne Konto) nicht mehr. Die App ruft das MIT DEM SCHLÜSSEL DES GAST-KONTOS auf, also kann nur dieses Konto sich selbst
// austragen. Regeln in retireGuestAccount (apple-purchase-core.ts): nur anonym; ein Gast-Konto mit eigenem Kauf bleibt
// (Regel 2a holt den Kauf ins echte Konto und räumt es dabei ab). Anton 27.11.2026: keine verwaisten Gast-Konten im Admin.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await appActGuard(req, { allowAnonymous: true });
  if (ctx instanceof Response) return ctx;
  try {
    if (!ctx.anonymous) return appError("invalid", 400);
    if (!(await appUserRateLimit(ctx.userId, "retire-guest", 600, 5))) return appError("rate_limit", 429);
    const result = await retireGuestAccount(supabaseAppleStore(), ctx.userId);
    return appJson({ result }, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
