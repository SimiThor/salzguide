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

  // Aktualisiert die Auth-Session (Cookies) bei jedem Request
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Alle Pfade außer API, Next-Internals und Dateien mit Endung (z.B. .png).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
