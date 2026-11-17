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

/**
 * Wer die Alarm-Mails (lib/ops-mail.ts) bekommt: die Adresse oben plus OPS_ALERT_CC.
 *
 * OPS_ALERT_CC ist eine Komma-Liste weiterer Adressen (Simon, 17.11.2026). Sie gilt NUR für
 * Alarme, nicht für Clean-Exporte und die Recherche-Erinnerung: Bei einem Alarm sollen beide
 * Bescheid wissen, die anderen Mails sind Aufgaben für eine Person.
 *
 * Die Adressen stehen in der ENV und nicht im Code, weil das Repo öffentlich ist. Was kein
 * „@" hat, fällt still weg; doppelte Adressen kommen nur einmal vor.
 */
export function opsAlertRecipients(): string[] {
  const extra = (process.env.OPS_ALERT_CC ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.includes("@"));
  const all = [adminRecipient(), ...extra];
  const seen = new Set<string>();
  return all.filter((a) => {
    const key = a.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
