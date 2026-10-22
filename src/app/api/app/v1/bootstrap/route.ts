import { createHash } from "node:crypto";
import { DEFAULT_LOCALE, LOCALE_CODES } from "@/i18n/locales";
import { appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppBootstrap } from "@/lib/app-api-types";
import { siteUrl } from "@/lib/site-url";
import { loadExploreData } from "@/lib/spots";
import { getPublishedTours } from "@/lib/tours";

export const runtime = "nodejs";

// Start-Aufruf der App: Mindestversion, Sprachen, Kategorien, Rechtstexte. Anmeldung optional
// (ein kaputtes Token ist trotzdem 401, damit die App ihren Zustand klärt).
export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    // Immer die öffentliche Fassung: Kategorien und die Versionsnummer dürfen nicht vom
    // Betrachter abhängen, sonst flackert die App je nach Anmeldung.
    const [explore, tours] = await Promise.all([
      loadExploreData(ctx.lang, false),
      getPublishedTours(ctx.lang),
    ]);
    const categories = explore.categories.map((c) => {
      const { slugs, ...rest } = c;
      void slugs; // Spot-Listen hängen vom Betrachter ab und gehören nicht in den Start-Aufruf
      return rest;
    });
    const contentVersion = createHash("sha256")
      .update(JSON.stringify({ explore, tours }))
      .digest("hex")
      .slice(0, 16);

    const min = process.env.APP_MIN_VERSION;
    const minAppVersion = min && /^\d+\.\d+(\.\d+)?$/.test(min) ? min : "1.0.0";

    const base = `${siteUrl()}/${ctx.lang}/rechtliches`;
    const body: AppBootstrap = {
      apiVersion: 1,
      lang: ctx.lang,
      minAppVersion,
      contentVersion,
      locales: [...LOCALE_CODES],
      defaultLocale: DEFAULT_LOCALE,
      categories,
      links: {
        imprint: `${base}/impressum`,
        privacy: `${base}/datenschutz`,
        terms: `${base}/agb`,
        withdrawal: `${base}/widerruf`,
      },
    };
    return appJson(body, "private");
  } catch (e) {
    return appFailure(req, e);
  }
}
