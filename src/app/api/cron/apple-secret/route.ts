import { guardCron, finishCron } from "@/lib/cron-guard";
import { logOps, writeHeartbeat } from "@/lib/ops";
import { rotateAppleWebSecret } from "@/lib/apple-web-secret";

// Monatlich: Client-Secret für "Mit Apple anmelden" im Web erneuern (Apple erlaubt höchstens
// 6 Monate; wir stellen 180 Tage aus). Aufbau, ENV und Einrichtung: docs/41 Abschnitt 5 + 12,
// Logik in lib/apple-web-secret.ts. Schutz wie bei allen Crons: CRON_SECRET (guardCron).
export const dynamic = "force-dynamic";

const JOB = "apple-secret";

export async function GET(req: Request): Promise<Response> {
  const gate = await guardCron(req, JOB);
  if (!gate.ok) return gate.response;

  const result = await rotateAppleWebSecret();

  if (result.status === "not_configured") {
    // Ohne Services-ID ist das Web nicht gewollt (Apple in Supabase kann nur die App tragen):
    // Nichtstun ist richtig und still. Mit Services-ID fehlt etwas, und das wird gemeldet.
    // Der Lauf braucht Apple in Supabase NICHT eingeschaltet: Das erste Secret wird VOR dem
    // Einschalten geschrieben.
    if (!process.env.APPLE_SIWA_SERVICES_ID?.trim()) {
      await writeHeartbeat(JOB, true, { uebersprungen: "web-login aus" });
      return Response.json({ ok: true, skipped: true });
    }
    await logOps("config_missing", {
      message:
        "Mit Apple anmelden (Web) ist gewollt (Services-ID gesetzt), aber das Client-Secret kann nicht erneuert werden: Einstellung fehlt.",
      group: "env:apple-secret",
      path: `/api/cron/${JOB}`,
      detail: { fehlt: result.missing },
    });
    await writeHeartbeat(JOB, false, { fehlt: result.missing });
    return Response.json({ ok: false, missing: result.missing }, { status: 500 });
  }

  if (result.status === "failed") {
    await finishCron(JOB, false, { grund: result.reason });
    return Response.json({ ok: false }, { status: 500 });
  }

  await finishCron(JOB, true, { laeuftAb: result.expiresAt });
  return Response.json({ ok: true, expiresAt: result.expiresAt });
}
