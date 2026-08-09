import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { ACCENT, CREAM, esc, INK, MUTED } from "@/lib/mail-layout";

// DIE echte 404 der App. Der Proxy (src/proxy.ts) schreibt jede unbekannte Adresse
// hierher um; die Adresszeile im Browser bleibt dabei unverändert. Warum ein Route
// Handler: Innerhalb des Seitenbaums streamt Next die Antwort (loading.tsx auf
// [locale]) und der Status ist immer 200, egal wo notFound() fällt – nur ein Route
// Handler darf den Status frei setzen (Details in [locale]/[...rest]/page.tsx).
//
// Optik: eigenständige Fassung der [locale]/not-found.tsx (dieselben Kacheln, dieselben
// Texte aus dem NotFound-Namensraum, dieselben Farb-Konstanten aus mail-layout.ts –
// EINE Textquelle, npm run i18n:check prüft sie mit). Tailwind gibt es in einem Route
// Handler nicht, deshalb Inline-CSS wie in global-error.tsx. Wer das LAYOUT der 404
// ändert, ändert BEIDE Dateien.
//
// Sprache: x-sg-locale-Header, den setzt der Proxy IMMER (aus dem Pfad-Präfix, bei
// präfixlosen Adressen aus Cookie/Default). Der Fallback hier ist nur Gürtel+Hosenträger.

// Ein Beacon wie in components/Analytics.tsx: Vor dem Proxy-Rewrite zählten tote Links
// als kind:"other" in der Reichweitenmessung (die Serie, mit der man nach dem Umzug
// tote WordPress-Links aufspürt) – dieser Mini-Nachbau erhält genau das. Gleiche
// Semantik wie die App: nur wer JS ausführt, zählt (Bot-Sonden bleiben wie bisher
// draußen), gesendet wird die ECHTE Adresse aus location (das Rewrite versteckt sie
// dem Server gegenüber nicht dem Browser). CSP erlaubt 'unsafe-inline'.
const BEACON = `<script>
try {
  var p = new URLSearchParams(location.search);
  fetch("/api/track", { method: "POST", credentials: "omit", keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: location.pathname,
      referrer: document.referrer || null,
      locale: document.documentElement.lang,
      utm: { source: p.get("utm_source") || p.get("s") || null,
             medium: p.get("utm_medium") || null,
             campaign: p.get("utm_campaign") || p.get("c") || null } })
  }).catch(function () {});
} catch (e) {}
</script>`;

// Fertige Seiten je Sprache einmal pro Instanz bauen (Muster wie das merged-Memo in
// i18n/request.ts): Bot-Stürme auf Müll-Adressen kosten dann nur noch Header-Check +
// Map-Zugriff statt jedes Mal Übersetzer + Template.
const pageCache = new Map<string, string>();

async function renderPage(locale: string): Promise<string> {
  const cached = pageCache.get(locale);
  if (cached) return cached;

  const t = await getTranslations({ locale, namespace: "NotFound" });
  const home = getPathname({ locale, href: "/" }); // folgt der zentralen Routing-Config

  // Karten-Look wie überall: Creme-Hintergrund, weiße Kacheln mit weichem Schatten,
  // 22px-Radius, Akzent-Knopf. min-height 100svh ist erlaubt: bildschirmfüllende
  // Fläche im Fluss (Fall 2 der Viewport-Regel in globals.css).
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(t("title"))} · SalzGuide</title>
<style>
  body { margin: 0; min-height: 100svh; display: flex; align-items: center; justify-content: center;
    padding: 24px calc(24px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(24px + env(safe-area-inset-left));
    box-sizing: border-box; background: ${CREAM}; color: ${INK};
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    text-align: center; }
  .tiles { position: relative; height: 96px; width: 96px; margin: 0 auto; }
  .tile { display: grid; place-items: center; background: #fff; border-radius: 22px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 12px 32px -20px rgba(0,0,0,0.28); }
  .boot { position: absolute; right: -28px; top: -12px; height: 56px; width: 56px;
    border-radius: 16px; font-size: 26px; transform: rotate(12deg); }
  .compass { position: relative; height: 96px; width: 96px; font-size: 46px; transform: rotate(-6deg); }
  .kicker { margin: 32px 0 0; font-size: 11px; font-weight: 600; letter-spacing: 0.14em;
    text-transform: uppercase; color: rgba(108,91,87,0.8); }
  h1 { margin: 4px 0 0; font-size: 24px; font-weight: 700; line-height: 1.2; }
  p.body { margin: 8px auto 0; max-width: 24rem; font-size: 15px; line-height: 1.6; color: ${MUTED}; }
  a.home { display: inline-block; margin-top: 28px; border-radius: 999px; background: ${ACCENT};
    color: #fff; font-size: 15px; font-weight: 600; padding: 14px 24px; min-height: 44px;
    box-sizing: border-box; text-decoration: none;
    box-shadow: 0 10px 24px -10px rgba(204,41,36,0.55); }
</style>
</head>
<body>
<main>
  <div class="tiles" aria-hidden="true">
    <span class="tile boot">🥾</span>
    <span class="tile compass">🧭</span>
  </div>
  <p class="kicker">404</p>
  <h1>${esc(t("title"))}</h1>
  <p class="body">${esc(t("body"))}</p>
  <a class="home" href="${esc(home)}">${esc(t("home"))}</a>
</main>
${process.env.NODE_ENV === "production" ? BEACON : ""}
</body>
</html>`;

  pageCache.set(locale, html);
  return html;
}

export async function GET(request: Request) {
  const fromProxy = request.headers.get("x-sg-locale");
  const locale = hasLocale(routing.locales, fromProxy) ? fromProxy : routing.defaultLocale;

  return new Response(await renderPage(locale), {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Doppelt genäht zum <meta name="robots">: Auch wer nur Header liest, sieht noindex.
      "x-robots-tag": "noindex",
    },
  });
}

// Bot-Sonden schicken auch POST (wp-login.php!). Ohne diese Aliasse antwortete Next
// 405 Method Not Allowed samt Allow-Header – eine nicht existierende Adresse ist aber
// bei jeder Methode eine 404. HEAD leitet Next selbst aus GET ab.
export { GET as DELETE, GET as PATCH, GET as POST, GET as PUT };
