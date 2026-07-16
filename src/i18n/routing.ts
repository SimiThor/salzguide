import { defineRouting } from "next-intl/routing";
import { LOCALE_CODES, DEFAULT_LOCALE } from "./locales";

// Sprachen kommen aus der zentralen Config (src/i18n/locales.ts). Neue Sprache dort
// eintragen + messages/<code>.json anlegen -> Routing/hreflang/Sitemap/Wähler folgen automatisch.
export const routing = defineRouting({
  locales: LOCALE_CODES,
  defaultLocale: DEFAULT_LOCALE,
});
