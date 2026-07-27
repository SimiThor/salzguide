"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/ops-client";

// Der allerletzte Auffangkorb: Fehler im WURZEL-Layout selbst.
//
// Diese Datei ersetzt im Fehlerfall das komplette Dokument, deshalb müssen `<html>` und
// `<body>` hier von Hand stehen. Genau daraus folgen zwei Dinge, die sonst wie Schlamperei
// aussehen und beide Absicht sind:
//
//   KEINE TAILWIND-KLASSEN, sondern Inline-Styles. `globals.css` wird vom Layout geladen —
//   und das Layout ist gerade das, was kaputt ist. Eine Fehlerseite, deren Gestaltung davon
//   abhängt, dass die Seite funktioniert, ist keine Fehlerseite.
//
//   KEINE ÜBERSETZUNG. Der NextIntlClientProvider sitzt ebenfalls im Layout. `useTranslations`
//   würde hier werfen, und ein Fehler IN der Fehlergrenze ist eine weisse Seite ohne alles.
//   Deshalb zwei feste Sätze, Deutsch und Englisch untereinander: Diese Seite bekommt fast
//   niemand je zu sehen, und wer sie sieht, soll den Ausweg verstehen, egal woher er kommt.
//
// Gemeldet wird trotzdem, und das ist hier der eigentliche Wert: Ein kaputtes Wurzel-Layout
// trifft JEDE Seite gleichzeitig. Das ist der einzige Fehler dieser App, bei dem wirklich
// niemand mehr irgendetwas sieht — und der Grund, warum die Meldung nicht am Layout hängen
// darf.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "global");
  }, [error]);

  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#faf6ec",
          color: "#111111",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div style={{ color: "#cc2924", fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
            SalzGuide
          </div>
          <h1 style={{ margin: "14px 0 0", fontSize: 20, fontWeight: 700, lineHeight: 1.3 }}>
            Da ist etwas schiefgelaufen
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.6, color: "#6C5B57" }}>
            Der Fehler ist bei uns notiert. Meistens hilft ein zweiter Versuch.
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.6, color: "#6C5B57" }}>
            Something went wrong. We&rsquo;ve logged the error, a second try usually does it.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 26,
              border: "none",
              borderRadius: 999,
              background: "#cc2924",
              color: "#ffffff",
              fontSize: 15,
              fontWeight: 600,
              padding: "13px 26px",
              cursor: "pointer",
              // 44 Punkt Trefferfläche, wie überall in der App.
              minHeight: 44,
            }}
          >
            Nochmal versuchen / Try again
          </button>

          {error.digest && (
            <p style={{ marginTop: 30, fontSize: 11, color: "rgba(108,91,87,0.7)" }}>
              Fehlercode: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
