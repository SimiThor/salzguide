import { setRequestLocale } from "next-intl/server";
import AdminNav from "@/components/admin/AdminNav";
import AnalyticsFilters from "@/components/admin/AnalyticsFilters";
import AdLinkBuilder from "@/components/admin/AdLinkBuilder";
import AiInsights from "@/components/admin/AiInsights";
import AiInsightsSummary from "@/components/admin/AiInsightsSummary";
import {
  getAnalyticsData,
  type AnalyticsDashboard,
  type AnalyticsQuery,
  type Campaign,
  type LabeledValue,
  type RangeKey,
  type TimePoint,
} from "@/lib/analytics-queries";
import { getAiInsights, type AiInsightsData } from "@/lib/ai-insights";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";

// Analytics v3 (docs/34 §H) — cookieless, nur Aggregate, mit Filtern, Ad-Link-Builder
// und KI-Auswertung. Ohne echte Daten: klar gekennzeichnete Beispieldaten-Vorschau.
export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = { direct: "Direkt", search: "Suche", social: "Social Media" };
const DEVICE_LABELS: Record<string, string> = { mobile: "Mobil", desktop: "Desktop", tablet: "Tablet", other: "Sonstige" };
// Alle Sprachen aus der zentralen Config (Endonym) -> neue Sprache erscheint automatisch.
const LOCALE_LABELS: Record<string, string> = Object.fromEntries(
  routing.locales.map((l) => [l, localeMeta(l).name]),
);
const EVENT_CAT_LABELS: Record<string, string> = { party: "Party", tradition: "Tradition", kultur: "Kultur", sport: "Sport", kids: "Kids" };

const fmtDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} min`;

function StatCard({ label, value, display, sub }: { label: string; value?: number; display?: string; sub?: string }) {
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <p className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-[22px] font-bold leading-none text-ink">
        {display ?? (value ?? 0).toLocaleString("de-AT")}
      </p>
      {sub && <p className="mt-1 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

function BarList({ title, subtitle, items, labelMap, empty }: {
  title: string; subtitle?: string; items: LabeledValue[];
  labelMap?: Record<string, string>; empty: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {subtitle && <p className="text-[11px] text-muted">{subtitle}</p>}
      {items.length === 0 ? (
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

function TimeBars({ points }: { points: TimePoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.pageviews));
  return (
    <div className="rounded-[16px] bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
      <h2 className="text-[15px] font-semibold text-ink">Seitenaufrufe im Zeitverlauf</h2>
      <div className="mt-3 flex h-28 items-end gap-[3px]">
        {points.map((p) => (
          <div key={p.bucket} title={`${p.bucket}: ${p.pageviews} Aufrufe · ${p.visitors} Besucher`}
            className="flex-1 rounded-t bg-accent/80"
            style={{ height: `${Math.max(2, Math.round((p.pageviews / max) * 100))}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        <span>{points[0]?.bucket.slice(5)}</span>
        <span>{points[points.length - 1]?.bucket.slice(5)}</span>
      </div>
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
                  <td className="py-1.5 text-right text-muted">{c.avgPages}</td>
                  <td className="py-1.5 text-right text-muted">{c.bounceRate}%</td>
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
function demoDashboard(spanDays: number): AnalyticsDashboard {
  const factor = spanDays <= 31 ? 1 : spanDays <= 92 ? 2.7 : spanDays <= 185 ? 4.9 : 8.6;
  const nBuckets = spanDays <= 45 ? Math.min(spanDays, 30) : spanDays <= 200 ? Math.round(spanDays / 7) : 12;
  const stepDays = spanDays <= 45 ? 1 : spanDays <= 200 ? 7 : 30;
  const now = Date.now();
  const scale = (n: number) => Math.round(n * factor);
  const timeseries: TimePoint[] = Array.from({ length: nBuckets }, (_, i) => {
    const d = new Date(now - (nBuckets - 1 - i) * stepDays * 86_400_000);
    const bucket = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(d);
    const pv = Math.round((150 + Math.sin(i / 2.5) * 28 + (i % 7 > 4 ? 60 : 0)) * stepDays * 0.9);
    return { bucket, pageviews: pv, visitors: Math.round(pv * 0.62) };
  });
  const to = new Date(now);
  const from = new Date(now - spanDays * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    overview: {
      pageviews: scale(5130), visitors: scale(2840), sessions: scale(3260), saves: scale(312),
      eventLinks: scale(148), aiQueries: scale(221), conversions: scale(18),
      bounceRate: 51, avgDurationSec: 96, saveRate: 6.1,
    },
    timeseries,
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
        Wünsche, die der Chatbot NICHT erfüllen konnte — was wir aufnehmen/ergänzen sollten.
      </p>
      {gaps.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">
          Keine Lücken über der Sichtbarkeitsschwelle (k-Anonymität) — oder noch zu wenige Anfragen.
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
  const spanDays =
    sp.from && sp.to
      ? Math.max(1, Math.round((Date.parse(`${sp.to}T00:00Z`) - Date.parse(`${sp.from}T00:00Z`)) / 86_400_000))
      : { "30d": 30, "3mo": 90, "6mo": 180, "12mo": 365 }[range];
  const data = isDemo ? demoDashboard(spanDays) : real;
  const o = data.overview;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://salzguide.com";

  // KI-Insights (anonyme Chatbot-Nachfrage). Gleicher Demo-Modus wie oben.
  const insightsQuery = { range, from: query.from, to: query.to };
  const realInsights = await getAiInsights(insightsQuery);
  const insights =
    isDemo || !realInsights ? demoInsights(spanDays, data.from, data.to) : realInsights;

  return (
    <div className="space-y-4 pb-12">
      <AdminNav active="analytics" />
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
          <strong>Vorschau mit Beispieldaten.</strong> So sieht dein Dashboard aus und das wird
          erfasst. Echte Zahlen &amp; die KI-Auswertung erscheinen automatisch, sobald die Seite
          live ist — in der Entwicklung wird bewusst nicht getrackt (Datenschutz).
        </div>
      )}

      {!isDemo && <AiInsights query={query} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Seitenaufrufe" value={o.pageviews} />
        <StatCard label="Besuche" value={o.sessions} sub="Sessions" />
        <StatCard label="Besucher" value={o.visitors} sub="eindeutig / Tag" />
        <StatCard label="Bounce-Rate" display={`${o.bounceRate}%`} />
        <StatCard label="Ø Verweildauer" display={fmtDuration(o.avgDurationSec)} />
        <StatCard label="Merkungen" value={o.saves} sub={`Merkrate ${o.saveRate}/100`} />
        <StatCard label="KI-Anfragen" value={o.aiQueries} sub={`Event-Klicks: ${o.eventLinks}`} />
        <StatCard label="Conversions" value={o.conversions} sub="Free → Pro" />
      </div>

      <TimeBars points={data.timeseries} />

      <div className="grid gap-4 md:grid-cols-2">
        <BarList title="Top-Spots" subtitle="nach Merkungen" items={data.topSpotsSaved} empty="Noch keine gemerkten Spots." />
        <BarList title="Top-Spots" subtitle="nach Aufrufen" items={data.topSpotsViewed} empty="Noch keine Aufrufe." />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarList title="Top-Events" subtitle="nach Merkungen" items={data.topEventsSaved} empty="Noch keine gemerkten Events." />
        <BarList title="Spot-Kategorien" subtitle="nach Aufrufen" items={data.spotCategories} empty="Keine Daten." />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarList title="Event-Kategorien" subtitle="nach Merkungen" items={data.eventCategories} labelMap={EVENT_CAT_LABELS} empty="Keine Daten." />
        <BarList title="Länder" items={data.countries} empty="Keine Daten." />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CampaignTable campaigns={data.campaigns} />
        <AdLinkBuilder baseUrl={baseUrl} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <BarList title="Quellen" items={data.sources} labelMap={SOURCE_LABELS} empty="Keine Daten." />
        <BarList title="Geräte" items={data.devices} labelMap={DEVICE_LABELS} empty="Keine Daten." />
        <BarList title="Sprache" items={data.locales} labelMap={LOCALE_LABELS} empty="Keine Daten." />
      </div>

      {/* ── KI-Insights: anonyme Auswertung der Chatbot-Nachfrage (docs/34 §I) ── */}
      <div className="mt-2 border-t border-black/[0.06] pt-5">
        <h2 className="text-xl font-bold text-ink">KI-Insights</h2>
        <p className="mt-1 text-[13px] text-muted">
          Anonyme Auswertung der Chatbot-Anfragen · nur feste Codes, kein Text, kein
          Personenbezug · {insights.from} bis {insights.to}
        </p>
      </div>

      {!isDemo && <AiInsightsSummary query={insightsQuery} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="KI-Anfragen" value={insights.total} />
        <StatCard label="Beantwortet" display={`${insights.answerRate}%`} sub={`${insights.answered} von ${insights.total}`} />
        <StatCard label="Offen geblieben" value={insights.unanswered} sub="Content-/Datenlücken" />
        <StatCard label="Sichtbarkeit" display={`k ≥ ${insights.kMin}`} sub="kleinere Gruppen verborgen" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarList title="Was Nutzer wollen" subtitle="Absichten der Anfragen" items={insights.intents} empty="Noch keine Daten." />
        <BarList title="Top-Themen" subtitle="Kategorien der Anfragen" items={insights.categories} empty="Noch keine Daten." />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <GapList gaps={insights.gaps} />
        <BarList title="Regionen" subtitle="wonach gefragt wird" items={insights.regions} empty="Noch keine Daten." />
      </div>

      <BarList title="Sprache der Anfragen" items={insights.locales} empty="Noch keine Daten." />
    </div>
  );
}
