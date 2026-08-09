// Fehler aus dem Browser an den Server melden. Läuft NUR im Browser.
//
// Bewusst ohne "use client" und ohne React: Das hier sind zwei Funktionen, die von
// Client-Komponenten (den Fehlergrenzen) aufgerufen werden. Ein Modul, das nur im Browser
// läuft, muss nicht selbst eine Komponente sein.
//
// KEINE ABHÄNGIGKEIT ZU lib/ops.ts. Die trägt "server-only", und ein Import davon in eine
// Client-Komponente wirft die GANZE App auf HTTP 500, ohne dass tsc oder ESLint etwas sagen.
// Deshalb geht die Meldung hier über eine normale Anfrage an /api/ops/client-error, und die
// Bewertung („wie schlimm ist das, muss eine Mail raus?") passiert erst dort.
// lib/ops-events.ts dagegen ist absichtlich browser-tauglich (nur Daten + reine Funktionen),
// von dort kommt der Chunk-Fehler-Erkenner.

import { isChunkLoadError } from "./ops-events";

/**
 * Meldungen, die man WEGWERFEN muss, sonst besteht das Fehlerbild irgendwann nur noch aus
 * ihnen. Alle vier sind Klassiker, keiner davon ist je unser Fehler:
 *
 *   "Script error."           Ein Fehler aus einem fremden Skript (anderer Ursprung). Der
 *                             Browser verrät aus Sicherheitsgründen weder Datei noch Zeile —
 *                             die Meldung besteht buchstäblich aus diesen zwei Wörtern.
 *   ResizeObserver …          Eine Warnung, keine Störung. Chrome meldet sie, wenn ein
 *                             Layout in derselben Runde nachrechnet. Passiert bei uns bei
 *                             jedem Sheet, das sich öffnet.
 *   chrome-extension:// u.ä.  Der Fehler stammt aus einer Erweiterung im Browser des
 *                             Besuchers. Wir können nichts daran ändern, und es sind viele.
 *   AbortError / cancelled    Ein Ladevorgang, den der Nutzer selbst abgebrochen hat, indem
 *                             er weitergeklickt hat. Genau so soll es sein.
 */
const IGNORE = [
  /^script error\.?$/i,
  /resizeobserver loop/i,
  /^(chrome|moz|safari|webkit)-extension:/i,
  /\b(aborterror|the operation was aborted|cancelled|canceled)\b/i,
  /^load failed$/i, // Safari, wenn das Netz während einer Anfrage wegbricht
];

function worthReporting(message: string): boolean {
  const m = message.trim();
  if (m.length < 3) return false;
  return !IGNORE.some((re) => re.test(m));
}

/**
 * Einen Fehler melden. Wirft nie und gibt nichts zurück.
 *
 * `keepalive: true` ist der Kern: Ein Fehler passiert oft genau dann, wenn die Seite gerade
 * verlassen oder neu geladen wird. Ohne dieses Flag bricht der Browser die Anfrage beim
 * Wegnavigieren ab, und ausgerechnet die Fehler, die zum Verlassen führen, kämen nie an.
 *
 * `credentials: "omit"` wie bei der Reichweitenmessung: Diese Anfrage braucht keine Cookies,
 * also bekommt sie auch keine. Damit kann die Meldung niemandem zugeordnet werden.
 */
export function reportClientError(
  error: unknown,
  source: "seite" | "global" = "seite",
): void {
  try {
    if (typeof window === "undefined") return;

    const message =
      error instanceof Error
        ? error.message || error.name
        : typeof error === "string"
          ? error
          : String(error ?? "");
    if (!worthReporting(message)) return;

    // Nexts Fehler-Kennung: Bei Server-Fehlern steht sie auch in unserem Server-Logbuch.
    // Damit lassen sich beide Seiten desselben Vorfalls zusammenführen.
    const digest =
      typeof (error as { digest?: unknown })?.digest === "string"
        ? (error as { digest: string }).digest
        : undefined;

    void fetch("/api/ops/client-error", {
      method: "POST",
      credentials: "omit",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        digest,
        // Nur der Pfad. Der Query-String bleibt draussen, dort stehen Anmelde-Tokens
        // (?token_hash=…) — der Server schneidet ihn ohnehin ab, aber gar nicht erst
        // senden ist besser als hinterher entfernen.
        path: window.location.pathname,
        source,
      }),
    }).catch(() => {
      /* Melden ist Kür. Wenn das auch nicht geht, ist ohnehin gerade alles kaputt. */
    });

    // Chunk-Nachladen gescheitert: Meist hält der Besucher einen Tab vom Build VOR dem
    // letzten Deploy, dessen nachladbare Teile es auf dem CDN nicht mehr gibt. Ohne Hilfe
    // bleibt die Seite stehen, aber das nachgeladene Stück (Chat, Karte, Login-Status)
    // fehlt still — der Besucher merkt nur, dass „nichts passiert". Einmal neu laden holt
    // den frischen Build; die Meldung oben ist dank keepalive trotzdem schon unterwegs.
    //
    // Drei Riegel gegen eine Schleife oder Schlimmeres:
    //   1. Nur EINMAL je Tab-Sitzung (sessionStorage). Liegt es nicht am alten Build,
    //      steht die Seite danach wie vorher, nur mit Logbuch-Eintrag.
    //   2. Nicht offline: Sonst tauschte man eine lebende Seite gegen die Fehlerseite
    //      des Browsers. (Der Erkenner feuert auch bei Netz-Abriss, die Meldung ist
    //      dieselbe wie beim 404 auf einen alten Chunk.)
    //   3. Lässt sich der Riegel nicht SCHREIBEN, wird nicht geladen — lieber gar nicht
    //      als endlos. Und nicht im Admin: Dort stünde ein halb ausgefülltes Formular
    //      auf dem Spiel, melden reicht.
    if (isChunkLoadError(message)) {
      try {
        const KEY = "sg-chunk-reload";
        if (
          navigator.onLine !== false &&
          !/\/admin(\/|$)/.test(window.location.pathname) &&
          !sessionStorage.getItem(KEY)
        ) {
          sessionStorage.setItem(KEY, "1");
          window.location.reload();
        }
      } catch {
        /* Speicher gesperrt (Privatmodus u.ä.) -> siehe Riegel 3. */
      }
    }
  } catch {
    /* siehe oben */
  }
}

/**
 * Fehler mitschneiden, die KEINE React-Fehlergrenze erreichen.
 *
 * Die Fehlergrenzen (error.tsx) fangen nur, was beim Rendern hochkommt. Ein Fehler in einem
 * Klick-Handler, in einem Timer oder in einer nicht abgefangenen Promise läuft an ihnen
 * vorbei und landet still in der Browser-Konsole des Besuchers — also nirgends.
 *
 * Gibt eine Aufräum-Funktion zurück (für useEffect).
 */
export function listenForClientErrors(): () => void {
  const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message, "global");
  const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason, "global");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
