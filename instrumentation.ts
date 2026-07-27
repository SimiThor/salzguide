// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der Auffangkorb ganz unten: JEDER Serverfehler kommt hier vorbei.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM DIESE DATEI IM WURZELVERZEICHNIS LIEGT UND NICHT IN src/:
// Next sucht `instrumentation.ts` neben `next.config.ts` oder in `src/`. Beides geht; hier
// liegt sie oben, weil sie zum Rahmen der Anwendung gehört und nicht zu ihrem Inhalt — wie
// vercel.json und next.config.ts.
//
// WAS onRequestError ABDECKT, und warum das der wichtigste Meldepunkt überhaupt ist:
// Next ruft diesen Haken bei jedem unbehandelten Fehler auf, der aus einer Server-Komponente,
// einer Route oder einer Server-Action hochkommt. Das ist die einzige Stelle, an der man
// Fehler erwischt, die NIEMAND von Hand gefangen hat — also genau die, an die vorher niemand
// gedacht hat. Alle anderen Meldestellen in dieser App sind Absicht (jemand hat ein
// try/catch geschrieben und darin gemeldet); diese hier braucht keine.
//
// Vorher landeten diese Fehler ausschliesslich in Vercels Laufzeit-Log: Der Besucher sah
// „Something went wrong", und ob das einmal am Tag oder tausendmal passiert, wusste niemand.
//
// WAS ER NICHT ABDECKT: Fehler im Browser (dafür src/app/[locale]/error.tsx und
// src/app/global-error.tsx) und Fehler, die der Code selbst abfängt und behandelt (die melden
// sich über logOps an ihrer Stelle, mit dem passenden Ereignis-Typ statt „Serverfehler").

import type { Instrumentation } from "next";

/**
 * Läuft einmal beim Start der Server-Instanz.
 *
 * Bleibt bewusst leer: Es gibt nichts einzurichten (kein SDK, kein Agent), und was hier
 * stünde, verzögert jeden Kaltstart. Die Funktion muss trotzdem existieren, sobald die Datei
 * existiert — sonst warnt Next beim Bauen.
 */
export async function register() {}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  // NUR die Node-Laufzeit meldet. In der Edge-Laufzeit gibt es kein `node:crypto` und keinen
  // Supabase-Service-Client in der Form, die lib/ops.ts erwartet; ein Fehler beim Melden
  // eines Fehlers wäre hier besonders albern. Betroffen ist bei uns ohnehin nur proxy.ts.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    console.error("[ops] Fehler in der Edge-Laufzeit", request.path, err);
    return;
  }

  try {
    // Erst HIER laden, nicht oben. `instrumentation.ts` wird von Next in einem eigenen
    // Bündel gebaut; ein fester Import würde die halbe Anwendung mit hineinziehen, für einen
    // Pfad, der im Normalbetrieb nie läuft.
    const { logOps } = await import("@/lib/ops");
    await logOps("server_error", {
      error: err,
      path: request.path,
      detail: {
        methode: request.method,
        // `routerKind` (App/Pages) und `routeType` (render/route/action) sagen einem sofort,
        // ob es eine Seite, ein API-Endpunkt oder eine Server-Action war.
        art: `${context.routerKind}/${context.routeType}`,
        route: context.routePath ?? null,
        // Nexts eigene Fehler-Kennung. Sie steht auch auf der Fehlerseite, die der Besucher
        // sieht — damit lässt sich eine Nutzermeldung („da stand eine Nummer") einer Zeile
        // im Logbuch zuordnen.
        digest: typeof (err as { digest?: unknown })?.digest === "string"
          ? (err as { digest: string }).digest
          : null,
      },
    });
  } catch (e) {
    // Der Haken darf niemals werfen: Next würde den Fehler beim Melden des Fehlers erneut
    // hier hereinreichen.
    console.error("[ops] onRequestError selbst fehlgeschlagen", e);
  }
};
