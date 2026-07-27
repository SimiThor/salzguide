"use client";

import { useEffect } from "react";
import { listenForClientErrors } from "@/lib/ops-client";

// Der Mitschnitt für Browser-Fehler, die an den Fehlergrenzen VORBEILAUFEN.
//
// error.tsx und global-error.tsx fangen nur, was beim RENDERN hochkommt. Ein Fehler in einem
// Klick-Handler, in einem Timer, in einer Karten-Rückmeldung oder in einer nicht abgefangenen
// Promise ist für React unsichtbar: Die Seite bleibt stehen, der Knopf tut nichts, und in der
// Konsole des Besuchers steht etwas, das wir nie zu sehen bekommen. Bei einer App, deren
// halbe Oberfläche im Browser lebt (Karte, Sheets, Chat, Upload), ist das der grösste blinde
// Fleck überhaupt.
//
// EIGENE KOMPONENTE UND NICHT ZWEI ZEILEN IN Analytics.tsx:
// Analytics steigt früh aus (kein Tracking im Admin, keins ohne Produktion, keins für den
// Betreiber). Jede dieser Regeln ist für die Reichweitenmessung richtig und für Fehler falsch
// — gerade der Admin-Bereich soll Fehler melden, und gerade unsere eigenen Klicks finden sie.
// Zwei Zeilen in der falschen Datei hätten den Mitschnitt still zur Hälfte abgeschaltet.
//
// Nur in Produktion: Lokal steht derselbe Fehler ohnehin in der Konsole, gross und mit
// Stacktrace. Die Meldung wäre nur ein zweiter, schlechterer Blick auf dasselbe — und sie
// würde Zeilen in die echte Datenbank schreiben (siehe `active()` in lib/ops.ts).
export default function ClientErrorWatch() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    return listenForClientErrors();
  }, []);

  return null;
}
