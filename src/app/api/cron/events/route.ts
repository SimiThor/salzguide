import { runAutoWeeklyResearch } from "@/lib/event-research";
import { createServiceClient } from "@/lib/supabase/service";
import { prunePreviews } from "@/lib/blur-preview";

// DSGVO-Datensparsamkeit (docs/34 §D/§H): KI-Zähler > 90 Tage + Burst > 1 Tag löschen;
// Analytics-Salt > 2 Tage (danach sind die Visitor-Hashes endgültig anonym) + Analytics-
// Events > 14 Monate. Best effort – blockiert den Cron nie.
async function cleanupOldData(): Promise<number> {
  const usageCutoff = new Date();
  usageCutoff.setUTCDate(usageCutoff.getUTCDate() - 90);
  const burstCutoff = new Date();
  burstCutoff.setUTCDate(burstCutoff.getUTCDate() - 1);
  const saltCutoff = new Date();
  saltCutoff.setUTCDate(saltCutoff.getUTCDate() - 2);
  const eventCutoff = new Date();
  eventCutoff.setUTCDate(eventCutoff.getUTCDate() - 425); // ~14 Monate
  try {
    const service = createServiceClient();
    const [usage] = await Promise.all([
      service
        .from("ai_usage")
        .delete({ count: "exact" })
        .lt("day", usageCutoff.toISOString().slice(0, 10)),
      service.from("ai_burst").delete().lt("window_start", burstCutoff.toISOString()),
      service.from("analytics_salt").delete().lt("day", saltCutoff.toISOString().slice(0, 10)),
      service
        .from("analytics_events")
        .delete()
        .lt("created_at", eventCutoff.toISOString()),
    ]);
    return usage.count ?? 0;
  } catch {
    return 0;
  }
}

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
  const purgedAiUsage = await cleanupOldData();

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

  return Response.json(
    { ...result, purgedAiUsage, prunedPreviews },
    { status: result.ok ? 200 : 500 },
  );
}
