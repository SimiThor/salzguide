// Admin-Auswertung der Analytics v3 (docs/34 §H). Rein aggregiert, admin-geprüft,
// mit Zeitraum (Presets + Custom von–bis) und Filtern (Sprache/Land/Gerät/Quelle/Kampagne).
import { getAdminUserId } from "./admin-guard";
import { createServiceClient } from "./supabase/service";
import { routing } from "@/i18n/routing";

export type RangeKey = "30d" | "3mo" | "6mo" | "12mo";

export type Filters = {
  locale?: string | null;
  country?: string | null;
  device?: string | null;
  source?: string | null;
  campaign?: string | null;
};

export type AnalyticsQuery = {
  range?: RangeKey;
  from?: string | null; // YYYY-MM-DD (Custom-Zeitraum überschreibt range)
  to?: string | null;
  filters?: Filters;
};

const PRESET_DAYS: Record<RangeKey, number> = { "30d": 30, "3mo": 90, "6mo": 180, "12mo": 365 };

export type Overview = {
  pageviews: number;
  visitors: number;
  sessions: number;
  saves: number;
  eventLinks: number;
  aiQueries: number;
  conversions: number;
  bounceRate: number;
  avgDurationSec: number;
  saveRate: number; // Merkungen je 100 Aufrufe
};
export type LabeledValue = { label: string; value: number };
export type TimePoint = { bucket: string; pageviews: number; visitors: number };
export type Campaign = {
  campaign: string;
  sessions: number;
  pageviews: number;
  avgPages: number;
  bounceRate: number;
};

export type AnalyticsDashboard = {
  from: string;
  to: string;
  overview: Overview;
  timeseries: TimePoint[];
  topSpotsSaved: LabeledValue[];
  topSpotsViewed: LabeledValue[];
  topEventsSaved: LabeledValue[];
  spotCategories: LabeledValue[];
  eventCategories: LabeledValue[];
  sources: LabeledValue[];
  campaigns: Campaign[];
  devices: LabeledValue[];
  countries: LabeledValue[];
  locales: LabeledValue[];
  options: { countries: string[]; campaigns: string[] };
};

type Svc = ReturnType<typeof createServiceClient>;
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

async function labeled(svc: Svc, fn: string, args: Record<string, unknown>): Promise<LabeledValue[]> {
  const { data } = await svc.rpc(fn, args);
  return ((data ?? []) as { label: string; cnt: number }[]).map((r) => ({
    label: r.label,
    value: num(r.cnt),
  }));
}

async function spotTitles(svc: Svc, slugs: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!slugs.length) return map;
  const { data } = await svc
    .from("spots")
    .select("slug, spot_translations(title, lang)")
    .in("slug", slugs)
    .eq("spot_translations.lang", "de");
  for (const s of (data ?? []) as {
    slug: string;
    spot_translations: { title: string }[] | { title: string } | null;
  }[]) {
    const tr = Array.isArray(s.spot_translations) ? s.spot_translations[0] : s.spot_translations;
    if (tr?.title) map.set(s.slug, tr.title);
  }
  return map;
}

async function eventTitles(svc: Svc, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data } = await svc.from("events").select("id, title").in("id", ids);
  for (const e of (data ?? []) as { id: string; title: string }[]) map.set(e.id, e.title);
  return map;
}

function pickBucket(days: number): "day" | "week" | "month" {
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  return "month";
}

export async function getAnalyticsData(q: AnalyticsQuery = {}): Promise<AnalyticsDashboard | null> {
  const adminId = await getAdminUserId();
  if (!adminId) return null;

  const svc = createServiceClient();
  const now = new Date();

  // Zeitraum: Custom (von–bis) hat Vorrang, sonst Preset.
  let fromIso: string;
  let toIso: string;
  let spanDays: number;
  if (q.from && q.to) {
    fromIso = `${q.from}T00:00:00.000Z`;
    toIso = `${q.to}T23:59:59.999Z`;
    spanDays = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000));
  } else {
    const days = PRESET_DAYS[q.range ?? "30d"] ?? 30;
    toIso = now.toISOString();
    fromIso = new Date(now.getTime() - days * 86_400_000).toISOString();
    spanDays = days;
  }
  const bucket = pickBucket(spanDays);

  const f = q.filters ?? {};
  // Filter-Parameter (null = kein Filter) für alle RPCs.
  const F = {
    p_locale: f.locale || null,
    p_country: f.country || null,
    p_device: f.device || null,
    p_source: f.source || null,
    p_campaign: f.campaign || null,
  };
  const Frange = { p_from: fromIso, p_to: toIso };

  const [
    ov, tsRes, spotSaveRes, spotViewRes, eventSaveRes, spotCat, eventCat,
    sources, devices, countries, locales, campRes,
    optCountries, optCampaigns,
  ] = await Promise.all([
    svc.rpc("analytics_overview", { ...Frange, ...F }),
    svc.rpc("analytics_timeseries", { ...Frange, p_bucket: bucket, ...F }),
    svc.rpc("analytics_top", { p_kind: "spot", p_metric: "save", ...Frange, p_limit: 8, ...F }),
    svc.rpc("analytics_top", { p_kind: "spot", p_metric: "view", ...Frange, p_limit: 8, ...F }),
    svc.rpc("analytics_top", { p_kind: "event", p_metric: "save", ...Frange, p_limit: 8, ...F }),
    labeled(svc, "analytics_category", { p_entity: "spot", p_metric: "view", ...Frange, ...F }),
    labeled(svc, "analytics_category", { p_entity: "event", p_metric: "save", ...Frange, ...F }),
    labeled(svc, "analytics_breakdown", { p_column: "source", ...Frange, p_limit: 8, ...F }),
    labeled(svc, "analytics_breakdown", { p_column: "device", ...Frange, p_limit: 8, ...F }),
    labeled(svc, "analytics_breakdown", { p_column: "country", ...Frange, p_limit: 12, ...F }),
    // Alle Sprachen abdecken (nicht auf 8 begrenzen) -> wächst mit neuen Locales mit.
    labeled(svc, "analytics_breakdown", {
      p_column: "locale",
      ...Frange,
      p_limit: Math.max(20, routing.locales.length),
      ...F,
    }),
    svc.rpc("analytics_campaigns", {
      ...Frange, p_locale: F.p_locale, p_country: F.p_country, p_device: F.p_device,
    }),
    // Filter-Optionen (ungefiltert, damit die Dropdowns alle Werte zeigen). Die
    // Filter-Keys explizit auf null -> eindeutiger Match der 9-Arg-RPC (kein Overload-Konflikt).
    labeled(svc, "analytics_breakdown", {
      p_column: "country", ...Frange, p_limit: 50,
      p_locale: null, p_country: null, p_device: null, p_source: null, p_campaign: null,
    }),
    svc.rpc("analytics_campaigns", Frange),
  ]);

  const o = (ov.data?.[0] ?? {}) as Record<string, unknown>;
  const sessions = num(o.sessions);
  const pageviews = num(o.pageviews);
  const saves = num(o.saves);
  const overview: Overview = {
    pageviews,
    visitors: num(o.visitors),
    sessions,
    saves,
    eventLinks: num(o.event_links),
    aiQueries: num(o.ai_queries),
    conversions: num(o.conversions),
    bounceRate: sessions ? Math.round((num(o.bounces) / sessions) * 100) : 0,
    avgDurationSec: sessions ? Math.round(num(o.duration_sum) / sessions) : 0,
    saveRate: pageviews ? Math.round((saves / pageviews) * 1000) / 10 : 0,
  };

  const spotSaveRows = (spotSaveRes.data ?? []) as { target: string; cnt: number }[];
  const spotViewRows = (spotViewRes.data ?? []) as { target: string; cnt: number }[];
  const eventRows = (eventSaveRes.data ?? []) as { target: string; cnt: number }[];
  const [sTitles, eTitles] = await Promise.all([
    spotTitles(svc, [...spotSaveRows, ...spotViewRows].map((r) => r.target)),
    eventTitles(svc, eventRows.map((r) => r.target)),
  ]);

  const mapCampaigns = (rows: unknown): Campaign[] =>
    ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
      campaign: String(r.campaign),
      sessions: num(r.sessions),
      pageviews: num(r.pageviews),
      avgPages: num(r.avg_pages),
      bounceRate: num(r.bounce_rate),
    }));

  return {
    from: fromIso.slice(0, 10),
    to: toIso.slice(0, 10),
    overview,
    timeseries: ((tsRes.data ?? []) as { bucket: string; pageviews: number; visitors: number }[]).map(
      (r) => ({ bucket: r.bucket, pageviews: num(r.pageviews), visitors: num(r.visitors) }),
    ),
    topSpotsSaved: spotSaveRows.map((r) => ({ label: sTitles.get(r.target) ?? r.target, value: num(r.cnt) })),
    topSpotsViewed: spotViewRows.map((r) => ({ label: sTitles.get(r.target) ?? r.target, value: num(r.cnt) })),
    topEventsSaved: eventRows.map((r) => ({ label: eTitles.get(r.target) ?? "Event", value: num(r.cnt) })),
    spotCategories: spotCat,
    eventCategories: eventCat,
    sources,
    campaigns: mapCampaigns(campRes.data),
    devices,
    countries,
    locales,
    options: {
      countries: optCountries.map((c) => c.label).filter((l) => l !== "(unbekannt)"),
      campaigns: mapCampaigns(optCampaigns.data).map((c) => c.campaign),
    },
  };
}
