import "server-only";
import { createHash } from "node:crypto";
import { createServiceClient } from "./supabase/service";
import { clientIp } from "./analytics";
import { OPS_EVENTS, OPS_JOBS, type OpsKind, type OpsSeverity } from "./ops-events";
import { errorMessage, scrubDetail, scrubPath, scrubStack, scrubText } from "./ops-scrub";
import { sendOpsAlert } from "./ops-mail";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  logOps() — die EINE Stelle, an der ein Vorfall gemeldet wird.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WAS VORHER DA WAR: hundertmal `console.error("[irgendwas] kaputt", e)`. Das ist besser als
// nichts, aber es hat drei Löcher, und jedes davon kann teuer werden:
//
//   1. NIEMAND WIRD BENACHRICHTIGT. Ein Kauf, der nicht freigeschaltet wird, steht als graue
//      Zeile in einem Log, das niemand offen hat. Der Kunde meldet sich — oder eben nicht.
//   2. ES IST NACH STUNDEN WEG. Vercels Laufzeit-Log hält nur kurz. Die Frage „seit wann geht
//      das schon?" lässt sich damit nicht beantworten.
//   3. ES GIBT KEIN MUSTER. Fünfzig fehlgeschlagene Anmeldungen sehen aus wie fünfzig
//      einzelne Zeilen, nicht wie ein Angriff.
//
// Diese Datei schliesst alle drei: schreiben (bleibt), zählen (Muster), melden (Mail).
//
// ───────────────────────────────────────────────────────────────────────────────────────
//  DIE WICHTIGSTE EIGENSCHAFT: logOps() DARF NIEMALS ETWAS KAPUTTMACHEN
// ───────────────────────────────────────────────────────────────────────────────────────
//
// Diese Funktion wird in Fehlerpfaden aufgerufen — also genau dann, wenn ohnehin schon etwas
// nicht stimmt. Wirft SIE dann auch noch, hat man aus einem behandelten Fehler einen
// unbehandelten gemacht und die Meldung obendrein verloren. Deshalb:
//
//   • Sie wirft nie. Alles steckt in try/catch, und der äussere catch tut nichts als eine
//     Konsolenzeile.
//   • Sie gibt nichts zurück, worauf sich jemand verlassen könnte. Kein `ok`-Flag, das man
//     prüfen müsste — der Aufrufer soll seinen eigenen Fehlerpfad zu Ende gehen.
//   • Die Konsolenzeile kommt IMMER, auch wenn die Datenbank hängt. Zwei Kopien an zwei
//     Orten: Wenn Supabase der Grund für den Alarm ist, hilft ein Alarm IN Supabase nicht.
//
// ───────────────────────────────────────────────────────────────────────────────────────
//  WARTEN ODER NICHT (`await logOps` vs. `after(() => logOps(…))`)
// ───────────────────────────────────────────────────────────────────────────────────────
//
// Ein Schreibvorgang in die Datenbank kostet Zeit. Auf heissen Pfaden (jede Anfrage, jeder
// Seitenaufruf) gehört er deshalb hinter `after()` aus next/server: Die Antwort geht sofort
// raus, die Meldung passiert danach — dasselbe Muster wie in api/track/route.ts.
//
// Was NICHT geht: die Promise einfach fallen lassen (`void logOps(…)`). In einer serverlosen
// Umgebung wird der Prozess eingefroren, sobald die Antwort steht; eine schwebende Promise
// läuft dann nie zu Ende, und die Meldung ist weg. Entweder `await` oder `after()`.

/** Was eine Meldestelle mitgeben kann. Alles ausser der Art ist freiwillig. */
export type OpsInput = {
  /** Ein Satz auf Deutsch. Fehlt er, wird er aus `error` gebaut. */
  message?: string;
  /** Der gefangene Fehler. Liefert Meldung und (gekürzten) Stacktrace. */
  error?: unknown;
  /** Wo es passiert ist. Query-String wird abgeschnitten (dort stehen Anmelde-Tokens). */
  path?: string | null;
  /** WER, pseudonym. Über opsSubject()/subjectFromRequest() bilden, nie roh. */
  subject?: string | null;
  /** Zahlen und kurze Angaben. Wird geschwärzt und auf 20 Schlüssel begrenzt. */
  detail?: Record<string, unknown> | null;
  /**
   * Eigene Gruppierung, wenn die automatische zu grob oder zu fein ist.
   *
   * Beispiel: Beim Cron wird je Job gruppiert (`group: "job:cleanup"`), sonst landen beide
   * Cron-Jobs unter einem Fingerabdruck und der zweite Ausfall bliebe stumm.
   */
  group?: string;
  /**
   * Auch lokal wirklich schreiben und mailen.
   *
   * Nur für den Test-Knopf im Admin. Siehe `active()`: In der Entwicklung geht sonst nichts
   * in die (gemeinsame, echte) Datenbank.
   */
  force?: boolean;
};

/**
 * Wie viele Zeilen ein und derselbe Vorfall pro Ruhefenster ins Logbuch schreiben darf.
 *
 * WARUM ES DIESE GRENZE BRAUCHT: Ein Bot, der zehntausendmal am Login klopft, erzeugt
 * zehntausend gleiche Zeilen. Das Logbuch soll aber genau in dem Moment lesbar bleiben, in
 * dem etwas los ist — und eine Tabelle, die bei einem Angriff vollläuft, ist selbst ein
 * Ausfall (denselben Gedanken hat schon api/track/route.ts, dort mit einer IP-Obergrenze).
 *
 * Zwanzig reichen, um ein Muster zu sehen. Die ECHTE Anzahl geht dabei nicht verloren: Sie
 * steht in ops_alerts (`seen`, `total`) und in jeder geschriebenen Zeile unter `imFenster`.
 */
const ROWS_PER_WINDOW = 20;

/**
 * Die Schwelle für „niemals mailen".
 *
 * `claim_ops_alert` löst aus, wenn der Zählerstand die Schwelle GENAU trifft. Für Arten mit
 * `alertAfter: 0` (reine Nachvollziehbarkeit, etwa Admin-Aktionen) wird deshalb die grösste
 * mögliche Integer-Zahl übergeben — die trifft der Zähler nie. Sauberer als ein zweiter
 * Sonderfall in der SQL-Funktion.
 */
const NEVER_ALERT = 2_147_483_647;

/**
 * Ein pseudonymer Absender-Schlüssel — dasselbe Muster wie in login-link.ts und api/track.
 *
 * In `ops_events.subject` darf nie eine Klartext-Adresse oder -IP stehen. Was wir brauchen,
 * ist nur die Frage „ist das schon wieder derselbe?", und die beantwortet ein Hash genauso.
 */
export function opsSubject(kind: string, value: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
  const hash = createHash("sha256").update(`ops:${kind}:${value}:${salt}`).digest("hex");
  return `${kind}:${hash.slice(0, 24)}`;
}

/** Der Absender einer Anfrage, pseudonym. Null, wenn keine IP feststellbar ist (lokal). */
export function subjectFromRequest(req: Request): string | null {
  const ip = clientIp(req);
  return ip ? opsSubject("ip", ip) : null;
}

/**
 * Der Fingerabdruck: was gilt als „derselbe Vorfall"?
 *
 * Zahlen und UUIDs fliegen aus der Meldung, bevor gehasht wird. Ohne das wären
 * „Spot 41 nicht gefunden" und „Spot 82 nicht gefunden" zwei verschiedene Vorfälle, jeder
 * mit eigener Mail — und genau so entsteht das Postfach, das man wegfiltert.
 */
function fingerprint(kind: string, group: string | undefined, path: string | null, message: string) {
  const basis =
    group ??
    `${path ?? ""}|${message
      .toLowerCase()
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#")
      .replace(/\d+/g, "#")}`;
  return `${kind}:${createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
}

/**
 * Welcher Stand läuft gerade? Vercel setzt den Commit-Hash selbst.
 *
 * Beantwortet die erste Frage bei jedem neuen Fehler: „kam das mit dem letzten Deploy?"
 * Ohne diese Angabe sucht man den Auslöser in der gesamten Geschichte statt in einem Commit.
 */
function release(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (sha) return sha.slice(0, 7);
  return process.env.NODE_ENV === "production" ? null : "dev";
}

/**
 * Läuft dieser Prozess auf der ECHTEN Seite?
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  DIE FALLE: `NODE_ENV` IST AUF VERCEL AUCH IM PREVIEW „production"
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Vercel baut jeden Branch-Preview als Produktions-Build, also steht dort `NODE_ENV` auf
 * "production" — genau wie auf salzguide.com. Wer nur danach fragt, hält jeden Preview für
 * die echte Seite. Folge wäre: Ein Fehler in einem halbfertigen Branch schreibt in DIESELBE
 * ops_events-Tabelle, zählt in der 24-Stunden-Übersicht als echter Vorfall mit, und ein
 * `critical` daraus schickt eine Mail. Man würde nachts wegen eines Branches geweckt, an dem
 * gerade jemand arbeitet — und danach dem nächsten Alarm nicht mehr glauben.
 *
 * `VERCEL_ENV` unterscheidet sauber: "production" | "preview" | "development".
 *
 * DER RÜCKFALL IST ABSICHT: Ist `VERCEL_ENV` nicht da (System-Variablen im Projekt nicht
 * freigegeben, oder ein ganz anderer Hoster), zählt wieder `NODE_ENV`. Lieber ein Preview zu
 * viel gemeldet als die echte Seite stumm — ein Meldewesen, das sich bei einer fehlenden
 * Variable selbst abschaltet, wäre der schlimmere Fehler.
 */
function isRealSite(): boolean {
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv) return vercelEnv === "production";
  return process.env.NODE_ENV === "production";
}

/**
 * Schreibt diese Umgebung überhaupt ins Logbuch?
 *
 * NEIN in der Entwicklung UND nein im Branch-Preview, und zwar aus einem konkreten Grund:
 * Es gibt EIN Supabase-Projekt. Ein lokaler Fehlversuch würde als „Kritisch" in derselben
 * Tabelle landen wie die echten, und morgens stünde ein Alarm im Postfach, den man selbst
 * gestern Abend beim Ausprobieren erzeugt hat. Das ist derselbe Gedanke, aus dem die
 * Reichweitenmessung nur in Produktion läuft (docs/34 §H).
 *
 * Warum der Preview mitgemeint ist, obwohl er sich als „production" ausgibt: siehe
 * `isRealSite()`. Wer an einem Branch arbeitet, schaut ohnehin auf das Vercel-Log genau
 * dieses Deployments — dafür braucht es keinen Eintrag in der echten Chronik.
 *
 * Zum Testen: `OPS_LOCAL=1` in .env.local, oder der Test-Knopf im Admin (`force`).
 */
function active(force?: boolean): boolean {
  return force === true || isRealSite() || process.env.OPS_LOCAL === "1";
}

/** Was `claim_ops_alert` zurückgibt. */
type Claim = { alert: boolean; suppressed: number; total: number; seen: number };

/**
 * Einen Vorfall melden. Wirft nie.
 *
 * Auf heissen Pfaden in `after()` verpacken, sonst wartet der Besucher auf unseren
 * Schreibvorgang (siehe Kopf dieser Datei).
 */
export async function logOps(kind: OpsKind, input: OpsInput = {}): Promise<void> {
  try {
    const policy = OPS_EVENTS[kind];
    const message =
      scrubText(input.message ?? (input.error !== undefined ? errorMessage(input.error) : "")) ||
      policy.title;
    const path = scrubPath(input.path);
    const stack = scrubStack(input.error);
    const detail = scrubDetail(
      stack ? { ...(input.detail ?? {}), stack } : (input.detail ?? undefined),
    );
    const fp = fingerprint(kind, input.group, path, message);

    // ── 1. Die Konsole. Immer, und als Erstes. ────────────────────────────────────
    // Auch wenn alles Weitere scheitert, steht der Vorfall dann wenigstens in Vercels Log.
    // Eine Zeile mit fester Form, damit ein späterer Log-Drain sie greifen kann, ohne dass
    // wir heute schon einen brauchen.
    const line = `[ops] ${policy.severity} ${policy.area}/${kind} ${message}${path ? ` (${path})` : ""}`;
    if (policy.severity === "critical" || policy.severity === "error") console.error(line);
    else if (policy.severity === "warn") console.warn(line);
    else console.log(line);

    if (!active(input.force)) return;
    const service = createServiceClient();

    // ── 2. Zählen. EIN Aufruf, der drei Fragen auf einmal beantwortet. ────────────
    // Wie oft war das im Fenster schon (Flutschutz), ist die Schwelle jetzt erreicht
    // (Alarm), und wie oft insgesamt (Einordnung in der Mail). Alles atomar in einem
    // Statement, weil zwei gleichzeitige Fehler sonst zwei Mails auslösen — dieselbe
    // TOCTOU-Falle, die beim KI-Limit schon einmal zugeschnappt ist (docs/34 §G).
    //
    // Hakt der Zähler, wird trotzdem geschrieben und NICHT gemailt: Eine verlorene Mail ist
    // ärgerlich, eine Mailflut wegen eines Zählerfehlers wäre schlimmer.
    let claim: Claim = { alert: false, suppressed: 0, total: 0, seen: 1 };
    try {
      const { data } = await service.rpc("claim_ops_alert", {
        p_fingerprint: fp,
        p_window_seconds: Math.max(0, policy.quietMinutes) * 60,
        p_threshold: policy.alertAfter > 0 ? policy.alertAfter : NEVER_ALERT,
      });
      if (data && typeof data === "object") claim = { ...claim, ...(data as Partial<Claim>) };
    } catch (e) {
      console.error("[ops] Zähler nicht erreichbar", e instanceof Error ? e.message : e);
    }

    // ── 3. Ins Logbuch — solange es nicht zur Flut wird. ─────────────────────────
    // Die Zeile, die den Alarm auslöst, wird IMMER geschrieben, auch über der Grenze:
    // Sonst käme eine Mail, zu der es im Logbuch nichts zu sehen gibt.
    if (claim.seen <= ROWS_PER_WINDOW || claim.alert) {
      await service.from("ops_events").insert({
        severity: policy.severity,
        area: policy.area,
        kind,
        message,
        fingerprint: fp,
        path,
        subject: input.subject ?? null,
        detail: { ...(detail ?? {}), imFenster: claim.seen, gesamt: claim.total },
        release: release(),
      });
    }

    // ── 4. Alarm, falls die Schwelle jetzt erreicht ist. ─────────────────────────
    if (claim.alert) {
      await sendOpsAlert({
        kind,
        message,
        path,
        detail,
        seen: claim.seen,
        total: claim.total,
        suppressed: claim.suppressed,
      });
    }
  } catch (e) {
    // Der äussere Fangkorb. Hier endet jeder Fehler des Meldewesens — er darf den Aufrufer
    // nicht erreichen. Bewusst OHNE erneutes logOps: Das wäre eine Schleife.
    console.error("[ops] Meldung selbst fehlgeschlagen", e instanceof Error ? e.message : e);
  }
}

/**
 * Eine Admin-Aktion in die Spur schreiben. Löst nie einen Alarm aus (das sind wir selbst).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  WARUM ES DAS BRAUCHT, OBWOHL WIR NUR ZU ZWEIT SIND
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * OWASP A09 verlangt eine Spur über Rechte-Änderungen und Löschungen, und der Grund dafür
 * ist NICHT gegenseitiges Misstrauen. Er ist: Wenn irgendwann jemand fragt „warum hat dieser
 * Kunde plötzlich kein Pro mehr?" oder „wer hat den Spot gelöscht?", gibt es sonst keine
 * Antwort. Nicht „eine unangenehme", sondern gar keine — Postgres merkt sich das nicht, und
 * die Anwendung bisher auch nicht. Bei einem übernommenen Admin-Konto wäre es genau die
 * Spur, an der man sieht, was der Angreifer getan hat.
 *
 * WAS HIER LANDET, ist bewusst KLEIN: Rechte-Änderungen, Löschungen, Massen-Mails. Also das,
 * was man nicht rückgängig machen kann oder was Fremde betrifft. Jedes Speichern eines
 * Spot-Textes mitzuschreiben, würde die Spur unbrauchbar machen — man findet die eine
 * wichtige Zeile nicht zwischen tausend belanglosen.
 *
 * Die Admin-UUID steht hier im KLARTEXT, anders als überall sonst. Das ist kein Ausrutscher:
 * Sie ist der einzige Inhalt der Spur, der sie brauchbar macht, sie gehört uns selbst, und
 * die Tabelle ist service-only.
 */
export async function logAdminAction(
  adminUserId: string,
  what: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await logOps("admin_action", {
    message: what,
    subject: `admin:${adminUserId}`,
    detail,
    // Ruhefenster 0 im Katalog -> jede Aktion bekommt ihre eigene Zeile. Ohne eigenen
    // `group` wäre das schon so; er steht hier, damit zwei gleiche Aktionen an
    // verschiedenen Objekten nicht zufällig denselben Fingerabdruck bekommen.
    group: `admin:${what}`,
  });
}

/**
 * Einen Zähler erhöhen und den Stand im laufenden Fenster zurückgeben.
 *
 * Für Meldestellen, die den Zählerstand SELBST brauchen — etwa der Fehler-Endpunkt aus dem
 * Browser, der eine harte Obergrenze pro Absender durchsetzen muss, bevor er überhaupt etwas
 * meldet. Läuft über dieselbe `rate_limits`-Tabelle wie die Anmelde- und Tracking-Bremse
 * (Migration 0055 wurde ausdrücklich allgemein gebaut).
 *
 * Fällt bei einem Datenbankproblem auf 0 zurück, und 0 heisst beim Aufrufer „durchlassen":
 * Ein hakender Zähler soll nichts blockieren, was sonst funktioniert (fail-open, wie überall).
 */
export async function bumpOpsCounter(subject: string, windowSeconds: number): Promise<number> {
  try {
    const { data } = await createServiceClient().rpc("bump_ops_counter", {
      p_subject: subject,
      p_window_seconds: windowSeconds,
    });
    return typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────
//  Der Totmannschalter
// ───────────────────────────────────────────────────────────────────────────────────────

/**
 * „Ich war da." Jeder Hintergrund-Job ruft das am Ende auf, auch wenn er gescheitert ist.
 *
 * Der Unterschied zwischen `last_run_at` und `last_ok_at` ist der Punkt: Ein Job, der täglich
 * läuft und täglich scheitert, sieht mit nur einem Zeitstempel kerngesund aus.
 */
export async function writeHeartbeat(
  job: string,
  ok: boolean,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!active()) return;
  try {
    const now = new Date().toISOString();
    await createServiceClient()
      .from("ops_heartbeats")
      .upsert(
        {
          job,
          last_run_at: now,
          // Bei einem Fehllauf NICHT überschreiben: Der alte Erfolgszeitpunkt ist genau die
          // Information, die man dann braucht („läuft seit Dienstag schief").
          ...(ok ? { last_ok_at: now } : {}),
          ok,
          detail: scrubDetail(detail) ?? null,
        },
        { onConflict: "job" },
      );
  } catch (e) {
    console.error("[ops] Heartbeat nicht geschrieben", job, e instanceof Error ? e.message : e);
  }
}

export type JobStatus = {
  job: string;
  label: string;
  schedule: string;
  lastRunAt: string | null;
  lastOkAt: string | null;
  ok: boolean;
  overdue: boolean;
  /** Stunden seit dem letzten Lauf. Null, wenn es noch nie einen gab. */
  hoursSince: number | null;
};

/**
 * Den Zustand aller Jobs holen — die Grundlage für „läuft alles?".
 *
 * Ein Job, von dem es noch KEINE Zeile gibt, gilt bewusst NICHT als überfällig: Direkt nach
 * dem Einspielen der Migration hat noch keiner geschrieben, und ein Alarm „Cron fehlt" beim
 * allerersten Deploy wäre ein Fehlalarm — die teuerste Sorte, weil man danach dem nächsten
 * nicht mehr glaubt.
 */
export async function getJobStatus(): Promise<JobStatus[]> {
  let rows: { job: string; last_run_at: string; last_ok_at: string | null; ok: boolean }[] = [];
  try {
    const { data } = await createServiceClient()
      .from("ops_heartbeats")
      .select("job, last_run_at, last_ok_at, ok");
    rows = data ?? [];
  } catch {
    /* Datenbank hakt: dann eben „noch nie gelaufen" statt eines Absturzes */
  }
  const now = Date.now();
  return OPS_JOBS.map((j) => {
    const row = rows.find((r) => r.job === j.job);
    const hoursSince = row ? (now - new Date(row.last_run_at).getTime()) / 3_600_000 : null;
    return {
      job: j.job,
      label: j.label,
      schedule: j.schedule,
      lastRunAt: row?.last_run_at ?? null,
      lastOkAt: row?.last_ok_at ?? null,
      ok: row?.ok ?? true,
      overdue: hoursSince !== null && hoursSince > j.overdueHours,
      hoursSince,
    };
  });
}

/**
 * Überfällige Jobs suchen und melden. Läuft am Ende des täglichen Aufräum-Crons.
 *
 * WER BEWACHT DEN WÄCHTER: Der tägliche Cron prüft hier auch sich selbst — was nichts nützt,
 * wenn er gar nicht erst läuft. Die Admin-Systemseite ZEIGT denselben Zustand (über
 * getJobStatus), schickt aber bewusst keine Mail: Wer die Seite offen hat, sieht das rote
 * „überfällig" ja bereits, eine Mail dazu wäre nur Lärm. Ein wirklich unabhängiger zweiter
 * Wächter müsste ausserhalb dieser App laufen (externer Uptime-Dienst); das steht als
 * offener Punkt in docs/36.
 *
 * DAMIT DAS HIER ÜBERHAUPT ANSCHLAGEN KANN, braucht jeder Job eine Zeile in ops_heartbeats.
 * Ein Job ohne Zeile gilt absichtlich als „nicht überfällig" (sonst gäbe es beim ersten
 * Deploy Fehlalarm) — und wäre damit für immer unsichtbar, wenn er NIE läuft. Genau diesen
 * Fall gab es (siehe Migration 0057), deshalb sät sie die Zeilen beim Einspielen.
 */
export async function reportOverdueJobs(): Promise<number> {
  const overdue = (await getJobStatus()).filter((s) => s.overdue);
  for (const s of overdue) {
    await logOps("cron_missing", {
      message: `${s.label} ist seit ${Math.floor(s.hoursSince ?? 0)} Stunden nicht mehr gelaufen (Fahrplan: ${s.schedule}).`,
      // Je Job ein eigener Fingerabdruck, sonst verdeckt der erste ausgefallene Job den zweiten.
      group: `job:${s.job}`,
      detail: { job: s.job, stundenOhneLauf: Math.floor(s.hoursSince ?? 0), letzterErfolg: s.lastOkAt },
    });
  }
  return overdue.length;
}

/** Nur zur Lesbarkeit an den Aufrufstellen. */
export type { OpsKind, OpsSeverity };
