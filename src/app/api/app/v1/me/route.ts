import { appError, appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppMe } from "@/lib/app-api-types";
import { createBearerClient } from "@/lib/app-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    // Hier ist Anmeldung Pflicht: Gast = 401.
    if (!ctx.userId || !ctx.token) return appError("auth", 401);

    // Im Namen des Nutzers lesen: RLS liefert nur die eigene Zeile. Die Spalten sind
    // ausgewählt, nicht "*", damit nie Rolle oder Stripe-Felder in die Antwort geraten.
    const { data, error, status } = await createBearerClient(ctx.token)
      .from("profiles")
      .select("email, locale, newsletter_opt_in, is_pro, role")
      .eq("id", ctx.userId)
      .maybeSingle();
    if (error) {
      // PostgREST lehnt den JWT selbst ab (PGRST301/302/303, HTTP 401): Token taugt nicht, die
      // App soll ausloggen. 403 gehört NICHT dazu: Das ist ein GRANT-/RLS-Fehler auf unserer
      // Seite und muss als 503 mit Ops-Alarm sichtbar werden, statt still alle App-Nutzer
      // auszuloggen. Alles andere ist ein Ausfall und geht an appFailure.
      if (
        error.code === "PGRST301" ||
        error.code === "PGRST302" ||
        error.code === "PGRST303" ||
        status === 401
      ) {
        return appError("auth", 401);
      }
      throw error;
    }
    // Keine Zeile: Das Konto gibt es nicht mehr. Die App soll ausloggen.
    if (!data) return appError("auth", 401);

    const body: AppMe = {
      userId: ctx.userId,
      email: (data.email as string | null) ?? null,
      canSeePro: Boolean(data.is_pro) || data.role === "admin",
      locale: (data.locale as string | null) ?? ctx.lang,
      newsletter: Boolean(data.newsletter_opt_in),
    };
    return appJson(body, "no-store");
  } catch (e) {
    return appFailure(req, e);
  }
}
