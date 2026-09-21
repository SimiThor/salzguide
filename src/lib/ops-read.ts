import "server-only";
import { createServiceClient } from "./supabase/service";
import { getAdminUserId } from "./admin-guard";
import { MAIL_CHANNEL_JOB } from "./ops";
import { SEVERITY_RANK, type OpsSeverity } from "./ops-events";

// Die Leseseite des Logbuchs. Getrennt von lib/ops.ts, wie analytics-queries.ts von
// analytics.ts getrennt ist: Schreiben passiert überall in der App und muss billig und
// unkaputtbar sein, Lesen passiert an genau einer Stelle und darf gründlich sein.
//
// WER DARF LESEN: Die Tabellen sind service-only (keine RLS-Policy, Default-Deny), also
// kommt kein Browser und keine Session heran — auch keine Admin-Session. Der Zugriff läuft
// ausschliesslich über diese Funktionen, und jede prüft ZUERST die Admin-Rolle. Das ist
// dasselbe Muster wie bei den Analytics-Abfragen (docs/34 §H).
//
// Warum nicht per RLS-Policy für Admins öffnen: Dann gäbe es zwei Wege zu denselben Daten,
// und der zweite (PostgREST direkt, mit dem Anon-Key plus Admin-Token) wäre einer, an den
// bei der nächsten Änderung niemand denkt. Ein Weg ist ein Weg.

export type OpsEventRow = {
  id: string;
  created_at: string;
  severity: OpsSeverity;
  area: string;
  kind: string;
  message: string;
  fingerprint: string;
  path: string | null;
  subject: string | null;
  detail: Record<string, unknown> | null;
  release: string | null;
};

/** Fenster für die Zusammenfassung oben auf der Seite. */
const SUMMARY_HOURS = 24;

/**
 * Die letzten Einträge, optional gefiltert.
 *
 * Gibt bei fehlender Berechtigung eine LEERE Liste zurück und wirft nicht: Diese Funktion
 * läuft in einer Seite, die ohnehin schon hinter dem Layout-Wächter liegt. Der Doppelboden
 * hier ist gegen den Tag gebaut, an dem jemand sie woanders einbindet.
 */
export async function getOpsEvents(opts: {
  /** „ab dieser Stufe aufwärts". Ohne Angabe: alles. */
  minSeverity?: OpsSeverity;
  area?: string;
  limit?: number;
}): Promise<OpsEventRow[]> {
  if (!(await getAdminUserId())) return [];
  try {
    let q = createServiceClient()
      .from("ops_events")
      .select("id, created_at, severity, area, kind, message, fingerprint, path, subject, detail, release")
      .order("created_at", { ascending: false })
      .limit(Math.min(opts.limit ?? 100, 300));

    if (opts.area) q = q.eq("area", opts.area);
    if (opts.minSeverity) {
      // Postgres kennt die Rangfolge unserer Stufen nicht (es ist eine Text-Spalte mit
      // CHECK, kein Enum). Also wird die Liste der erlaubten Werte im Code gebildet — das
      // ist ehrlicher als ein `gte` auf Text, das zufällig alphabetisch fast stimmt
      // ("critical" < "error" < "info" < "warn" wäre genau die falsche Reihenfolge).
      const rank = SEVERITY_RANK[opts.minSeverity];
      const allowed = (Object.keys(SEVERITY_RANK) as OpsSeverity[]).filter(
        (s) => SEVERITY_RANK[s] >= rank,
      );
      q = q.in("severity", allowed);
    }

    const { data } = await q;
    return (data ?? []) as OpsEventRow[];
  } catch {
    return [];
  }
}

export type OpsSummary = {
  hours: number;
  critical: number;
  error: number;
  warn: number;
  info: number;
  /** Die häufigsten Arten im Fenster, absteigend. */
  top: { kind: string; count: number }[];
};

/**
 * Die Zahlen für den Kopf der Seite: was war in den letzten 24 Stunden los?
 *
 * Bewusst im Code gezählt statt per SQL-Aggregat: Es sind höchstens ein paar hundert Zeilen
 * (der Flutschutz in lib/ops.ts sorgt dafür), und eine eigene RPC wäre eine weitere Funktion,
 * die man bei jeder Änderung am Schema mitpflegen muss. Wenn diese Seite je langsam wird,
 * ist das der Moment für ein Aggregat — heute wäre es Vorratsarbeit.
 */
export async function getOpsSummary(): Promise<OpsSummary> {
  const empty: OpsSummary = { hours: SUMMARY_HOURS, critical: 0, error: 0, warn: 0, info: 0, top: [] };
  if (!(await getAdminUserId())) return empty;
  try {
    const since = new Date(Date.now() - SUMMARY_HOURS * 3_600_000).toISOString();
    const { data } = await createServiceClient()
      .from("ops_events")
      .select("severity, kind")
      .gte("created_at", since)
      .limit(2000);

    const rows = (data ?? []) as { severity: OpsSeverity; kind: string }[];
    const counts = new Map<string, number>();
    const out = { ...empty };
    for (const r of rows) {
      if (r.severity in out) out[r.severity] += 1;
      counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    }
    out.top = [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return out;
  } catch {
    return empty;
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────
//  Der Mailkanal
// ───────────────────────────────────────────────────────────────────────────────────────

export type MailHealth = {
  /** Ist der letzte Versuch durchgegangen? Ohne jede Zeile: ja (nicht ohne Not Alarm schlagen). */
  ok: boolean;
  /** Letzter Versuch, egal ob Versand oder Klopftest. */
  lastAt: string | null;
  /** Wann zuletzt etwas durchging. Die Antwort auf „seit wann geht das schon?". */
  lastOkAt: string | null;
  /** Warum es klemmt, in einem Halbsatz („Schlüssel wird abgelehnt"). */
  reason: string | null;
};

/**
 * Geht gerade Post raus?
 *
 * Liest die Mailkanal-Zeile aus ops_heartbeats (geschrieben von lib/email.ts nach jedem
 * Versuch und vom täglichen Klopftest, siehe MAIL_CHANNEL_JOB in lib/ops.ts).
 *
 * WARUM DIESE FRAGE EINE EIGENE FUNKTION IST und nicht in getJobStatus() mitläuft: Dort
 * geht es um Läufe mit Fahrplan, hier um einen Kanal, der auch tagelang ungenutzt gesund
 * sein darf. Das Ergebnis hängt im Admin-Rahmen und damit auf JEDER Admin-Seite, nicht nur
 * im Logbuch: Ein kaputter Mailversand ist der eine Ausfall, über den keine Mail kommt.
 *
 * Fällt bei jedem Zweifel auf „ok" zurück. Ein Banner, das wegen eines Datenbank-Schluckaufs
 * erscheint, ist schlimmer als keins.
 */
export async function getMailHealth(): Promise<MailHealth> {
  const unknown: MailHealth = { ok: true, lastAt: null, lastOkAt: null, reason: null };
  if (!(await getAdminUserId())) return unknown;
  try {
    const { data } = await createServiceClient()
      .from("ops_heartbeats")
      .select("last_run_at, last_ok_at, ok, detail")
      .eq("job", MAIL_CHANNEL_JOB)
      .maybeSingle();
    if (!data) return unknown;
    const detail = (data.detail ?? {}) as Record<string, unknown>;
    const reason = typeof detail.grund === "string" ? detail.grund : null;
    return {
      ok: data.ok !== false,
      lastAt: data.last_run_at ?? null,
      lastOkAt: data.last_ok_at ?? null,
      reason,
    };
  } catch {
    return unknown;
  }
}
