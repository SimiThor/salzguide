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

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Content-Security-Policy (docs/34 §C3) — ENFORCING seit 11.08.2026.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Bis hierher lief der Header als `-Report-Only`: Er meldete Verstöße in der Konsole und
// blockierte nichts, war also wirkungslos. Jetzt gilt: Was hier nicht steht, lädt der
// Browser nicht.
//
// WAS DIESE POLICY WIRKLICH KAUFT. `script-src` trägt 'unsafe-inline' (Next.js hängt seine
// Hydrations-Daten inline in die Seite, und JSON-LD ist ebenfalls ein Inline-Skript). Gegen
// eingeschleustes Inline-JavaScript schützt sie deshalb NICHT. Was sie schützt:
//   · `connect-src` — eingeschleuster Code kann Daten nirgendwohin abfliessen lassen.
//   · `script-src`-Herkunft — ein untergeschobenes <script src="//fremde.tld"> lädt nicht.
//   · `base-uri` — kein <base>-Tag, das alle relativen URLs umbiegt.
//   · `form-action`/`object-src`/`frame-ancestors` — kein Formular-Abfluss, kein Plugin,
//     kein Framing.
// Der nächste Schritt wäre eine Nonce statt 'unsafe-inline' (docs/34 §C3 nennt sie); die
// braucht einen Nonce aus dem Proxy plus 'strict-dynamic' und ist ein eigener Umbau.
//
// NUR IN PRODUKTION. Der Dev-Server baut mit eval (HMR) und würde die Konsole zuspammen.
// Folge fürs Testen: `npm run dev` beweist hier NICHTS. Wer diese Liste anfasst, prüft mit
// `npm run build && npx next start` und klickt Karte, Spot-Seite (Story-Maker!), Login und
// Admin-Upload durch.
//
// WARUM `blob:` IN script-src UND connect-src STEHT — die Zeile, die beim Umstellen fast
// gefehlt hätte: ffmpeg.wasm (lib/ffmpeg.ts) lädt seinen Core selbst-gehostet aus /ffmpeg,
// reicht ihn aber als blob:-URL weiter. @ffmpeg/ffmpeg startet einen Worker mit
// `type: "module"`, dort scheitert importScripts und die Bibliothek fällt auf
// `await import(blob:…)` zurück — das prüft `script-src`. Danach holt der Core sein .wasm
// per fetch von einer zweiten blob:-URL — das prüft `connect-src`. Ohne beide Einträge
// bleibt der Video-Tab im Story-Maker stumm stehen, und zwar auf der ÖFFENTLICHEN
// Spot-Seite, nicht nur im Admin. Gemessen am Produktions-Build, nicht geraten.
//
// `report-uri` schickt jeden Verstoß an api/ops/csp-report und damit in den Ops-Katalog.
// Ohne diese Zeile bräche eine Lücke in dieser Liste STILL: Die blockierte Anfrage verlässt
// den Browser nie, der Server sieht also nichts. Bewusst `report-uri` und nicht die neuere
// Reporting-API — `report-uri` können alle drei Browser-Familien, `Reporting-Endpoints` nur
// Chrome, und die Route liest ohnehin schon beide Formate.
const cspDirectives: Record<string, string[]> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://*.supabase.co",
    "https://*.mapbox.com",
    "https://*.tiles.mapbox.com",
    "https://*.wien.gv.at",
    // TESTHAKEN – NICHT DAUERHAFT (lib/google-maps-loader.ts): Kartenkacheln/Icons der
    // isolierten Google-Maps-Testnavigation. Entfernen, sobald der Test entfernt wird.
    "https://*.googleapis.com",
    "https://*.gstatic.com",
  ],
  "media-src": ["'self'", "blob:", "https://*.supabase.co"],
  // Inter kommt über next/font/google und liegt nach dem Build bei UNS — kein Google-Host.
  // TESTHAKEN: fonts.gstatic.com dazu — Googles eigene Kartensteuerung (Attribution/Logo)
  // lädt ihre Beschriftung von dort, unabhängig von next/font/google.
  "font-src": ["'self'", "https://fonts.gstatic.com"],
  // TESTHAKEN: fonts.googleapis.com dazu — die Google-Maps-Bibliothek hängt dafür ein
  // eigenes <link rel="stylesheet">-Tag ein, das reicht 'unsafe-inline' allein nicht ab.
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  // 'wasm-unsafe-eval' erlaubt WebAssembly (ffmpeg.wasm). blob: = der Core-Import oben.
  // challenges.cloudflare.com = Turnstile-Widget (Bot-Schutz an Login/Formularen).
  // TESTHAKEN: maps.googleapis.com dazu — Googles Bootstrap-Loader lädt sein <script> von
  // dort (google-maps-loader.ts), und DirectionsService.route() läuft technisch selbst
  // über ein nachgeladenes <script> (JSONP), zählt also ebenfalls als script-src.
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    "blob:",
    "https://challenges.cloudflare.com",
    "https://maps.googleapis.com",
  ],
  "worker-src": ["'self'", "blob:"],
  "child-src": ["'self'", "blob:"],
  // Turnstile rendert in einem iframe von challenges.cloudflare.com.
  "frame-src": ["'self'", "https://challenges.cloudflare.com"],
  // blob: = das .wasm des ffmpeg-Cores (siehe oben). Anthropic/ORS/ElevenLabs laufen
  // serverseitig und gehören deshalb NICHT hierher — Google Maps hier ist die EINE
  // Ausnahme, weil die Testnavigation absichtlich im Browser gegen Google spricht
  // (lib/google-bike-directions.ts), nicht über einen eigenen Server-Aufruf.
  // TESTHAKEN – NICHT DAUERHAFT: maps.googleapis.com/maps.gstatic.com entfernen, sobald
  // der Google-Maps-Test entfernt wird.
  "connect-src": [
    "'self'",
    "blob:",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://*.mapbox.com",
    "https://*.tiles.mapbox.com",
    "https://events.mapbox.com",
    "https://challenges.cloudflare.com",
    "https://*.wien.gv.at",
    "https://maps.googleapis.com",
    "https://maps.gstatic.com",
  ],
  "manifest-src": ["'self'"],
  "report-uri": ["/api/ops/csp-report"],
  "upgrade-insecure-requests": [],
};

// ───────────────────────────────────────────────────────────────────────────────────────
//  Vorschau-Deployments: dieselbe Policy, plus Vercels eigene Werkzeugleiste
// ───────────────────────────────────────────────────────────────────────────────────────
//
// Auf Vercel ist NODE_ENV auch bei einer Vorschau "production" — der scharfe Header gilt
// dort also mit. Vercel spritzt in Vorschauen aber seine Kommentar-Leiste von vercel.live
// ein (plus Pusher für die Live-Kommentare), und die wäre blockiert.
//
// Die Wahl ist bewusst NICHT „Vorschau auf Report-Only": Dann prüfte die Vorschau die
// Richtlinie nicht mehr, und der erste echte Test wäre die Produktion. So erzwingt die
// Vorschau EXAKT dieselbe Liste, nur mit vercel.live obendrauf — und salzguide.com sieht
// von Vercels Hosts nichts.
const previewOnly: Record<string, string[]> = {
  "script-src": ["https://vercel.live"],
  "connect-src": ["https://vercel.live", "wss://ws-us3.pusher.com"],
  "img-src": ["https://vercel.live", "https://vercel.com"],
  "frame-src": ["https://vercel.live"],
  "style-src": ["https://vercel.live"],
  "font-src": ["https://vercel.live", "https://assets.vercel.com"],
};

const isPreview = process.env.VERCEL_ENV === "preview";

const csp = Object.entries(cspDirectives)
  .map(([directive, sources]) =>
    [directive, ...sources, ...(isPreview ? (previewOnly[directive] ?? []) : [])].join(" "),
  )
  .join("; ");

const headers =
  process.env.NODE_ENV === "production"
    ? [...securityHeaders, { key: "Content-Security-Policy", value: csp }]
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
