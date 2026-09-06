import "server-only";
import { LEGAL } from "./legal";

// Wohin die Post geht, die an UNS selbst gerichtet ist: Betriebs-Alarme, fertige
// Clean-Exporte, die Freigabe-Erinnerung der Wochenrecherche.
//
// WARUM DAS EIN EIGENES MODUL IST: Dieselben zwei Zeilen standen bereits zweimal wortgleich
// im Code (lib/ops-mail.ts und lib/intro-export-server.ts), beide mit demselben Kommentar
// darüber. Bei der dritten Mail wäre es die dritte Kopie geworden, und die erste, die man
// beim Umziehen der Adresse vergisst. Es ist dieselbe Person, die alle drei liest, also gibt
// es auch nur eine Antwort auf die Frage.

/**
 * Die Adresse, an die interne Mails gehen.
 *
 * OPS_ALERT_EMAIL erlaubt eine eigene Adresse (zum Beispiel eine, die aufs Handy
 * durchklingelt), ohne dafür die Impressums-Adresse zu ändern. Fehlt sie, geht es an die
 * Adresse aus dem Impressum: Die wird gelesen, das ist ihr Zweck.
 */
export function adminRecipient(): string {
  return process.env.OPS_ALERT_EMAIL?.trim() || LEGAL.email;
}
