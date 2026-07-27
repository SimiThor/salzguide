import "server-only";
import { createServiceClient } from "./supabase/service";
import { logOps } from "./ops";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Das Aufräumen alter Daten. EINE Quelle, TÄGLICH gefahren.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM DAS EIN EIGENES MODUL MIT EIGENEM CRON IST:
// Diese Löschungen hingen im wöchentlichen Events-Cron (montags 05:00). Die
// Datenschutzerklärung verspricht aber „Reichweitenmessung: nach spätestens 2 Tagen anonym"
// und „Roh-Nutzungsdaten der KI max. 90 Tage". Beides konnte so nicht stimmen: Ein Salt vom
// Dienstag lag bis zum folgenden Montag herum, also bis zu acht Tage statt zwei, und die
// KI-Zähler bis zu 97 statt 90. Eine Frist, die in der Erklärung steht und im Betrieb nicht
// eingehalten wird, ist keine Ungenauigkeit, sondern eine falsche Angabe nach Art. 13 DSGVO.
//
// Jetzt läuft es täglich und getrennt von der Recherche: Die eine Aufgabe ist Datenschutz,
// die andere sind Veranstaltungen. Zusammen in einem Job standen sie nur, weil beide einen
// Cron brauchten.
//
// Best effort, wirft nie: Ein fehlgeschlagenes Aufräumen darf keinen Cron abbrechen. Was
// heute liegenbleibt, holt der Lauf von morgen.

/** Wie lange was bleiben darf. Die Zahlen stehen so auch in der Datenschutzerklärung. */
export const RETENTION_DAYS = {
  /** KI-Zähler pro Tag und Subjekt (Gratis-Limit). */
  aiUsage: 90,
  /** Kurzzeit-Zähler gegen Hämmern. Nach einem Tag ohne Bedeutung. */
  burst: 1,
  /**
   * Die allgemeinen Missbrauchs-Bremsen aus Migration 0055 (`rate_limits`).
   *
   * DIESE ZEILE HAT BIS 07/2026 GEFEHLT, und sie hat am meisten gefehlt. Die Tabelle hält
   * EINE Zeile je Subjekt und aktualisiert sie an Ort und Stelle — sie läuft also nicht
   * voll, und genau deshalb ist niemandem aufgefallen, dass sie nie geleert wurde.
   *
   * Das Problem ist nicht die Grösse, sondern was drinsteht: /api/track legt für JEDEN
   * Besucher ein Subjekt `track-ip:sha256(ip + Server-Secret)` an. Dieser Hash rotiert
   * NICHT (anders als der Besucher-Hash der Reichweitenmessung, der jede Nacht wechselt) —
   * er ist ein dauerhaftes Pseudonym der IP-Adresse, und daneben stand mit `window_start`
   * der Zeitpunkt des letzten Aufrufs. Aus einer Bremse war so, ungewollt, eine Liste
   * „welche Anschlussadresse war wann zuletzt da" geworden, unbefristet.
   *
   * Damit stand die Tabelle quer zur Datenschutzerklärung („IP-Adressen werden nie
   * gespeichert") und zu Art. 5 Abs. 1 lit. e DSGVO. Sie wächst obendrein mit jedem je
   * gesehenen Besucher, und das an der meistaufgerufenen Route der App.
   *
   * EIN TAG, und die Zahl ist nachgerechnet, nicht gegriffen: Das längste Fenster, das
   * irgendwo genutzt wird, ist eine Stunde (lib/ops-mail.ts); Anmeldelink und Tracking
   * nehmen 15 Minuten. Eine Zeile, die einen Tag lang nicht angefasst wurde, kann kein
   * laufendes Fenster mehr sein — ihr Löschen setzt nichts zurück, was noch zählt.
   */
  rateLimits: 1,
  /** Tages-Salt der Reichweitenmessung. Danach ist der Besucher-Hash endgültig anonym. */
  analyticsSalt: 2,
  /** Reichweiten-Ereignisse (ohne Personenbezug, sobald der Salt weg ist). */
  analyticsEvents: 425, // ~14 Monate, damit ein Jahresvergleich möglich bleibt
  /**
   * Betriebs-Logbuch (Fehler, Missbrauchsversuche, Admin-Spur).
   *
   * 90 Tage, und die Zahl ist nicht geraten: Sie ist die übliche Mindest-Vorhaltung für
   * Sicherheitsprotokolle (OWASP A09) und deckt genau den Fall ab, für den man sie braucht —
   * einen Zwischenfall, der erst Wochen später auffällt, im Nachhinein nachzuvollziehen.
   *
   * Länger geht nicht ohne Not: In der Tabelle stehen zwar nur pseudonyme Kennungen und
   * geschwärzte Texte, aber Datensparsamkeit gilt auch für Betriebsdaten. Kürzer geht auch
   * nicht: Bei dreissig Tagen wäre die Spur beim ersten Quartalsblick schon weg.
   */
  opsEvents: 90,
  /**
   * Der Zustand der Alarm-Bremse. Reine Zähler, kein Inhalt.
   *
   * 30 Tage nach dem letzten Vorfall: Ein Fingerabdruck, der einen Monat lang ruhig war,
   * soll beim nächsten Auftreten wie neu behandelt werden — inklusive sofortiger Mail.
   * Ohne dieses Aufräumen wüchse die Tabelle mit jeder je aufgetretenen Fehlerform.
   */
  opsAlerts: 30,
} as const;

export type RetentionResult = { aiUsage: number; ok: boolean };

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/** Alles löschen, was seine Frist überschritten hat. */
export async function pruneExpiredData(): Promise<RetentionResult> {
  try {
    const service = createServiceClient();
    const [usage] = await Promise.all([
      service
        .from("ai_usage")
        .delete({ count: "exact" })
        .lt("day", daysAgo(RETENTION_DAYS.aiUsage).toISOString().slice(0, 10)),
      service.from("ai_burst").delete().lt("window_start", daysAgo(RETENTION_DAYS.burst).toISOString()),
      service
        .from("rate_limits")
        .delete()
        .lt("window_start", daysAgo(RETENTION_DAYS.rateLimits).toISOString()),
      service
        .from("analytics_salt")
        .delete()
        .lt("day", daysAgo(RETENTION_DAYS.analyticsSalt).toISOString().slice(0, 10)),
      service
        .from("analytics_events")
        .delete()
        .lt("created_at", daysAgo(RETENTION_DAYS.analyticsEvents).toISOString()),
      // Das Betriebs-Logbuch räumt sich selbst mit auf. Es steht bewusst in DERSELBEN Liste
      // wie alles andere: Ein Aufräum-Job, den man für die neue Tabelle vergisst, ist genau
      // der Fehler, den diese Tabelle eigentlich melden soll.
      service
        .from("ops_events")
        .delete()
        .lt("created_at", daysAgo(RETENTION_DAYS.opsEvents).toISOString()),
      service
        .from("ops_alerts")
        .delete()
        .lt("window_start", daysAgo(RETENTION_DAYS.opsAlerts).toISOString()),
    ]);
    return { aiUsage: usage.count ?? 0, ok: true };
  } catch (e) {
    console.error("[retention] Aufräumen fehlgeschlagen", e);
    // Als „kritisch" eingestuft, und zwar aus RECHTLICHEN Gründen, nicht aus technischen:
    // Ein ausgefallener Lauf ist technisch harmlos (der von morgen holt es nach). Er wird
    // erst dann teuer, wenn er sich wiederholt — dann stehen die Fristen in der
    // Datenschutzerklärung nur noch auf dem Papier, und das ist eine falsche Angabe nach
    // Art. 13 DSGVO. Genau deshalb ist das Ruhefenster im Katalog auf zwölf Stunden gesetzt:
    // Ein einzelner Aussetzer meldet sich einmal, ein anhaltender jeden Tag wieder.
    await logOps("retention_failed", {
      message: "Das tägliche Löschen abgelaufener Daten ist fehlgeschlagen.",
      error: e,
      group: "retention",
    });
    return { aiUsage: 0, ok: false };
  }
}
