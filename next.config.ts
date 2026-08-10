import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { legacyRedirects } from "./src/lib/legacy-redirects";

const withNextIntl = createNextIntlPlugin();

// Sicherheits-Header auf ALLEN Routen (docs/02 §17, docs/34).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" }, // Clickjacking
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Karte nutzt Geolocation (nur eigene Seite); Kamera/Mikro/USB nicht gebraucht.
    value: "geolocation=(self), camera=(), microphone=(), usb=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

// Content-Security-Policy (docs/34 §C3) — vorerst REPORT-ONLY: bricht nichts,
// meldet Verstöße nur in der Browser-Konsole. Nach dem Testen (keine Verstöße bei
// normaler Nutzung inkl. Karte/Login/KI) auf enforce umstellen (Header-Key ohne
// "-Report-Only"). Nur in Produktion, damit das Dev-HMR (eval) nicht zuspammt.
// Quellen: Supabase (REST/Realtime/Storage), Mapbox (Tiles/Worker/Events).
const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https://*.supabase.co https://*.mapbox.com https://*.tiles.mapbox.com https://*.wien.gv.at",
  "media-src 'self' blob: https://*.supabase.co",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // 'wasm-unsafe-eval' erlaubt WebAssembly (ffmpeg.wasm für die Admin-Videokompression).
  // challenges.cloudflare.com = Turnstile-Widget (Bot-Schutz am Login).
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  // Turnstile rendert in einem iframe von challenges.cloudflare.com.
  "frame-src 'self' https://challenges.cloudflare.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com https://challenges.cloudflare.com https://*.wien.gv.at",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const headers =
  process.env.NODE_ENV === "production"
    ? [
        ...securityHeaders,
        { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
      ]
    : securityHeaders;

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers }];
  },
  // Die Adressen der alten WordPress-Seite. Sie stehen hier und nicht im Proxy, weil
  // next.config-Weiterleitungen VOR dem Proxy laufen (dokumentierte Reihenfolge: headers,
  // redirects, Proxy) — und unser Proxy ist das Sprach-Routing. Läge die Regel dahinter,
  // käme /alle/gaisberg/ dort schon als /de/alle/gaisberg an und träfe nie.
  // Begründung je Zeile: src/lib/legacy-redirects.ts.
  async redirects() {
    return legacyRedirects;
  },
  // Bild-Pipeline: moderne Formate (AVIF/WebP) + On-Demand-Resize (next/image liefert je
  // nach Anzeige-Größe passende Auflösungen aus dem 1600px-WebP-Master -> ein 44px-Thumbnail
  // lädt ~44px statt 1600px). Quelle = öffentlicher Supabase-Storage.
  images: {
    formats: ["image/avif", "image/webp"],
    // EINE Stufe für alles: 62 ist der Wert, den vorher schon Galerie/Hero nutzten, und
    // bei Thumbnails sieht man den Unterschied zu 50 nicht. Jede Bild-Stelle setzt
    // quality={62} explizit oder läuft durch SmoothImage/GalleryImage (Default 62).
    // 75 bleibt NUR als Sicherheitsnetz erlaubt: Es ist der next/image-Standard, und der
    // Optimizer lehnt nicht gelistete Stufen hart mit 400 ab. Eine künftig vergessene
    // quality-Angabe lädt so ein etwas größeres Bild statt gar keines.
    qualities: [62, 75],
    // KLEIN / MITTEL / GROSS statt 13 Breiten (Entscheidung 10.08.2026, Vercel-Kontingent):
    // Jede Kombination aus (Bild-URL, Breite, Qualität, Format) ist ein bezahlter
    // Optimizer-Job. Drei Breiten drücken die Jobs pro Foto auf höchstens 6
    // (3 Breiten x 2 Formate x 1 Qualität) und decken trotzdem alle Anzeige-Größen:
    //
    // deviceSizes = für `sizes`-Angaben mit vw (Hero, Karten, Galerie).
    //   1200 = MITTEL: Handy-Hero bei 100vw (2x = 780, 3x = 1170) und alle vw-Karten.
    //   2048 = GROSS: Landing-Hero und Desktop-Vollbild; unsere Masters sind ohnehin
    //   nur 1600px (Hero 2048, siehe image-upload.ts), mehr gäbe es nicht.
    deviceSizes: [1200, 2048],
    // imageSizes = für feste Pixel-Angaben. 384 = KLEIN: deckt jedes feste Thumbnail
    // der App (40 bis 128px) auch auf 3x-Displays ab (128 x 3 = 384).
    imageSizes: [384],
    // Jede Quell-URL zeigt für immer auf dasselbe Bild (fester UUID-Pfad, upsert:false,
    // siehe lib/image-upload.ts). Also darf next/image die einmal gerechnete Fassung ein
    // Jahr behalten, statt sie nach wenigen Stunden neu aus dem Storage zu holen.
    minimumCacheTTL: 31536000,
    remotePatterns: [
      {
        protocol: "https",
        // GENAU unser Supabase-Projekt, aus der ENV abgeleitet (zieht beim Projekt-
        // Wechsel automatisch mit). Der Wildcard *.supabase.co liesse den Optimizer
        // Bilder JEDES fremden Supabase-Projekts laden und rechnen – ein bekannter
        // Quota-/Kosten-Missbrauchsvektor auf Vercel. Fallback nur, falls die ENV im
        // Build fehlt (dann soll der Build nicht an einer URL-Parse-Stelle sterben).
        hostname: process.env.NEXT_PUBLIC_SUPABASE_URL
          ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
          : "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
