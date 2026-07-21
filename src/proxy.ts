import { createServerClient } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleIntl = createIntlMiddleware(routing);

// next-intl (Locale-Routing) + Supabase-Session-Refresh in einem.
export default async function proxy(request: NextRequest) {
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
  // Alle Pfade außer API, Next-Internals, Dateien mit Endung (z.B. .png) und der
  // internen Render-Route (/render/*): die soll KEIN Locale-Präfix bekommen, sie ist
  // sprachneutral und wird nur vom Intro-Renderer aufgerufen.
  matcher: "/((?!api|_next|_vercel|render|.*\\..*).*)",
};
