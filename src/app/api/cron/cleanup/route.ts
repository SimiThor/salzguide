import { pruneExpiredData } from "@/lib/data-retention";

// Täglicher Aufräumlauf (Vercel Cron, siehe vercel.json).
//
// Warum eine eigene Route und nicht weiter im Events-Cron: Die Datenschutzerklärung nennt
// Fristen von zwei bzw. neunzig Tagen. Ein wöchentlicher Lauf kann die nicht halten, egal
// wie sauber die Löschung selbst ist (siehe lib/data-retention.ts). Und weil die Recherche
// teuer ist und selten laufen soll, das Aufräumen aber billig ist und oft laufen muss,
// gehören die zwei Aufgaben nicht in denselben Job.
//
// Schutz wie beim Events-Cron: nur mit korrektem CRON_SECRET (Vercel sendet es als Bearer).
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await pruneExpiredData();
  return Response.json({ ok: result.ok, purgedAiUsage: result.aiUsage });
}
