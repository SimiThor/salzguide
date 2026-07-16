"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { isOperatorClient } from "@/lib/analytics-operator";

// Cookieless Pageview-Beacon (docs/34 §H). Setzt/liest NICHTS am Gerät, sendet nur
// Pfad + Referrer an /api/track. Nur in Produktion aktiv (kein Dev-Rauschen) und
// NICHT für den eingeloggten Betreiber/Admin (nur echte Besucher zählen).
export default function Analytics() {
  const pathname = usePathname();
  const locale = useLocale();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (pathname.startsWith("/admin")) return; // Admin-Seiten grundsätzlich nicht tracken
    if (lastSent.current === pathname) return; // Doppel-Sends vermeiden

    const path = pathname;
    const loc = locale;
    let cancelled = false;

    void isOperatorClient().then((operator) => {
      if (cancelled || operator) return; // Betreiber (Admin) nicht mitzählen
      if (lastSent.current === path) return;
      lastSent.current = path;

      // Kampagnen-Attribution aus der Einstiegs-URL: utm_* bzw. Kurzform ?s=&c=
      // (für saubere IG/TikTok-Ad-Links wie salzguide.com/?c=ig-sommer24).
      const p = new URLSearchParams(window.location.search);
      const utm = {
        source: p.get("utm_source") || p.get("s") || null,
        medium: p.get("utm_medium") || null,
        campaign: p.get("utm_campaign") || p.get("c") || null,
      };

      void fetch("/api/track", {
        method: "POST",
        credentials: "omit", // truly cookieless: keine Cookies mitsenden
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path,
          referrer: document.referrer || null,
          locale: loc,
          utm,
        }),
      }).catch(() => {});
    });

    return () => {
      cancelled = true;
    };
  }, [pathname, locale]);

  return null;
}
