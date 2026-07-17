import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// Crawlbar außer API + Admin. Rechts-Seiten bleiben crawlbar (ihr noindex-Meta greift).
export default function robots(): MetadataRoute.Robots {
  // Im Rumpf, nicht als Modul-Konstante: Sonst friert der Wert beim Import ein.
  const BASE = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/*/admin", "/*/admin/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
