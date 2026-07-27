import "server-only";
import { createServiceClient } from "./supabase/service";
import { getAdminUserId } from "./admin-guard";
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
