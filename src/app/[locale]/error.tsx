"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { reportClientError } from "@/lib/ops-client";

// Die Fehlerseite für alles unterhalb von /[locale]. Greift, wenn beim Rendern einer Seite
// oder einer Client-Komponente eine Ausnahme hochkommt.
//
// WARUM ES SIE VORHER NICHT GAB, und warum das ein Loch war:
// Ohne diese Datei zeigt Next seine eigene Fehlerseite. In Produktion ist das eine weisse
// Seite mit „Application error: a client-side exception has occurred" — englisch, ohne
// Ausweg, ohne unsere Gestaltung. Wer dort landet, schliesst den Tab. Schlimmer: Wir
// erfahren nichts davon, denn ein Fehler im Browser erreicht den Server nie.
//
// Sie tut deshalb zwei Dinge, und das zweite ist das wichtigere:
//   1. Sie sieht aus wie die App und bietet einen Weg zurück.
//   2. Sie MELDET (reportClientError). Erst dadurch taucht der Fehler überhaupt in unserem
//      Logbuch auf.
//
// WAS SIE NICHT FÄNGT: Fehler im Layout darüber (dafür app/global-error.tsx) und Fehler
// ausserhalb des Renderns, also in Klick-Handlern, Timern und offenen Promises (dafür der
// globale Mitschnitt in components/Analytics.tsx).

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Error");

  // `error` in den Abhängigkeiten, nicht ein leeres Feld: React kann dieselbe Grenze mit
  // einem NEUEN Fehler erneut auslösen, ohne die Komponente dazwischen abzubauen. Mit einem
  // leeren Feld bliebe der zweite Fehler ungemeldet.
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    // min-h-[100svh]: im Fluss gehört svh hin, nicht dvh (springt beim Scrollen) und nicht
    // vh (ignoriert die Browserleisten am iPhone). Siehe die Viewport-Regel in globals.css.
    <div className="flex min-h-[100svh] flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-[420px]">
        <h1 className="text-[22px] font-bold leading-tight text-ink">{t("title")}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{t("body")}</p>

        <div className="mt-7 flex flex-col gap-2">
          {/* `reset()` baut den Teilbaum neu auf, ohne die ganze Seite neu zu laden. Bei
              einem vorübergehenden Fehler (Netz weg, Abfrage im falschen Moment) ist das
              der schnellste Weg zurück. */}
          <button
            type="button"
            onClick={reset}
            className="sg-hit rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-white transition active:scale-[0.98]"
          >
            {t("retry")}
          </button>
          <Link
            href="/"
            className="sg-hit rounded-full px-6 py-3 text-[15px] font-semibold text-muted transition active:scale-[0.98]"
          >
            {t("home")}
          </Link>
        </div>

        {/* Die Kennung steht auch im Server-Logbuch. Wer sie uns durchgibt, führt uns direkt
            zur richtigen Zeile — das ist der ganze Zweck, deshalb klein und unaufdringlich. */}
        {error.digest && (
          <p className="mt-8 text-[11px] text-muted/70">
            {t("code")}: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
