import { runAutoWeeklyResearch } from "@/lib/event-research";
import { createServiceClient } from "@/lib/supabase/service";
import { prunePreviews } from "@/lib/blur-preview";
import { sweepOrphanMedia, type OrphanSweepResult } from "@/lib/storage-orphans";
import { pruneExpiredData } from "@/lib/data-retention";
import { guardCron, finishCron } from "@/lib/cron-guard";
import { logOps } from "@/lib/ops";

// Das Aufräumen alter Daten steckte hier und läuft jetzt TÄGLICH in einer eigenen Route
// (api/cron/cleanup). Grund: Die in der Datenschutzerklärung genannten Fristen (2 bzw. 90
// Tage) lassen sich mit einem wöchentlichen Lauf nicht einhalten. Der Aufruf bleibt hier
// zusätzlich stehen, weil er billig und idempotent ist: Fällt ein Tageslauf aus, räumt
// spätestens der Montag auf.

// Wöchentlicher KI-Recherche-Lauf (Vercel Cron). Recherchiert die aktuelle,
// nächste & übernächste Kalenderwoche – aber nur die noch NICHT protokollierten
// (event_research_log) -> jede Woche wird genau einmal gesucht, rollt weiter.
// Anton prüft & veröffentlicht die Draft-Events im Admin.
// Schutz: nur mit korrektem CRON_SECRET (Vercel Cron sendet es als Bearer-Header).
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Web-Recherche kann dauern (Vercel Pro: bis 300s)

export async function GET(req: Request): Promise<Response> {
  const gate = await guardCron(req, "events");
  if (!gate.ok) return gate.response;

  const result = await runAutoWeeklyResearch();
  const purgedAiUsage = (await pruneExpiredData()).aiUsage;

  // Nicht mehr gebrauchte Bild-Vorschauen wegräumen. Gehört hierher, weil dieser Lauf
  // längst die wöchentliche WARTUNG ist und nicht nur Recherche (cleanupOldData oben hat
  // mit Events auch nichts zu tun) — und weil ein Aufräumen, das jemand von Hand starten
  // muss, irgendwann nicht mehr passiert.
  //
  // Best effort wie der Rest: Scheitert es, ist das kein Grund, den Cron rot zu färben.
  // Es liegen dann ein paar Kilobyte länger herum, mehr nicht.
  let prunedPreviews = { unlinked: 0, deleted: 0, orphans: 0 };
  try {
    const service = createServiceClient();
    prunedPreviews = await prunePreviews(service, service.storage);
  } catch (e) {
    console.error("[cron] prunePreviews:", e instanceof Error ? e.message : e);
    // Gemeldet, aber NICHT als gescheiterter Lauf gewertet (siehe unten): ein paar Kilobyte,
    // die länger liegen bleiben, sind kein Grund für einen Alarm um drei Uhr nachts.
    await logOps("cron_failed", {
      message: "Aufräumen der Bild-Vorschauen fehlgeschlagen.",
      error: e,
      group: "job:events:previews",
      path: "/api/cron/events",
    });
  }

  // Waisen-Sweep über beide Buckets (storage-orphans.ts): Uploads passieren im Browser
  // VOR dem Speichern, also hinterlässt jedes verworfene Formular und jeder Datei-Tausch
  // prinzipbedingt unreferenzierte Dateien. Der Sweep ist fail-closed (bei jedem
  // Lesefehler wird nichts gelöscht) und lässt Dateien jünger als 48 h in Ruhe.
  let orphanSweep: OrphanSweepResult | null = null;
  try {
    orphanSweep = await sweepOrphanMedia(createServiceClient());
  } catch (e) {
    console.error("[cron] orphanSweep:", e instanceof Error ? e.message : e);
    await logOps("cron_failed", {
      message: "Waisen-Sweep über die Medien-Buckets fehlgeschlagen.",
      error: e,
      group: "job:events:orphans",
      path: "/api/cron/events",
    });
  }

  // `result.ok` und NICHT „alles hat geklappt": Das Lebenszeichen soll die Kernaufgabe des
  // Laufs bewerten (die Recherche), nicht die Nebenarbeiten. Sonst stünde der Job wochenlang
  // auf Rot, weil ein Aufräumschritt hakt, den niemand vermisst — und man würde die Farbe
  // ignorieren lernen, genau dann, wenn sie einmal zählt.
  await finishCron("events", result.ok, {
    wochen: result.weeks.length,
    neueEvents: result.weeks.reduce((n, w) => n + w.inserted, 0),
    ...(result.error ? { grund: result.error } : {}),
    geloeschteKiZaehler: purgedAiUsage,
    vorschauen: prunedPreviews.deleted,
    waisen: orphanSweep?.deleted ?? 0,
  });

  return Response.json(
    { ...result, purgedAiUsage, prunedPreviews, orphanSweep },
    { status: result.ok ? 200 : 500 },
  );
}
