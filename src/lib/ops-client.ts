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
 *   Failed to fetch u.ä.      Das NACKTE Netz-Wegbrech-Wort der drei Engines — Safari sagt
 *                             „Load failed", Chrome „Failed to fetch", Firefox „NetworkError
 *                             when attempting to fetch a resource". Ohne Datei und Stack ist
 *                             das nicht diagnostizierbar (Funkloch, Werbeblocker, Schlafmodus)
 *                             und stand im Logbuch bisher nur für Chrome. Alle drei anchored
 *                             als GANZE Meldung: „Failed to fetch dynamically imported
 *                             module …" (ein Chunk-Fehler, siehe unten) läuft weiter durch.
 *                             Fehlschläge unserer eigenen Anfragen sind davon unberührt —
 *                             die behandeln die Aufrufstellen selbst (Toni zeigt eine
 *                             Antwort-Panne an, der Upload meldet upload_failed usw.).
 *   Java object is gone       Android-WebView (Instagram/Facebook-In-App-Browser): Die vom
 *                             WebView selbst eingepflanzte postMessage-Brücke verliert ihr
 *                             Java-Objekt beim Aufräumen der App. Kein Code von uns beteiligt.
 */
const IGNORE = [
  /^script error\.?$/i,
  /resizeobserver loop/i,
  /^(chrome|moz|safari|webkit)-extension:/i,
  /\b(aborterror|the operation was aborted|cancelled|canceled)\b/i,
  /^load failed$/i, // Safari, wenn das Netz während einer Anfrage wegbricht
  /^failed to fetch\.?$/i, // Chrome/Edge, dasselbe Wegbrechen
  /^networkerror when attempting to fetch a resource\.?$/i, // Firefox, dasselbe
  /java object is gone/i, // Android-WebView-Brücke (In-App-Browser)
];

function worthReporting(message: string): boolean {
  const m = message.trim();
  if (m.length < 3) return false;
  return !IGNORE.some((re) => re.test(m));
}

/**
 * Gehört der fehlende Teil zu einem ANDEREN Deployment als die Seite selbst?
 *
 * WARUM DIESE FRAGE ÜBERHAUPT GESTELLT WIRD. Das Neuladen weiter unten ist für genau einen
 * Fall gebaut: Ein Tab hält noch das HTML von VOR dem letzten Deploy und fragt nach einem
 * Stück, das auf dem CDN nicht mehr liegt. Am 21.08.2026 nachgemessen, alle 104 Meldungen
 * der letzten Wochen: In 104 von 104 Fällen trug der fehlende Teil die Kennung GENAU DES
 * DEPLOYMENTS, aus dem auch die Seite kam. Kein einziger alter Tab, nicht ein Mal.
 *
 * Was stattdessen passierte: Der Teil fehlte (abgebrochene Anfrage, mobiles Netz, ein
 * Skript, das sofort weiterklickt), wir luden die Seite neu, eine Sekunde später fehlte er
 * wieder. Daher die Paare im Logbuch und die „Besucher" mit exakt zwei Aufrufen: Die zweite
 * Hälfte davon haben wir selbst erzeugt, samt doppelter Zeile in der Reichweitenmessung.
 *
 * Vercel hängt an JEDE Datei-Adresse `?dpl=<Deployment>`, im ausgelieferten HTML steht sie
 * über hundertmal. Damit lässt sich die Frage im Browser beantworten, ohne Server:
 *
 *   true   Versatz. Der Fall, für den das Neuladen gebaut ist. Es bleibt.
 *   false  Gleiches Deployment. Netz oder Abbruch, Neuladen holt dieselbe Datei nochmal.
 *   null   Nicht feststellbar (Meldung ohne Kennung, lokale Entwicklung). Dann wie bisher
 *          neu laden: Ein überflüssiger Reload ist ärgerlich, ein steckengebliebener Tab
 *          nach einem Deploy ist schlimmer.
 */
function versionsVersatz(message: string): boolean | null {
  const KENNUNG = /[?&]dpl=([A-Za-z0-9_]+)/;
  const fehlt = message.match(KENNUNG)?.[1];
  if (!fehlt) return null;
  // Irgendein Script-Tag der Seite genügt, sie tragen alle dieselbe Kennung.
  const eigen = document.querySelector('script[src*="dpl="]')?.getAttribute("src")?.match(KENNUNG)?.[1];
  if (!eigen) return null;
  return fehlt !== eigen;
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
  /** Nur vom window-Listener gesetzt: Origin des werfenden Skripts (siehe unten). */
  quelle?: string,
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
        ...(quelle ? { quelle } : {}),
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
    // Fünf Riegel gegen eine Schleife, verlorene Arbeit und sinnloses Nachladen:
    //   0. NUR bei echtem Versions-Versatz, siehe versionsVersatz() oben. Das ist der
    //      wirksamste Riegel von allen: Gemessen traf keine einzige Meldung den Fall,
    //      für den das Neuladen gebaut ist.
    //   1. Abklingzeit statt „einmal für immer": Eine echte Schleife feuert binnen
    //      Sekunden erneut und bleibt zehn Minuten blockiert; ein SPÄTERER Deploy in
    //      derselben Tab-Sitzung darf sich danach wieder selbst retten. (Alte Riegel
    //      mit Wert "1" zählen als uralt und blockieren nicht.)
    //   2. Nicht offline: Sonst tauschte man eine lebende Seite gegen die Fehlerseite
    //      des Browsers. (Der Erkenner feuert auch bei Netz-Abriss, die Meldung ist
    //      dieselbe wie beim 404 auf einen alten Chunk.)
    //   3. Nicht mitten ins Tippen: Steht der Fokus in einem Eingabefeld (Toni-Entwurf,
    //      Support-Formular), würde der Reload den Text wegwerfen — melden reicht dann.
    //      Aus demselben Grund nie im Admin, dort sind Formulare der Normalfall.
    //   4. Lässt sich der Riegel nicht SCHREIBEN, wird nicht geladen — lieber gar nicht
    //      als endlos.
    if (isChunkLoadError(message)) {
      try {
        const KEY = "sg-chunk-reload";
        const active = document.activeElement;
        const typing =
          active instanceof HTMLElement &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            active.isContentEditable);
        const last = Number(sessionStorage.getItem(KEY));
        if (
          versionsVersatz(message) !== false &&
          navigator.onLine !== false &&
          !/\/admin(\/|$)/.test(window.location.pathname) &&
          !typing &&
          !(last && Date.now() - last < 10 * 60 * 1000)
        ) {
          sessionStorage.setItem(KEY, String(Date.now()));
          window.location.reload();
        }
      } catch {
        /* Speicher gesperrt (Privatmodus u.ä.) -> siehe Riegel 4. */
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
  const onError = (e: ErrorEvent) => {
    // BEOBACHTUNGS-RELEASE für die Fremd-Skript-Frage. Am 09.08.2026 stand fünfmal
    // `document.querySelector("meta[property='og:type']").content` im Logbuch — kein
    // Code von uns liest og-Tags, das war ein von iOS eingeschleustes Skript (Share-
    // Extension oder In-App-Browser), das Open-Graph-Daten abgreifen wollte. Filtern
    // können wir erst, wenn wir WISSEN, wie WebKit solche Skripte meldet: mit leerem
    // filename oder mit der Dokument-URL. Deshalb reist hier zunächst nur die Herkunft
    // mit (Origin oder ein Wort, nie Pfad oder Query — die können Tokens tragen).
    // Zeigt das Logbuch „leer"/fremd für diese Fehler, kommt als zweiter Schritt das
    // Tor: nur noch melden, was aus unseren eigenen Bundles kommt.
    let quelle = "leer";
    if (e.filename) {
      try {
        // OHNE Basis parsen: Relative Pseudo-Namen („user-script", „<anonymous>",
        // „eval code") würden mit Basis zur Seiten-URL aufgelöst und fälschlich als
        // „eigen" etikettiert — die gefährliche Richtung, denn das spätere Tor würde
        // fremden Lärm dann dauerhaft behalten. Echte Skripte melden immer absolute
        // URLs; die Pseudo-Namen landen so im catch als „unlesbar".
        const url = new URL(e.filename);
        const origin = url.origin;
        // Opake Herkünfte (data:, blob:null, about:, webkit-masked-url:) sagen als
        // Origin wörtlich "null". Das SCHEMA ist dort die eigentliche Antwort — bei
        // maskierten Safari-Skripten steht webkit-masked-url drin, exakt der Fall,
        // für den diese Beobachtung gebaut wurde. Nur das Schema, nie Pfad oder Query.
        quelle =
          origin === "null"
            ? `opak:${url.protocol.replace(/:$/, "")}`
            : origin === window.location.origin
              ? "eigen"
              : origin;
      } catch {
        quelle = "unlesbar";
      }
    }
    reportClientError(e.error ?? e.message, "global", quelle);
  };
  const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason, "global");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
