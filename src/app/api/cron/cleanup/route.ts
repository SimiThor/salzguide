import { pruneExpiredData } from "@/lib/data-retention";
import { pruneExpiredExports } from "@/lib/intro-export-server";
import { guardCron, finishCron } from "@/lib/cron-guard";
import { reportOverdueJobs } from "@/lib/ops";

// Täglicher Aufräumlauf (Vercel Cron, siehe vercel.json).
//
// Warum eine eigene Route und nicht weiter im Events-Cron: Die Datenschutzerklärung nennt
// Fristen von zwei bzw. neunzig Tagen. Ein wöchentlicher Lauf kann die nicht halten, egal
// wie sauber die Löschung selbst ist (siehe lib/data-retention.ts). Und weil die Recherche
// teuer ist und selten laufen soll, das Aufräumen aber billig ist und oft laufen muss,
// gehören die zwei Aufgaben nicht in denselben Job.
//
// Schutz wie beim Events-Cron: nur mit korrektem CRON_SECRET (Vercel sendet es als Bearer).
// Die Prüfung selbst steht in lib/cron-guard.ts, damit beide Cron-Routen dieselbe benutzen.
//
// DIESER LAUF IST AUSSERDEM DER WÄCHTER ÜBER ALLE ANDEREN. Er läuft als einziger täglich,
// also ist er die einzige Stelle, die früh genug merkt, dass ein anderer Job ausbleibt
// (reportOverdueJobs unten). Wer ihn abschaltet, schaltet die halbe Überwachung mit ab.
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const gate = await guardCron(req, "cleanup");
  if (!gate.ok) return gate.response;

  const result = await pruneExpiredData();

  // Danach die abgelaufenen Clean-Exporte (Videos, kein Personenbezug). Bewusst NACH den
  // Rechtsfristen und mit eigenem Ergebnis: Ein liegengebliebenes Video darf den Lauf nicht
  // als gescheitert dastehen lassen, an dem die Fristen der Datenschutzerklärung hängen.
  // Meldet sich selbst ins Logbuch, wenn etwas klemmt (lib/intro-export-server.ts).
  const exportFiles = await pruneExpiredExports();

  // Erst aufräumen, dann nach überfälligen Läufen sehen. Die Reihenfolge ist Absicht: Fällt
  // die Prüfung aus, war das Aufräumen (die Rechtsfrist) trotzdem schon erledigt.
  //
  // "cleanup" nimmt sich selbst aus der Prüfung: Der eigene Stempel fällt erst NACH ihr
  // (finishCron unten), und ein Job, der gerade läuft, ist nicht „ausgeblieben" — auch wenn
  // sein letzter Stempel älter als die Frist ist (Details am runningJob-Parameter in ops.ts).
  let overdue = 0;
  try {
    overdue = await reportOverdueJobs("cleanup");
  } catch (e) {
    console.error("[cron] Prüfung auf überfällige Läufe fehlgeschlagen", e);
  }

  await finishCron("cleanup", result.ok, {
    geloeschteKiZaehler: result.aiUsage,
    geloeschteExporte: exportFiles.deleted,
    ueberfaellig: overdue,
    // Nur im Fehlerfall: Der Heartbeat soll dann gleich sagen, WO es geklemmt hat, ohne
    // dass jemand erst im Logbuch nach der passenden retention_failed-Zeile suchen muss.
    ...(result.failedTables.length > 0 ? { fehlgeschlageneTabellen: result.failedTables } : {}),
  });
  return Response.json({
    ok: result.ok,
    purgedAiUsage: result.aiUsage,
    purgedExports: exportFiles.deleted,
    overdue,
    failedTables: result.failedTables,
  });
}
