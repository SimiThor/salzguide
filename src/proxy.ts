import { createServerClient } from "@supabase/ssr";
import { hasLocale } from "next-intl";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_PREFIX_RE } from "./i18n/locales";
import { routing } from "./i18n/routing";
import { isPublicRoute } from "./lib/public-routes";

const handleIntl = createIntlMiddleware(routing);

// Unbekannte Adresse -> internes Rewrite auf den 404-Handler (app/404/route.ts). Die
// Adresszeile im Browser bleibt stehen. Sprache als Request-Header, nicht als Query:
// request.url trägt hinter einem Rewrite nicht zuverlässig die neue Query, Header
// kommen garantiert an.
function rewrite404(request: NextRequest, locale: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/404";
  url.search = "";
  const headers = new Headers(request.headers);
  headers.set("x-sg-locale", locale);
  return NextResponse.rewrite(url, { request: { headers } });
}

// next-intl (Locale-Routing) + Supabase-Session-Refresh in einem.
export default async function proxy(request: NextRequest) {
  // Unbekannte Adressen SOFORT zum 404-Handler, noch vor Locale-Routing und Session:
  // Nur ein Route Handler kann in Next eine echte 404 liefern (Streaming-Hintergrund
  // in [locale]/[...rest]/page.tsx, Erlaubnis-Liste in lib/public-routes.ts).
  // Kein Session-Refresh auf 404s – hier ist nichts personalisiert, und die nächste
  // echte Seite frischt die Cookies ohnehin auf.
  const { pathname } = request.nextUrl;
  const localeMatch = pathname.match(LOCALE_PREFIX_RE);
  if (localeMatch) {
    if (!isPublicRoute(pathname.slice(localeMatch[0].length))) {
      return rewrite404(request, localeMatch[1]);
    }
  } else if (!isPublicRoute(pathname)) {
    // Müll OHNE Sprach-Präfix (/wordpress, /phpmyadmin): direkt 404 statt erst der
    // Sprach-Umleitung von handleIntl – das spart pro Bot-Sonde einen kompletten
    // zweiten Middleware-Durchlauf samt Redirect. Gültige präfixlose Pfade (/explore)
    // laufen weiter unten normal in die Sprach-Umleitung. Die alten WordPress-Pfade
    // mit Weiterleitungsregel sind hier nie zu sehen: next.config-Redirects laufen
    // VOR der Middleware. Sprache: NEXT_LOCALE-Cookie (Framework-Parser), sonst Deutsch.
    const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
    return rewrite404(
      request,
      hasLocale(routing.locales, cookieLocale) ? cookieLocale : routing.defaultLocale,
    );
  }

  const response = handleIntl(request);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Aktualisiert die Auth-Session (Cookies) bei jedem Request.
  //
  // getClaims() statt getUser(): getUser() fragt für JEDEN Request bei Supabase nach, ob das
  // Token gültig ist. Das ist ein Netzwerk-Roundtrip, der fertig sein muss, BEVOR die Seite
  // rendert — bei jedem Klick, für jeden eingeloggten Nutzer. In den Logs vom 18.07.2026
  // waren das 415 Aufrufe auf /auth/v1/user in 30 Minuten.
  //
  // getClaims() macht dasselbe ohne den Umweg: Es holt die Session (frischt abgelaufene
  // Tokens weiter auf, niemand wird ausgesperrt) und prüft die Signatur danach LOKAL gegen
  // den öffentlichen Schlüssel des Projekts. Das geht nur, weil dieses Projekt asymmetrisch
  // signiert (ES256, siehe /auth/v1/.well-known/jwks.json). Bei einem symmetrischen Secret
  // (HS256) fällt die Bibliothek von selbst auf getUser() zurück, das bliebe also korrekt.
  //
  // Sicherheit: gleichwertig. Beide Wege prüfen kryptografisch, nur eben hier statt dort.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  // Erster Eintrag: alle Pfade außer API, Next-Internals, Dateien mit Endung (z.B.
  // .png) und der internen Render-Route (/render/*): die soll KEIN Locale-Präfix
  // bekommen, sie ist sprachneutral und wird nur vom Intro-Renderer aufgerufen.
  //
  // Zweiter Eintrag: Punkt-Pfade UNTER einer Sprache (z.B. /de/wp-login.php von
  // Bot-Sonden) trotzdem durch den Proxy schicken, damit die 404-Erlaubnisliste auch
  // sie erwischt – echte Dateien (public/, _next/) tragen nie ein Sprach-Präfix.
  // Matcher müssen statische Literale sein, darum stehen die Sprachen hier doppelt
  // zur i18n/routing.ts: neue Sprache dort => auch hier ergänzen.
  matcher: [
    "/((?!api|_next|_vercel|render|.*\\..*).*)",
    "/(de|en|it|nl|ko|fr|zh|es|pt)/:path*",
  ],
};
