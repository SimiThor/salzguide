import "server-only";
import { createServiceClient } from "./supabase/service";

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
  /** Tages-Salt der Reichweitenmessung. Danach ist der Besucher-Hash endgültig anonym. */
  analyticsSalt: 2,
  /** Reichweiten-Ereignisse (ohne Personenbezug, sobald der Salt weg ist). */
  analyticsEvents: 425, // ~14 Monate, damit ein Jahresvergleich möglich bleibt
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
        .from("analytics_salt")
        .delete()
        .lt("day", daysAgo(RETENTION_DAYS.analyticsSalt).toISOString().slice(0, 10)),
      service
        .from("analytics_events")
        .delete()
        .lt("created_at", daysAgo(RETENTION_DAYS.analyticsEvents).toISOString()),
    ]);
    return { aiUsage: usage.count ?? 0, ok: true };
  } catch (e) {
    console.error("[retention] Aufräumen fehlgeschlagen", e);
    return { aiUsage: 0, ok: false };
  }
}
