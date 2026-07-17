import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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
  "img-src 'self' data: blob: https://*.supabase.co https://*.mapbox.com https://*.tiles.mapbox.com",
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
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com https://challenges.cloudflare.com",
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
  // Bild-Pipeline: moderne Formate (AVIF/WebP) + On-Demand-Resize (next/image liefert je
  // nach Anzeige-Größe passende Auflösungen aus dem 1600px-WebP-Master -> ein 44px-Thumbnail
  // lädt ~44px statt 1600px). Quelle = öffentlicher Supabase-Storage.
  images: {
    formats: ["image/avif", "image/webp"],
    // Erlaubte Qualitätsstufen (Next 16 lässt nur genau diese zu). 75 = Standard für grosse
    // Bilder; 62 für Galerie/Hero; 50 für winzige Thumbnails/Icons, wo man den Unterschied
    // ohnehin nicht sieht. Kleinere Zahl = kleinere Datei.
    qualities: [50, 62, 75],
    // Jede Quell-URL zeigt für immer auf dasselbe Bild (fester UUID-Pfad, upsert:false,
    // siehe lib/image-upload.ts). Also darf next/image die einmal gerechnete Fassung ein
    // Jahr behalten, statt sie nach wenigen Stunden neu aus dem Storage zu holen.
    minimumCacheTTL: 31536000,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
