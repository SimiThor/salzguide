import { appError, appFailure, appGuard, appJson, appUserRateLimit } from "@/lib/app-api";
import { appCanSeePro } from "@/lib/app-auth";
import { clientIp } from "@/lib/analytics";
import { loadTourPackage } from "@/lib/tour-package";
import { safeTourSlug } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Erster Abruf einer Runde rechnet die Route (bis 20 s Frist beim Routendienst).
export const maxDuration = 30;

/**
 * Offline-Paket einer Runde (docs/41 6.3, docs/42): Tour-Detail wie GET /tours/{slug}, dazu
 * Route mit Schritten, Kartenausschnitt, Bilder, Audio und contentHash. Die Route kommt aus
 * tour_nav_routes (unser eigener Routendienst, nie Mapbox) und wird beim ersten Abruf oder
 * nach einer Änderung der Runde gerechnet.
 *
 * no-store: Die Audio-Links sind signiert und zwei Stunden gültig.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const slug = safeTourSlug((await params).slug);
    if (!slug) return appError("not_found", 404);

    // Das Paket kann den Routendienst anstossen und ist die teuerste Leseroute: zusätzlich
    // zur IP-Grenze 30 Abrufe in 10 Minuten je Konto bzw. je IP für Gäste.
    const ip = clientIp(req);
    const subject = ctx.userId ?? (ip ? `ip:${ip}` : null);
    if (subject && !(await appUserRateLimit(subject, "package", 600, 30))) return appError("rate_limit", 429);

    const canSeePro = await appCanSeePro(ctx.userId);
    const r = await loadTourPackage({ slug, lang: ctx.lang, canSeePro });
    if (r.kind === "not_found") return appError("not_found", 404);
    // Routendienst nicht erreichbar (oder nicht eingerichtet): Das Paket ohne Linie wäre
    // eine halbe Runde, deshalb 503. Die App wiederholt später. Gemeldet hat es der Dienst-
    // Aufruf schon (routing_failed bzw. config_missing).
    // no-route und invalid sind keine Ausfaelle, ein Wiederholen aendert nichts: 422, damit die
    // App nicht endlos nachfasst. Alles andere (Dienst weg, nicht eingerichtet) ist 503.
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
