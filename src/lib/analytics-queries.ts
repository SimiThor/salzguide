// Admin-Auswertung der Analytics v3 (docs/34 §H). Rein aggregiert, admin-geprüft,
// mit Zeitraum (Presets + Custom von–bis) und Filtern (Sprache/Land/Gerät/Quelle/Kampagne).
import { getAdminUserId } from "./admin-guard";
import { createServiceClient } from "./supabase/service";
import {
  bucketRange,
  dayCount,
  shiftDay,
  viennaDay,
  viennaDayEnd,
  viennaDayStart,
  type Bucket,
} from "./vienna-day";
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

/**
 * Welche Kacheln der gesetzte Filter überhaupt beantworten KANN.
 *
 * Der Grund steckt in den Daten und nicht in der Abfrage: Quelle und Kampagne entstehen aus
 * der Einstiegs-URL und hängen deshalb nur an Seitenaufrufen. Eine Merkung, eine KI-Frage
 * oder ein Kauf trägt sie nicht — beim Kauf gibt es nicht einmal einen Browser, der Webhook
 * kommt von Stripe. Filtert man trotzdem, liefert die Datenbank pflichtgemäss 0.
 *
 * Und genau diese 0 stand bis 07/2026 im Dashboard: „Quelle: Suche" gewählt, und die Kachel
 * Merkungen fiel auf null. Das liest sich als Ergebnis („aus der Suche merkt sich niemand
 * etwas") und ist doch nur ein fehlendes Feld. Eine Kennzahl, die nicht beantwortbar ist,
 * gehört als solche gezeigt, nicht als Null.
 */
export type Answerable = {
  saves: boolean;
  aiQueries: boolean;
  eventLinks: boolean;
  conversions: boolean;
  /** Kurzer Grund für die Anzeige, oder null wenn alles beantwortbar ist. */
  note: string | null;
};

export type AnalyticsDashboard = {
  from: string;
  to: string;
  bucket: Bucket;
  answerable: Answerable;
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

function pickBucket(days: number): Bucket {
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  return "month";
}

/** Ein gültiger Kalendertag „YYYY-MM-DD"? Alles andere wird verworfen statt geraten. */
function validDay(v: string | null | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v ? null : v;
}

/**
 * Der ausgewertete Zeitraum, in Wiener Kalendertagen gedacht und in Zeitpunkten übergeben.
 *
 * Zwei Dinge sind hier bewusst so und nicht anders:
 *
 * 1. DIE GRENZEN SIND WIENER MITTERNACHT, nicht UTC-Mitternacht. Warum das ein Fehler war
 *    und keine Ungenauigkeit, steht in lib/vienna-day.ts.
 *
 * 2. DAS PRESET RASTET AUF DEN BALKEN EIN. „30 Tage" hiess bisher „die letzten 30 mal 24
 *    Stunden" — bei Wochenbalken fing die Auswertung dann mitten in einer Woche an, und der
 *    erste Balken zeigte drei Tage statt sieben. Das sieht aus wie ein Einbruch und ist
 *    keiner. Jetzt beginnt der Zeitraum am Anfang seines ersten Balkens, und das Dashboard
 *    schreibt dieses Datum hin — die Zahl gilt für den Zeitraum, der danebensteht.
 *
 *    Beim selbst gewählten Zeitraum wird NICHT eingerastet: Wer den 5. bis 20. eingibt, will
 *    den 5. bis 20. sehen und nicht den 1. bis 26.
 */
function resolveRange(q: AnalyticsQuery, now: Date) {
  const customFrom = validDay(q.from);
  const customTo = validDay(q.to);
  const today = viennaDay(now);

  if (customFrom && customTo) {
    // Verdrehte Eingaben stillschweigend richtigstellen statt einen leeren Bericht zeigen.
    const [fromDay, toDay] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    return { fromDay, toDay, bucket: pickBucket(dayCount(fromDay, toDay)) };
  }

  const days = PRESET_DAYS[q.range ?? "30d"] ?? 30;
  const bucket = pickBucket(days);
  // „Heute" zählt mit, deshalb days - 1 zurück (30 Tage = heute und die 29 davor).
  const rawFrom = shiftDay(today, -(days - 1));
  return { fromDay: bucketRange(rawFrom, today, bucket)[0] ?? rawFrom, toDay: today, bucket };
}

export async function getAnalyticsData(q: AnalyticsQuery = {}): Promise<AnalyticsDashboard | null> {
  const adminId = await getAdminUserId();
  if (!adminId) return null;

  const svc = createServiceClient();
  const now = new Date();

  const { fromDay, toDay, bucket } = resolveRange(q, now);
  const fromIso = viennaDayStart(fromDay).toISOString();
  // Ausschliessende Obergrenze: Alle RPCs vergleichen mit `created_at < p_to`. Deshalb
  // Mitternacht des FOLGETAGS und nicht 23:59:59.999 — sonst fehlt die letzte Sekunde.
  const toIso = viennaDayEnd(toDay).toISOString();

  const f = q.filters ?? {};
  // Quelle/Kampagne hängen nur an Seitenaufrufen, die Conversion kennt nur die Sprache —
  // siehe Kommentar am Typ `Answerable`. Beides hier EINMAL entschieden, damit Kachel,
  // Liste und KI-Auswertung nicht auseinanderlaufen.
  const trafficOnly = Boolean(f.source || f.campaign);
  const contextOnly = Boolean(f.country || f.device);
  const answerable: Answerable = {
    saves: !trafficOnly,
    aiQueries: !trafficOnly,
    eventLinks: !trafficOnly,
    conversions: !trafficOnly && !contextOnly,
    note: trafficOnly
      ? "Quelle und Kampagne stehen nur an Seitenaufrufen — Merkungen, KI-Anfragen und Käufe lassen sich damit nicht filtern."
      : contextOnly
        ? "Ein Kauf kommt über Stripe herein, ohne Gerät und ohne Land — nur die Sprache reist mit."
        : null,
  };

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

  // Zeitreihe LÜCKENLOS machen. Die Datenbank liefert nur Balken, in denen etwas passiert
  // ist — ein Tag ohne einen einzigen Aufruf hat schlicht keine Zeile. Das Diagramm malte
  // aber je Zeile einen gleich breiten Balken über die volle Breite: Neun aktive Tage in
  // einem 30-Tage-Zeitraum sahen aus wie neun durchgehende Tage, beschriftet mit dem
  // Anfangs- und dem Enddatum des Zeitraums. Die Kurve war damit frei erfunden, obwohl
  // jede einzelne Zahl darin stimmte.
  const counted = new Map(
    ((tsRes.data ?? []) as { bucket: string; pageviews: number; visitors: number }[]).map((r) => [
      String(r.bucket).slice(0, 10),
      { pageviews: num(r.pageviews), visitors: num(r.visitors) },
    ]),
  );
  const timeseries: TimePoint[] = bucketRange(fromDay, toDay, bucket).map((b) => ({
    bucket: b,
    pageviews: counted.get(b)?.pageviews ?? 0,
    visitors: counted.get(b)?.visitors ?? 0,
  }));

  return {
    from: fromDay,
    to: toDay,
    bucket,
    answerable,
    overview,
    timeseries,
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
