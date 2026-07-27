import { setRequestLocale } from "next-intl/server";
import BackButton from "@/components/BackButton";
import AnalyticsFilters from "@/components/admin/AnalyticsFilters";
import AdLinkBuilder from "@/components/admin/AdLinkBuilder";
import AiInsights from "@/components/admin/AiInsights";
import AiInsightsSummary from "@/components/admin/AiInsightsSummary";
import AnalyticsChart from "@/components/admin/AnalyticsChart";
import {
  getAnalyticsData,
  type AnalyticsDashboard,
  type AnalyticsQuery,
  type Campaign,
  type LabeledValue,
  type RangeKey,
  type TimePoint,
} from "@/lib/analytics-queries";
import { bucketRange, dayCount, shiftDay, type Bucket } from "@/lib/vienna-day";
import { getAiInsights, type AiInsightsData } from "@/lib/ai-insights";
import { siteUrl } from "@/lib/site-url";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
// Beschriftungen aus lib: scripts/analytics-check.ts prueft sie gegen classifyPath.
import { KIND_LABELS, SOURCE_LABELS, DEVICE_LABELS, EVENT_CAT_LABELS } from "@/lib/analytics-labels";

// Analytics v3 (docs/34 §H) — cookieless, nur Aggregate, mit Filtern, Ad-Link-Builder
// und KI-Auswertung. Ohne echte Daten: klar gekennzeichnete Beispieldaten-Vorschau.
export const dynamic = "force-dynamic";

// Alle Sprachen aus der zentralen Config (Endonym) -> neue Sprache erscheint automatisch.
const LOCALE_LABELS: Record<string, string> = Object.fromEntries(
  routing.locales.map((l) => [l, localeMeta(l).name]),
);

const fmtDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} min`;

const de = (n: number) => n.toLocaleString("de-AT");
// Quoten mit einer Nachkommastelle. Braucht es, weil `${o.saveRate}` in einer Vorlage die
// JS-Schreibweise nimmt: Im Dashboard stand „Merkrate 6.1", „2.9 je 100 Besuche" und
// „1.4 %" mit Punkt, während jede Ganzzahl daneben brav „5 130" mit Tausenderpunkt zeigte.
// Zwei Zahlensysteme auf einer Seite, und der Punkt bedeutet in beiden etwas anderes.
const de1 = (n: number) => n.toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Eine Überschrift, die die FRAGE stellt, die der Block darunter beantwortet. */
function Section({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mt-2 border-t border-black/[0.06] pt-5">
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{hint}</p>
    </div>
  );
}

/**
 * Die Veränderung zum gleich langen Zeitraum davor.
 *
 * WARUM DAS AN JEDE KACHEL GEHÖRT: „1.240 Aufrufe" ist keine Information, aus der eine
 * Handlung folgt — man weiss nicht, ob das viel ist. Erst die Richtung macht daraus eine
 * Entscheidung. Es ist die billigste Ergänzung im ganzen Dashboard (ein zusätzlicher
 * RPC-Aufruf, parallel zu den anderen) und die einzige, die JEDE Zahl darüber aufwertet.
 *
 * `goodWhenUp={false}` für die Bounce-Rate: Dort ist weniger besser, und eine grüne Zahl
 * neben einer steigenden Absprungrate wäre schlimmer als gar keine Farbe.
 */
function Delta({
  now,
  before,
  goodWhenUp = true,
}: {
  now: number;
  before: number | undefined;
  goodWhenUp?: boolean;
}) {
  if (before === undefined) return null;
  if (before === 0) {
    return now > 0 ? <span className="text-[12px] font-semibold text-emerald-600">neu</span> : null;
  }
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="text-[12px] font-medium text-muted">unverändert</span>;
  const up = pct > 0;
  const good = up === goodWhenUp;
  return (
    <span
      className={`text-[12px] font-semibold ${good ? "text-emerald-600" : "text-rose-600"}`}
      title={`Vorher: ${de(before)}`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct)} %
    </span>
  );
}

/**
 * Eine Kennzahl-Kachel. `answerable={false}` heisst NICHT „null", sondern „diese Frage
 * beantwortet der gesetzte Filter nicht" — siehe `Answerable` in lib/analytics-queries.ts.
 * Dann steht ein Strich da, wo sonst eine Zahl steht, denn eine 0 wäre gelogen.
 */
function StatCard({
  label,
  value,
  display,
  sub,
  answerable = true,
  reason,
  before,
  goodWhenUp = true,
}: {
  label: string;
  value?: number;
  display?: string;
  sub?: string;
  answerable?: boolean;
  reason?: string | null;
  before?: number;
  goodWhenUp?: boolean;
}) {
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <p className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <p
          className={`text-[22px] font-bold leading-none ${answerable ? "text-ink" : "text-black/25"}`}
          title={answerable ? undefined : (reason ?? undefined)}
        >
          {answerable ? (display ?? de(value ?? 0)) : "–"}
        </p>
        {answerable && value !== undefined && (
          <Delta now={value} before={before} goodWhenUp={goodWhenUp} />
        )}
      </div>
      {(answerable ? sub : true) && (
        <p className="mt-1 text-[12px] text-muted">
          {answerable ? sub : "nicht nach diesem Filter auswertbar"}
        </p>
      )}
    </div>
  );
}

function BarList({ title, subtitle, items, labelMap, empty, answerable = true, reason }: {
  title: string; subtitle?: string; items: LabeledValue[];
  labelMap?: Record<string, string>; empty: string;
  answerable?: boolean; reason?: string | null;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {subtitle && <p className="text-[11px] text-muted">{subtitle}</p>}
      {/* Leere Liste ≠ „es ist nichts passiert". Beantwortet der Filter die Frage gar
          nicht, muss das dastehen und nicht „Noch keine gemerkten Spots." */}
      {!answerable ? (
        <p className="mt-3 text-[13px] text-muted">{reason ?? "Nicht nach diesem Filter auswertbar."}</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((it, i) => (
            <li key={i}>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate text-ink">{labelMap?.[it.label] ?? it.label}</span>
                <span className="shrink-0 font-semibold text-muted">{it.value.toLocaleString("de-AT")}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.05]">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((it.value / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Das Balkenbild ohne eine einzige Ziffer ist raus. Es steckt jetzt in
// components/admin/AnalyticsChart.tsx, mit Achse, Werten und den drei Zahlen, die man
// aus einer Kurve ohnehin ablesen will. Warum das kein Schönheitsfehler war, steht dort.

/**
 * Der Weg zu Pro.
 *
 * Bis hierher gab es eine einzelne Kachel „Conversions" ohne Nenner. Zwei Käufe sind ein
 * Erfolg, wenn zwanzig Leute die Verkaufsseite gesehen haben, und ein Alarm, wenn es
 * zweitausend waren — dieselbe Zahl, zwei entgegengesetzte Schlüsse. Erst die beiden
 * Verhältnisse sagen, WO es klemmt:
 *
 *   wenige /pro-Aufrufe je Besuch -> die Leute finden das Angebot nicht (Platzierung)
 *   viele Aufrufe, wenige Käufe   -> sie finden es und wollen es nicht (Angebot, Preis, Text)
 *
 * KEIN echter Trichter: Wir verfolgen niemanden über Tage oder Geräte, das ist der Kern der
 * cookielosen Messung. Es sind drei Zahlen mit drei Einheiten. Genau so steht es auch da,
 * weil „Conversion-Rate" hier eine Genauigkeit behaupten würde, die die Daten nicht haben.
 */
function ProPathCard({
  path,
  answerable,
  reason,
}: {
  path: { sessions: number; proViews: number; conversions: number };
  answerable: boolean;
  reason?: string | null;
}) {
  const perVisit = path.sessions ? Math.round((path.proViews / path.sessions) * 1000) / 10 : 0;
  const perView = path.proViews ? Math.round((path.conversions / path.proViews) * 1000) / 10 : 0;
  const steps = [
    { label: "Besuche", value: de(path.sessions), note: "Sitzungen im Zeitraum" },
    { label: "Pro-Seite angesehen", value: de(path.proViews), note: `${de1(perVisit)} je 100 Besuche` },
    {
      label: "Käufe",
      value: answerable ? de(path.conversions) : "–",
      note: answerable ? `${de1(perView)} je 100 Pro-Aufrufe` : "nicht nach diesem Filter auswertbar",
    },
  ];
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <h2 className="text-[15px] font-semibold text-ink">Weg zu Pro</h2>
      <p className="text-[11px] text-muted">
        Drei eigene Zahlen, kein verfolgter Trichter: Wir erkennen niemanden über Tage hinweg.
      </p>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-baseline gap-3">
            <span className="w-5 shrink-0 text-[12px] font-bold text-accent">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-ink">{s.label}</span>
              <span className="block text-[11px] text-muted" title={reason ?? undefined}>
                {s.note}
              </span>
            </span>
            <span className="shrink-0 text-[17px] font-bold text-ink">{s.value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Die Inhalts-To-do-Liste: Aufrufe UND Merkungen je Spot in einer Zeile.
 *
 * Aufrufe und Merkungen gab es schon, aber als zwei getrennte Balkenlisten — und die
 * Aussage steht nicht in einer der beiden, sondern zwischen ihnen. Viele Aufrufe bei wenigen
 * Merkungen heisst: Der Spot wird gefunden und überzeugt nicht (Bild, Text, fehlende
 * Angaben). Wenige Aufrufe bei hoher Merk-Quote heisst das Gegenteil: Der Inhalt sitzt, nur
 * findet ihn niemand.
 *
 * Die Quote wird erst ab genug Aufrufen bewertet. Aus drei Aufrufen und einer Merkung
 * „33 %" zu machen und den Spot nach oben zu sortieren, wäre die klassische Art, mit einer
 * richtig gerechneten Zahl eine falsche Entscheidung zu erzeugen.
 */
const RATE_MIN_VIEWS = 25;

function SpotPerformanceTable({
  rows,
  answerable,
  reason,
}: {
  rows: { slug: string; title: string; views: number; saves: number; rate: number }[];
  answerable: boolean;
  reason?: string | null;
}) {
  const rated = rows.filter((r) => r.views >= RATE_MIN_VIEWS);
  const avgRate = rated.length
    ? rated.reduce((s, r) => s + r.rate, 0) / rated.length
    : 0;

  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <h2 className="text-[15px] font-semibold text-ink">Spots: Aufrufe → Merkungen</h2>
      <p className="text-[11px] text-muted">
        Wird gefunden, überzeugt aber nicht? Dann fehlt am Spot etwas.
      </p>
      {!answerable ? (
        <p className="mt-3 text-[13px] text-muted">{reason ?? "Nicht nach diesem Filter auswertbar."}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Noch keine Spot-Aufrufe im Zeitraum.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="pb-1 font-medium">Spot</th>
                <th className="pb-1 text-right font-medium">Aufrufe</th>
                <th className="pb-1 text-right font-medium">Merkungen</th>
                <th className="pb-1 text-right font-medium">Quote</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rateable = r.views >= RATE_MIN_VIEWS;
                // Deutlich unter dem eigenen Schnitt = der Fall, der Arbeit bedeutet.
                const weak = rateable && avgRate > 0 && r.rate < avgRate * 0.5;
                const strong = rateable && avgRate > 0 && r.rate > avgRate * 1.5;
                return (
                  <tr key={r.slug} className="border-t border-black/5">
                    <td className="py-1.5 pr-2 font-medium text-ink">
                      <span className="line-clamp-1">{r.title}</span>
                    </td>
                    <td className="py-1.5 text-right text-ink">{de(r.views)}</td>
                    <td className="py-1.5 text-right text-muted">{de(r.saves)}</td>
                    <td
                      className={`py-1.5 text-right font-semibold ${
                        !rateable ? "text-black/25" : weak ? "text-rose-600" : strong ? "text-emerald-600" : "text-muted"
                      }`}
                      title={rateable ? undefined : `Erst ab ${RATE_MIN_VIEWS} Aufrufen aussagekräftig`}
                    >
                      {rateable ? `${de1(r.rate)} %` : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            Quote = Merkungen je 100 Aufrufe, ab {RATE_MIN_VIEWS} Aufrufen.{" "}
            <span className="text-rose-600">Rot</span> = deutlich unter dem Schnitt dieser Liste
            ({de1(avgRate)} %), also überarbeiten.{" "}
            <span className="text-emerald-600">Grün</span> = überzeugt, mehr davon zeigen.
          </p>
        </div>
      )}
    </div>
  );
}

function CampaignTable({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <h2 className="text-[15px] font-semibold text-ink">Kampagnen (Ad-Qualität)</h2>
      {campaigns.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Noch keine Kampagnen-Klicks. Erstelle rechts einen Ad-Link.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="pb-1 font-medium">Kampagne</th>
                <th className="pb-1 text-right font-medium">Besuche</th>
                <th className="pb-1 text-right font-medium">Seiten/Besuch</th>
                <th className="pb-1 text-right font-medium">Bounce</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.campaign} className="border-t border-black/5">
                  <td className="py-1.5 pr-2 font-medium text-ink">{c.campaign}</td>
                  <td className="py-1.5 text-right text-ink">{c.sessions.toLocaleString("de-AT")}</td>
                  <td className="py-1.5 text-right text-muted">{de1(c.avgPages)}</td>
                  <td className="py-1.5 text-right text-muted">{de1(c.bounceRate)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Beispieldaten-Vorschau (deterministisch, skaliert mit dem Zeitraum) ──────
//
// Zeitraum, Balkenbreite und Balken-Anfänge kommen aus DERSELBEN Rechnung wie bei echten
// Daten (lib/vienna-day.ts). Vorher rechnete diese Funktion ihr eigenes Raster: Die
// Vorschau zeigte damit ein Diagramm, das es mit echten Zahlen so nie geben konnte.
function demoDashboard(from: string, to: string, bucket: Bucket): AnalyticsDashboard {
  const spanDays = dayCount(from, to);
  const factor = spanDays <= 31 ? 1 : spanDays <= 92 ? 2.7 : spanDays <= 185 ? 4.9 : 8.6;
  const perBucket = bucket === "day" ? 1 : bucket === "week" ? 7 : 30;
  const scale = (n: number) => Math.round(n * factor);
  const timeseries: TimePoint[] = bucketRange(from, to, bucket).map((b, i) => {
    const pv = Math.round((150 + Math.sin(i / 2.5) * 28 + (i % 7 > 4 ? 60 : 0)) * perBucket * 0.9);
    return { bucket: b, pageviews: pv, visitors: Math.round(pv * 0.62) };
  });
  // Die Kopfzahlen kommen AUS der Zeitreihe, nicht aus einer zweiten Erfindung.
  //
  // Vorher standen oben „5 130 Seitenaufrufe" und im Diagramm darunter „Summe 4 498" — zwei
  // frei gewählte Zahlenreihen, die dieselbe Sache beschreiben sollten. Bei echten Daten
  // kann das nicht passieren (beides zählt dieselben Ereignisse), in der Vorschau schon.
  // Und eine Vorschau, die sich selbst widerspricht, bringt genau das bei, was das ganze
  // Dashboard vermeiden soll: dass man den Zahlen nicht trauen kann.
  const pageviews = timeseries.reduce((s, t) => s + t.pageviews, 0);
  const visitors = timeseries.reduce((s, t) => s + t.visitors, 0);
  const sessions = Math.round(visitors * 1.15);
  const saves = Math.round(pageviews * 0.061);
  // Ein sichtbar ANDERER Vorzeitraum, damit die Vorschau zeigt, wozu der Vergleich da ist.
  const before = (n: number) => Math.round(n * 0.87);
  return {
    from,
    to,
    bucket,
    answerable: { saves: true, aiQueries: true, eventLinks: true, conversions: true, note: null },
    overview: {
      pageviews, visitors, sessions, saves,
      eventLinks: scale(148), aiQueries: scale(221), conversions: scale(18),
      bounceRate: 51, avgDurationSec: 96,
      saveRate: Math.round((saves / pageviews) * 1000) / 10,
    },
    previous: {
      pageviews: before(pageviews), visitors: before(visitors), sessions: before(sessions),
      saves: before(saves), eventLinks: before(scale(148)), aiQueries: before(scale(221)),
      conversions: before(scale(18)), bounceRate: 55, avgDurationSec: 88, saveRate: 5.6,
    },
    previousFrom: shiftDay(from, -spanDays),
    previousTo: shiftDay(from, -1),
    timeseries,
    pageKinds: [
      { label: "spot", value: scale(2260) }, { label: "explore", value: scale(1180) },
      { label: "landing", value: scale(690) }, { label: "events", value: scale(410) },
      { label: "tour", value: scale(260) }, { label: "water", value: scale(160) },
      { label: "pro", value: scale(95) }, { label: "saved", value: scale(75) },
    ],
    spotPerformance: [
      { slug: "gaisberg", title: "Gaisberg", views: scale(720), saves: scale(46), rate: 6.4 },
      { slug: "koenigssee", title: "Königssee", views: scale(610), saves: scale(39), rate: 6.4 },
      { slug: "untersberg", title: "Untersberg", views: scale(430), saves: scale(6), rate: 1.4 },
      { slug: "almbachklamm", title: "Almbachklamm", views: scale(360), saves: scale(31), rate: 8.6 },
      { slug: "wolfgangsee", title: "Wolfgangsee", views: scale(290), saves: scale(20), rate: 6.9 },
      { slug: "moenchsberg", title: "Mönchsberg", views: scale(240), saves: scale(4), rate: 1.7 },
      { slug: "hintersee", title: "Hintersee", views: scale(130), saves: scale(15), rate: 11.5 },
      { slug: "kapuzinerberg", title: "Kapuzinerberg", views: 18, saves: 2, rate: 11.1 },
    ],
    // Dieselben Zahlen wie oben, nicht daneben erfundene: Der Kachel-Wert „Besuche" und der
    // erste Schritt des Wegs zu Pro sind dieselbe Sache.
    proPath: { sessions, proViews: scale(95), conversions: scale(18) },
    topSpotsSaved: [
      { label: "Gaisberg", value: scale(46) }, { label: "Königssee", value: scale(39) },
      { label: "Almbachklamm", value: scale(31) }, { label: "Untersberg", value: scale(24) },
      { label: "Wolfgangsee", value: scale(20) }, { label: "Hintersee", value: scale(15) },
    ],
    topSpotsViewed: [
      { label: "Gaisberg", value: scale(720) }, { label: "Königssee", value: scale(610) },
      { label: "Untersberg", value: scale(430) }, { label: "Almbachklamm", value: scale(360) },
      { label: "Wolfgangsee", value: scale(290) }, { label: "Mönchsberg", value: scale(240) },
    ],
    topEventsSaved: [
      { label: "Electric Love", value: scale(28) }, { label: "Salzburger Festspiele", value: scale(19) },
      { label: "Rupertikirtag", value: scale(14) }, { label: "Jazz & The City", value: scale(9) },
    ],
    spotCategories: [
      { label: "Wanderung", value: scale(1180) }, { label: "Aussicht", value: scale(760) },
      { label: "See", value: scale(540) }, { label: "Café", value: scale(410) }, { label: "Restaurant", value: scale(230) },
    ],
    eventCategories: [
      { label: "party", value: scale(118) }, { label: "kultur", value: scale(94) },
      { label: "sport", value: scale(58) }, { label: "tradition", value: scale(42) }, { label: "kids", value: scale(19) },
    ],
    sources: [
      { label: "search", value: scale(2180) }, { label: "direct", value: scale(1620) },
      { label: "social", value: scale(990) }, { label: "salzburg.info", value: scale(210) }, { label: "servustv.com", value: scale(130) },
    ],
    campaigns: [
      { campaign: "ig-sommer24", sessions: scale(210), pageviews: scale(480), avgPages: 2.3, bounceRate: 44 },
      { campaign: "tiktok-seen", sessions: scale(140), pageviews: scale(250), avgPages: 1.8, bounceRate: 58 },
      { campaign: "ig-events", sessions: scale(90), pageviews: scale(216), avgPages: 2.4, bounceRate: 41 },
    ],
    devices: [
      { label: "mobile", value: scale(3620) }, { label: "desktop", value: scale(1180) }, { label: "tablet", value: scale(330) },
    ],
    countries: [
      { label: "AT", value: scale(3210) }, { label: "DE", value: scale(1390) },
      { label: "IT", value: scale(210) }, { label: "NL", value: scale(120) }, { label: "CH", value: scale(90) },
    ],
    locales: [
      { label: "de", value: scale(4110) }, { label: "en", value: scale(1020) },
      { label: "it", value: scale(280) }, { label: "fr", value: scale(160) }, { label: "nl", value: scale(90) },
    ],
    options: { countries: ["AT", "DE", "IT", "NL", "CH"], campaigns: ["ig-sommer24", "tiktok-seen", "ig-events"] },
  };
}

// Content-Lücken-Tabelle (unbeantwortete Wünsche) — das wertvollste Produkt-Signal.
function GapList({ gaps }: { gaps: AiInsightsData["gaps"] }) {
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <h2 className="text-[15px] font-semibold text-ink">Content-Lücken</h2>
      <p className="text-[11px] text-muted">
        Wünsche, die der Chatbot NICHT erfüllen konnte: was wir aufnehmen/ergänzen sollten.
      </p>
      {gaps.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">
          Keine Lücken über der Sichtbarkeitsschwelle (k-Anonymität), oder noch zu wenige Anfragen.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {gaps.map((g, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="min-w-0 text-ink">
                <span className="font-medium">{g.category}</span>
                <span className="text-muted"> · {g.region} · {g.reason}</span>
              </span>
              <span className="shrink-0 font-semibold text-muted">{g.count.toLocaleString("de-AT")}×</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Beispieldaten-Vorschau für die KI-Insights (deterministisch, skaliert mit Zeitraum).
function demoInsights(spanDays: number, from: string, to: string): AiInsightsData {
  const factor = spanDays <= 31 ? 1 : spanDays <= 92 ? 2.7 : spanDays <= 185 ? 4.9 : 8.6;
  const sc = (n: number) => Math.round(n * factor);
  const total = sc(221);
  const answered = sc(178);
  return {
    from,
    to,
    total,
    answered,
    unanswered: total - answered,
    answerRate: Math.round((answered / total) * 100),
    intents: [
      { label: "Spot/Ort finden", value: sc(96) }, { label: "Essen & Trinken", value: sc(38) },
      { label: "Events", value: sc(31) }, { label: "Tour/Reise planen", value: sc(24) },
      { label: "Praktisches (Zeiten/Anfahrt)", value: sc(18) }, { label: "Wetter/Saison", value: sc(14) },
    ],
    categories: [
      { label: "Wandern", value: sc(64) }, { label: "Baden/See", value: sc(48) },
      { label: "Aussicht", value: sc(29) }, { label: "Café", value: sc(22) },
      { label: "Restaurant", value: sc(19) }, { label: "Familie/Kinder", value: sc(12) },
    ],
    regions: [
      { label: "Stadt Salzburg", value: sc(88) }, { label: "Flachgau", value: sc(41) },
      { label: "Pinzgau", value: sc(28) }, { label: "Tennengau", value: sc(21) }, { label: "Pongau", value: sc(15) },
    ],
    locales: [
      { label: "Deutsch", value: sc(171) }, { label: "English", value: sc(50) },
      { label: "Italiano", value: sc(14) }, { label: "Français", value: sc(8) },
    ],
    gaps: [
      { category: "Baden/See", region: "Pinzgau", reason: "Kein passender Inhalt (Content-Lücke)", count: sc(9) },
      { category: "Café", region: "Stadt Salzburg", reason: "Info fehlt beim Spot (Datenlücke)", count: sc(7) },
      { category: "Wandern", region: "Lungau", reason: "Kein passender Inhalt (Content-Lücke)", count: sc(6) },
    ],
    kMin: 5,
  };
}

const s = (v: string | undefined): string | null => (v && v.trim() ? v : null);

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const range = (["30d", "3mo", "6mo", "12mo"] as const).includes(sp.range as RangeKey)
    ? (sp.range as RangeKey)
    : "30d";
  const query: AnalyticsQuery = {
    range,
    from: s(sp.from),
    to: s(sp.to),
    filters: {
      locale: s(sp.locale),
      country: s(sp.country),
      device: s(sp.device),
      source: s(sp.source),
      campaign: s(sp.campaign),
    },
  };

  const real = await getAnalyticsData(query);
  if (!real) return <p className="text-sm text-muted">Kein Zugriff.</p>;
  // Vorschau, solange keine echten Seitenaufrufe da sind (Pageviews = Produktions-
  // Indikator; Client-Beacon trackt nur live). Einzelne Server-Events (z.B. KI) ändern das nicht.
  const isDemo = real.overview.pageviews === 0;
  // Zeitraum NICHT hier noch einmal rechnen: `real` bringt ihn mit, in Wiener Tagen und auf
  // die Balkenbreite eingerastet. Die zweite Rechnung an dieser Stelle wich von der ersten ab
  // (sie las die roh übergebenen Parameter statt der geprüften) — und beschriftete damit ein
  // Diagramm mit einem Zeitraum, den es nicht zeigte.
  const data = isDemo ? demoDashboard(real.from, real.to, real.bucket) : real;
  const o = data.overview;
  const p = data.previous; // Vorzeitraum, oder null wenn es davor nichts zu messen gab
  const a = data.answerable;
  const baseUrl = siteUrl();

  // KI-Insights (anonyme Chatbot-Nachfrage). Gleicher Zeitraum wie oben — die Kachel
  // „KI-Anfragen" steht hier zweimal auf einer Seite, sie darf nicht zwei Fenster meinen.
  const insightsQuery = { range, from: data.from, to: data.to };
  const realInsights = await getAiInsights(insightsQuery);
  const insights =
    isDemo || !realInsights
      ? demoInsights(dayCount(data.from, data.to), data.from, data.to)
      : realInsights;

  return (
    <div className="space-y-4 pb-12">
      <BackButton fallbackHref="/admin/settings" label="Einstellungen" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Analytics</h1>
        <p className="mt-1 text-[13px] text-muted">
          Datenschutzkonform &amp; cookieless · {data.from} bis {data.to}
        </p>
      </div>

      <AnalyticsFilters
        current={{
          range,
          from: query.from ?? null,
          to: query.to ?? null,
          locale: query.filters?.locale ?? null,
          country: query.filters?.country ?? null,
          device: query.filters?.device ?? null,
          source: query.filters?.source ?? null,
          campaign: query.filters?.campaign ?? null,
        }}
        options={data.options}
      />

      {isDemo && (
        <div className="rounded-[16px] border border-amber-400/50 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900">
          <strong>Vorschau mit Beispieldaten.</strong>{" "}
          So sieht dein Dashboard aus und das wird
          erfasst. Echte Zahlen &amp; die KI-Auswertung erscheinen automatisch, sobald die Seite
          live ist. In der Entwicklung wird bewusst nicht getrackt (Datenschutz).
        </div>
      )}

      {!isDemo && <AiInsights query={query} />}

      {/* ══ 1. Läuft es besser als vorher? ═══════════════════════════════════
          Die Reihenfolge der Seite folgt jetzt den FRAGEN, nicht mehr den Tabellen, aus
          denen die Zahlen kommen. Vorher standen achtzehn gleich aussehende Kärtchen
          untereinander, jedes für sich richtig, und man musste selbst wissen, welche zwei
          man nebeneinanderhalten muss, damit etwas daraus folgt. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Seitenaufrufe" value={o.pageviews} before={p?.pageviews} />
        <StatCard label="Besuche" value={o.sessions} sub="Sessions" before={p?.sessions} />
        <StatCard label="Besucher" value={o.visitors} sub="eindeutig / Tag" before={p?.visitors} />
        <StatCard
          label="Bounce-Rate" value={o.bounceRate} display={`${o.bounceRate} %`}
          sub="nur eine Seite gesehen" before={p?.bounceRate} goodWhenUp={false}
        />
        <StatCard
          label="Ø Verweildauer" value={o.avgDurationSec} display={fmtDuration(o.avgDurationSec)}
          before={p?.avgDurationSec}
        />
        <StatCard
          label="Merkungen" value={o.saves} sub={`Merkrate ${de1(o.saveRate)} je 100 Aufrufe`}
          answerable={a.saves} reason={a.note} before={p?.saves}
        />
        <StatCard
          label="KI-Anfragen" value={o.aiQueries}
          sub={a.eventLinks ? `Event-Klicks: ${de(o.eventLinks)}` : undefined}
          answerable={a.aiQueries} reason={a.note} before={p?.aiQueries}
        />
        <StatCard
          label="Käufe" value={o.conversions} sub="Free → Pro"
          answerable={a.conversions} reason={a.note} before={p?.conversions}
        />
      </div>

      <p className="px-1 text-[12px] leading-relaxed text-muted">
        {data.previous
          ? `Vergleich jeweils mit ${data.previousFrom} bis ${data.previousTo} (gleich lang, gleiche Filter).`
          : "Kein Vergleich: Im gleich langen Zeitraum davor wurde noch nichts gemessen."}
        {a.note ? ` ${a.note}` : ""}
      </p>

      <AnalyticsChart points={data.timeseries} bucket={data.bucket} />

      {/* ══ 2. Verkauft Pro? ═══════════════════════════════════════════════ */}
      <Section
        title="Verkauft Pro?"
        hint="Zwei Käufe sind ein Erfolg, wenn zwanzig Leute die Pro-Seite gesehen haben, und ein Alarm, wenn es zweitausend waren. Deshalb steht der Nenner daneben."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ProPathCard path={data.proPath} answerable={a.conversions} reason={a.note} />
        <BarList
          title="Wohin die Aufmerksamkeit geht" subtitle="Aufrufe je Seitenart"
          items={data.pageKinds} labelMap={KIND_LABELS}
          empty="Noch keine Aufrufe."
        />
      </div>

      {/* ══ 3. Was sollen wir als Nächstes bauen? ══════════════════════════
          Die beiden stärksten Produkt-Signale, die es gibt: was Toni nicht beantworten
          konnte (also fehlender Inhalt) und welcher vorhandene Inhalt nicht überzeugt.
          Die Content-Lücken standen bisher ganz unten am Seitenende. */}
      <Section
        title="Was fehlt und was ist zu schwach?"
        hint="Links: Wünsche, die Toni nicht erfüllen konnte, also fehlender Inhalt. Rechts: Spots, die gefunden werden und trotzdem niemand merkt, also vorhandener Inhalt, der nicht überzeugt."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <GapList gaps={insights.gaps} />
        <SpotPerformanceTable
          rows={data.spotPerformance} answerable={a.saves} reason={a.note}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarList title="Top-Spots" subtitle="nach Merkungen" items={data.topSpotsSaved} empty="Noch keine gemerkten Spots." answerable={a.saves} reason={a.note} />
        <BarList title="Spot-Kategorien" subtitle="nach Aufrufen" items={data.spotCategories} empty="Keine Daten." />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarList title="Top-Events" subtitle="nach Merkungen" items={data.topEventsSaved} empty="Noch keine gemerkten Events." answerable={a.saves} reason={a.note} />
        <BarList title="Event-Kategorien" subtitle="nach Merkungen" items={data.eventCategories} labelMap={EVENT_CAT_LABELS} empty="Keine Daten." answerable={a.saves} reason={a.note} />
      </div>

      {/* ══ 4. Woher kommen die Leute? ════════════════════════════════════ */}
      <Section
        title="Woher kommen sie?"
        hint="Welcher Kanal bringt Leute, die bleiben. Seiten/Besuch und Bounce sagen mehr über eine Anzeige als die Zahl der Klicks."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <CampaignTable campaigns={data.campaigns} />
        <AdLinkBuilder baseUrl={baseUrl} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <BarList title="Quellen" subtitle="nach Aufrufen" items={data.sources} labelMap={SOURCE_LABELS} empty="Keine Daten." />
        <BarList title="Länder" subtitle="nach Aufrufen" items={data.countries} empty="Keine Daten." />
        <BarList title="Sprache" subtitle="nach Aufrufen" items={data.locales} labelMap={LOCALE_LABELS} empty="Keine Daten." />
        <BarList title="Geräte" subtitle="nach Aufrufen" items={data.devices} labelMap={DEVICE_LABELS} empty="Keine Daten." />
      </div>

      {/* ══ 5. Was fragen die Leute Toni? (docs/34 §I) ════════════════════ */}
      <Section
        title="Was fragen die Leute Toni?"
        hint={`Anonyme Auswertung der Chatbot-Anfragen, nur feste Codes, kein Text, kein Personenbezug · ${insights.from} bis ${insights.to}`}
      />

      {!isDemo && <AiInsightsSummary query={insightsQuery} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* „eingeordnet" und nicht schlicht „KI-Anfragen": Weiter oben steht eine Kachel mit
            demselben Namen, die aus einer anderen Tabelle kommt. Dort zählt jede beantwortete
            Frage; hier nur die, für die der Klassifikator hinterher auch Codes vergeben hat.
            Fällt der aus, bleibt die Antwort trotzdem beim Nutzer — die Zeile hier fehlt dann.
            Diese Kachel ist also immer kleiner oder gleich der oberen, und wer den Unterschied
            nicht erklärt bekommt, hält eine der beiden Zahlen für falsch. */}
        <StatCard label="KI-Anfragen" value={insights.total} sub="davon eingeordnet" />
        <StatCard label="Beantwortet" display={`${insights.answerRate}%`} sub={`${insights.answered} von ${insights.total}`} />
        <StatCard label="Offen geblieben" value={insights.unanswered} sub="Content-/Datenlücken" />
        <StatCard label="Sichtbarkeit" display={`k ≥ ${insights.kMin}`} sub="kleinere Gruppen verborgen" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarList title="Was Nutzer wollen" subtitle="Absichten der Anfragen" items={insights.intents} empty="Noch keine Daten." />
        <BarList title="Top-Themen" subtitle="Kategorien der Anfragen" items={insights.categories} empty="Noch keine Daten." />
      </div>

      {/* Die Content-Lücken stehen jetzt oben bei „Was fehlt und was ist zu schwach?" —
          sie sind laut docs/34 §I das wertvollste Produkt-Signal und standen ausgerechnet
          ganz unten am Seitenende. Hier bleiben die Zahlen, die die Lücken einordnen. */}
      <div className="grid gap-4 md:grid-cols-2">
        <BarList title="Regionen" subtitle="wonach gefragt wird" items={insights.regions} empty="Noch keine Daten." />
        <BarList title="Sprache der Anfragen" items={insights.locales} empty="Noch keine Daten." />
      </div>
    </div>
  );
}
