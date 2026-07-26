import { runAutoWeeklyResearch } from "@/lib/event-research";
import { createServiceClient } from "@/lib/supabase/service";
import { prunePreviews } from "@/lib/blur-preview";
import { sweepOrphanMedia, type OrphanSweepResult } from "@/lib/storage-orphans";
import { pruneExpiredData } from "@/lib/data-retention";

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
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

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
  }

  return Response.json(
    { ...result, purgedAiUsage, prunedPreviews, orphanSweep },
    { status: result.ok ? 200 : 500 },
  );
}
