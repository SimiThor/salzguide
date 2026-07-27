import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import BackButton from "@/components/BackButton";
import ScrollStrip from "@/components/ScrollStrip";
import TestAlertButton from "@/components/admin/TestAlertButton";
import { getJobStatus } from "@/lib/ops";
import { getOpsEvents, getOpsSummary } from "@/lib/ops-read";
import { opsPolicy, SEVERITY_LOOK, type OpsSeverity } from "@/lib/ops-events";
import { STATUS_GOOD, STATUS_NEUTRAL, STATUS_ACCENT } from "@/lib/ui";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Das Logbuch. Die eine Seite, auf der steht, wie es der Plattform gerade geht.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WOFÜR SIE DA IST, obwohl doch Mails kommen: Die Mail beantwortet „ist gerade etwas
// passiert?". Diese Seite beantwortet die Fragen danach — seit wann geht das schon, kam es
// mit dem letzten Deploy, ist es einmalig oder hundertmal, und was lief sonst noch, das
// keine Mail wert war. Ein Alarm ohne Nachschlagewerk ist eine Beunruhigung.
//
// WARUM SIE UNTER „EINSTELLUNGEN" LIEGT UND KEIN EIGENER REITER IST:
// Die Admin-Navigation trägt fünf Reiter, und ihr eigener Kommentar sagt, warum kein
// sechster dazukommt: Jeder Reiter kostet bei JEDEM Blick Aufmerksamkeit, auch der, den man
// nie drückt. Diese Seite schaut man an, wenn eine Mail kam — und dann klickt man ohnehin
// einen Link in der Mail, nicht durch ein Menü. Für den Rest der Zeit soll sie nicht im Weg
// stehen. Dieselbe Begründung trägt schon Analytics eine Ebene höher.
export const dynamic = "force-dynamic";

/** Die Filter über der Liste. Der Zustand steht in der Adresse, nicht in React. */
const FILTERS = [
  { key: "", label: "Alles" },
  { key: "critical", label: "Nur Kritisch" },
  { key: "error", label: "Ab Fehler" },
  { key: "warn", label: "Ab Auffällig" },
] as const;

function isSeverity(v: string | undefined): v is OpsSeverity {
  return v === "info" || v === "warn" || v === "error" || v === "critical";
}

export default async function AdminSystemPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ab?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Der Filter steht in der Adresse: So ist „zeig mir alle kritischen" verlinkbar, und ein
  // Neuladen zeigt wieder dasselbe. Gleiche Entscheidung wie in der Mail-Vorschau nebenan.
  const raw = (await searchParams).ab;
  const minSeverity = isSeverity(raw) ? raw : undefined;

  const [summary, jobs, events] = await Promise.all([
    getOpsSummary(),
    getJobStatus(),
    getOpsEvents({ minSeverity, limit: 120 }),
  ]);

  const quiet = summary.critical === 0 && summary.error === 0;

  return (
    <div className="space-y-4 pb-12">
      <BackButton fallbackHref="/admin/settings" label="Einstellungen" />
      <div>
        <h1 className="text-2xl font-bold text-ink">System</h1>
        <p className="mt-1 text-[13px] text-muted">
          Fehler, Missbrauchsversuche und Hintergrund-Läufe. Alarme kommen zusätzlich per Mail.
        </p>
      </div>

      {/* ── Der erste Blick: geht es der Plattform gut? ────────────────────────────
          Ein Satz, keine Zahlenwand. Wer hier hereinkommt, will in einer Sekunde wissen,
          ob er weiterlesen muss. Die Zahlen stehen darunter, für den, der es genauer
          wissen will. */}
      <div className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[22px]" aria-hidden>
            {quiet ? "✅" : "🚨"}
          </span>
          <span className="text-[17px] font-bold text-ink">
            {quiet ? "Ruhig" : "Es gab Vorfälle"}
          </span>
          <span className={STATUS_NEUTRAL}>letzte {summary.hours} Stunden</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Count label="Kritisch" value={summary.critical} severity="critical" />
          <Count label="Fehler" value={summary.error} severity="error" />
          <Count label="Auffällig" value={summary.warn} severity="warn" />
          <Count label="Notizen" value={summary.info} severity="info" />
        </div>

        {summary.top.length > 0 && (
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            Am häufigsten:{" "}
            {summary.top.map((t, i) => (
              <span key={t.kind}>
                {i > 0 && ", "}
                {opsPolicy(t.kind).title} ({t.count}×)
              </span>
            ))}
          </p>
        )}
      </div>

      {/* ── Der Totmannschalter ───────────────────────────────────────────────────
          Steht ÜBER der Fehlerliste, obwohl er seltener etwas zeigt. Grund: Ein Job, der
          ausbleibt, erzeugt keine Zeile in der Liste darunter. Er ist der eine Zustand, den
          man nur sieht, wenn man ausdrücklich hinsieht. */}
      <div className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
        <h2 className="text-[17px] font-bold text-ink">Hintergrund-Läufe</h2>
        <p className="mt-1 text-[13px] text-muted">
          Läuft einer nicht mehr, merkt man das sonst nirgends: Ein ausbleibender Lauf wirft
          keinen Fehler, er erzeugt Stille.
        </p>
        <ul className="mt-4 space-y-3">
          {jobs.map((j) => (
            <li key={j.job} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[15px] font-semibold text-ink">{j.label}</span>
              {/* Reihenfolge = Dringlichkeit. „überfällig" schlägt alles andere, weil ein
                  ausbleibender Lauf schwerer wiegt als ein fehlgeschlagener: Beim
                  fehlgeschlagenen weiss man wenigstens, dass es ihn gibt.
                  „noch nie erfolgreich" ist der Zustand, den es vor Migration 0057 gar nicht
                  zu sehen gab — die Saat setzt zwar last_run_at, aber last_ok_at bleibt leer,
                  bis der Job wirklich einmal durchgelaufen ist. Ein grünes „läuft" wäre hier
                  gelogen. */}
              {j.lastRunAt === null ? (
                <span className={STATUS_NEUTRAL}>noch nie gelaufen</span>
              ) : j.overdue ? (
                <span className={STATUS_ACCENT}>überfällig</span>
              ) : j.lastOkAt === null ? (
                <span className={STATUS_ACCENT}>noch nie erfolgreich</span>
              ) : j.ok ? (
                <span className={STATUS_GOOD}>läuft</span>
              ) : (
                <span className={STATUS_ACCENT}>letzter Lauf mit Fehler</span>
              )}
              <span className="w-full text-[12px] text-muted">
                {j.schedule}
                {j.lastRunAt && ` · zuletzt ${when(j.lastRunAt)}`}
                {/* Der letzte ERFOLG nur dann, wenn er vom letzten Lauf abweicht: Sonst
                    stünde dieselbe Zeit zweimal nebeneinander. Genau diese Abweichung ist
                    das Signal „läuft, aber scheitert seit Tagen". */}
                {j.lastOkAt && j.lastOkAt !== j.lastRunAt && ` · erfolgreich ${when(j.lastOkAt)}`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <TestAlertButton />

      {/* ── Die Liste ─────────────────────────────────────────────────────────────── */}
      <div className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
        <h2 className="text-[17px] font-bold text-ink">Logbuch</h2>

        {/* Scroll-Streifen statt einer schlichten Flex-Leiste: Vier Pillen sind auf einem
            iPhone breiter als der Bildschirm, und eine zu breite Leiste schiebt sonst das
            ganze Dokument mit (dieselbe Falle wie in AdminNav). */}
        <div className="mt-3">
          <ScrollStrip>
            <div className="flex w-max gap-2">
              {FILTERS.map((f) => {
                const active = (raw ?? "") === f.key;
                return (
                  <Link
                    key={f.key || "all"}
                    href={f.key ? `/admin/settings/system?ab=${f.key}` : "/admin/settings/system"}
                    // `replace`, damit der Zurück-Pfeil oben die SEITE verlässt und nicht
                    // erst durch die zuletzt geklickten Filter zurückstolpert. Ein Filter ist
                    // kein Ort, an den man zurückkehrt.
                    replace
                    // `scroll={false}`: Der Filter sitzt weit unten. Ohne das springt die
                    // Seite bei jedem Klick nach oben und man muss sich seine Liste wieder
                    // suchen. Dieselbe Entscheidung wie bei den Sprachpillen der
                    // Mail-Vorschau.
                    scroll={false}
                    className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${
                      active ? "bg-ink text-white" : "bg-black/5 text-muted"
                    }`}
                  >
                    {f.label}
                  </Link>
                );
              })}
            </div>
          </ScrollStrip>
        </div>

        {events.length === 0 ? (
          <p className="mt-5 text-[14px] text-muted">
            Nichts eingetragen. Bei dieser Liste ist leer das gute Ergebnis.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-black/5">
            {events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Count({
  label,
  value,
  severity,
}: {
  label: string;
  value: number;
  severity: OpsSeverity;
}) {
  const look = SEVERITY_LOOK[severity];
  return (
    <div className="min-w-[84px] flex-1 rounded-[14px] bg-black/[0.03] px-3 py-2.5">
      <div
        className="text-[20px] font-bold leading-none"
        // Die Farbe kommt aus SEVERITY_LOOK, damit Liste, Mail und Kacheln dieselbe
        // Zuordnung tragen. Eine zweite Farbtabelle in Tailwind-Klassen wäre die zweite
        // Wahrheit, die beim nächsten Feinschliff auseinanderläuft.
        style={{ color: value > 0 ? look.hex : undefined }}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
    </div>
  );
}

function EventRow({
  event,
}: {
  event: Awaited<ReturnType<typeof getOpsEvents>>[number];
}) {
  const policy = opsPolicy(event.kind);
  const look = SEVERITY_LOOK[event.severity];
  const detail = Object.entries(event.detail ?? {}).filter(([k]) => k !== "stack");

  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* Ein Punkt statt einer farbigen Pille: In einer langen Liste sind vierzig Pillen
            eine Wand, vierzig Punkte sind eine Spalte, die man mit einem Blick abfährt. */}
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: look.hex }}
          aria-hidden
        />
        <span className="text-[14px] font-semibold text-ink">{policy.title}</span>
        <span className="text-[12px] text-muted">{when(event.created_at)}</span>
      </div>

      <p className="mt-1 pl-4 text-[13px] leading-relaxed text-muted">{event.message}</p>

      {(event.path || detail.length > 0 || event.release) && (
        <p className="mt-1 pl-4 text-[11px] leading-relaxed text-muted/80">
          {event.path && <span className="font-mono">{event.path}</span>}
          {detail.map(([k, v]) => (
            <span key={k}>
              {" · "}
              {k}: {String(v)}
            </span>
          ))}
          {event.release && <span>{" · Stand "}{event.release}</span>}
        </p>
      )}
    </li>
  );
}

/**
 * Zeitpunkt in unserer Zone.
 *
 * FEST auf Europe/Vienna, nicht auf die des Browsers: Vercel läuft in UTC, und eine Uhrzeit,
 * die zwei Stunden danebenliegt, macht die Frage „was war um halb neun?" unbeantwortbar.
 * Dieselbe Zone benutzt die Alarm-Mail, damit beide Ansichten dieselbe Uhr zeigen.
 */
function when(iso: string): string {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(new Date(iso));
}
