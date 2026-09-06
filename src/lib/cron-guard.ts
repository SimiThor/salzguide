import "server-only";
import { secretMatches, bearerToken } from "./secret-compare";
import { logOps, subjectFromRequest, writeHeartbeat } from "./ops";

// Der Wächter für die Cron-Endpunkte. EINE Stelle, wie beim Admin-Wächter (lib/admin-guard.ts).
//
// Bisher stand die Prüfung zweimal wortgleich in den beiden Routen:
//
//     const secret = process.env.CRON_SECRET;
//     const auth = req.headers.get("authorization");
//     if (!secret || auth !== `Bearer ${secret}`) return new Response("Unauthorized", …);
//
// Zwei Kopien einer Sicherheitsprüfung sind zwei Gelegenheiten, sie unterschiedlich zu
// machen, und beim dritten Cron vergisst jemand eine Zeile. Dazu kommt jetzt Arbeit, die in
// beiden Routen anfällt und die niemand zweimal schreiben will: den Lebenszeichen-Stempel
// setzen und den Fremdzugriff melden.
//
// FAIL-CLOSED, unverändert: Fehlt CRON_SECRET, kommt NIEMAND durch. Das ist die richtige
// Richtung — ein Cron, der nicht läuft, verzögert etwas; ein offener Cron-Endpunkt lässt
// jeden im Netz unsere Recherche starten (die kostet bei Anthropic Geld).

export type CronGate = { ok: true } | { ok: false; response: Response };

/**
 * Darf dieser Aufruf den Job starten? IMMER als erste Zeile einer Cron-Route.
 *
 * `job` muss zu einem Eintrag in OPS_JOBS passen (lib/ops-events.ts), sonst überwacht der
 * Totmannschalter ihn nicht.
 */
export async function guardCron(req: Request, job: string): Promise<CronGate> {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    // Kein Geheimnis gesetzt: Der Job läuft nie. Das ist ein Konfigurationsfehler, der sich
    // sonst als monatelange Stille tarnt — genau die Sorte, gegen die dieses ganze Modul
    // gebaut ist.
    await logOps("config_missing", {
      message: "CRON_SECRET ist nicht gesetzt. Kein Hintergrund-Lauf kann starten.",
      group: "env:CRON_SECRET",
      path: `/api/cron/${job}`,
    });
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }

  const header = req.headers.get("authorization");
  const token = bearerToken(req);
  if (!secretMatches(token, secret)) {
    await logOps("cron_unauthorized", {
      message: `Zugriff auf den Lauf „${job}" ohne gültiges Secret.`,
      path: `/api/cron/${job}`,
      subject: subjectFromRequest(req),
      // Ob überhaupt ein Kopf mitkam, unterscheidet den neugierigen Scanner (nichts) vom
      // gezielten Versuch (falsches Secret) und vom eigenen Fehler (rotiertes Secret).
      detail: { mitAuthKopf: !!header, job },
    });
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }

  return { ok: true };
}

/**
 * „Ich bin durch." IMMER am Ende einer Cron-Route aufrufen, auch bei Misserfolg.
 *
 * Der Stempel ist die halbe Überwachung: Ein Fehler meldet sich selbst, ein AUSBLEIBEN nicht.
 * Ohne diesen Aufruf kann der Totmannschalter (reportOverdueJobs) nichts bemerken — und
 * schlimmer, er würde den Job dann fälschlich als überfällig melden.
 */
export async function finishCron(
  job: string,
  ok: boolean,
  detail?: Record<string, unknown>,
): Promise<void> {
  await writeHeartbeat(job, ok, detail);
  if (!ok) {
    await logOps("cron_failed", {
      message: `Der Lauf „${job}" ist nicht sauber durchgelaufen.`,
      // Je Job ein eigener Fingerabdruck: Sonst schaltet ein dauerhaft hakender Job den
      // anderen für die Dauer des Ruhefensters stumm.
      group: `job:${job}`,
      path: `/api/cron/${job}`,
      detail: { job, ...(detail ?? {}) },
    });
  }
}
