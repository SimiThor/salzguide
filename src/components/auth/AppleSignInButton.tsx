"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

// "Mit Apple anmelden" fürs Web (docs/41 Abschnitt 5, Entscheidung 23.10.2026).
//
// WARUM IM BROWSER STATT ALS SERVER-ACTION: Der Google-Knopf ruft eine Server-Action, die
// Supabase die URL bauen lässt und dann weiterleitet. Für Apple startet der Browser-Client
// den Ablauf selbst. Das geht, weil @supabase/ssr den PKCE-Code-Verifier im Cookie ablegt
// (nicht im localStorage) und /[locale]/auth/callback den `code` mit dem Server-Client
// gegen die Sitzung tauscht, der dieselben Cookies liest. Der Callback unterscheidet nicht,
// wer den Ablauf gestartet hat.
//
// Rücksprung-Adresse: window.location.origin statt authOrigin(). authOrigin() ist nur auf
// dem Server nutzbar und schützt dort vor gefälschten Host-Headern; hier ist der Origin die
// Adresse, auf der der Verifier-Cookie gerade liegt, und genau dorthin muss Supabase
// zurückspringen, sonst fände der Callback den Cookie nicht. Welche Rücksprünge Supabase
// überhaupt zulässt, bestimmt dessen Redirect-Allowlist (docs/34).
//
// `next` wird wie bei Google geprüft (nur Pfade auf dieser Seite). Der Callback prüft es
// beim Zurückkommen noch einmal gegen die Origin (safeNextPath).

/** Dieselbe Regel wie safeNext() in profil/actions.ts: nur "/pfad", nie "//host" oder "/\host". */
function safeNext(raw: string | undefined, locale: string): string {
  const v = raw ?? "";
  return /^\/(?![/\\])[^\s]*$/.test(v) ? v : `/${locale}/profil`;
}

// Apple-Logo (Simple Icons, CC0). Inline -> keine externe Ressource (CSP).
function AppleIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden focusable="false" fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

export default function AppleSignInButton({ next }: { next?: string }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);

  // Zurück-Taste (bfcache): Die Seite kommt mit "busy" wieder, obwohl der Ablauf abgebrochen
  // wurde. Dann den Knopf freigeben.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function start() {
    if (busy) return;
    setBusy(true);
    const nextPath = safeNext(next, locale);
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: `${window.location.origin}/${locale}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      // Bei Erfolg navigiert der Browser selbst zu Supabase und weiter zu Apple.
      if (error) throw error;
    } catch {
      // `next` reist mit, wie bei fehlgeschlagenen Mail-Links (auth/callback fail()).
      window.location.assign(
        `/${locale}/profil?auth_error=1&next=${encodeURIComponent(nextPath)}`,
      );
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      className="cursor-pointer flex w-full items-center justify-center gap-2.5 rounded-full border border-black bg-black px-5 py-3.5 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-70"
    >
      <AppleIcon className="h-[18px] w-[18px]" />
      {t("appleCta")}
    </button>
  );
}
