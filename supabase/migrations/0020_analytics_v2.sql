-- Analytics v2/v3 (docs/34 §H): entscheidungsrelevante, datenschutzkonforme Auswertung.
-- Erweitert die Roh-Events um Kategorie-Snapshot, UTM-Kampagne & Land; ergänzt
-- Session-/Bounce-/Verweildauer-Rekonstruktion (cookieless), Engagement-/Kategorie-/
-- Kampagnen-Aggregation UND Filter (Sprache/Land/Gerät/Quelle/Kampagne). Nur Aggregate.

-- ── Schema erweitern ─────────────────────────────────────────────────────────
alter table public.analytics_events add column if not exists category     text;
alter table public.analytics_events add column if not exists utm_source    text;
alter table public.analytics_events add column if not exists utm_medium    text;
alter table public.analytics_events add column if not exists utm_campaign  text;
alter table public.analytics_events add column if not exists country       text;

create index if not exists analytics_events_type_kind_target_idx on public.analytics_events (type, kind, target);
create index if not exists analytics_events_category_idx on public.analytics_events (type, category);
create index if not exists analytics_events_campaign_idx on public.analytics_events (utm_campaign) where utm_campaign is not null;
create index if not exists analytics_events_visitor_idx on public.analytics_events (visitor_hash, created_at) where type = 'pageview';

-- ── Alte 0019-RPCs mit geänderter Signatur ersetzen ─────────────────────────
drop function if exists public.analytics_counts(timestamptz, timestamptz);
drop function if exists public.analytics_timeseries(timestamptz, timestamptz);
drop function if exists public.analytics_top(text, timestamptz, timestamptz, int);

-- Hinweis: Filter sind optionale Parameter (null = kein Filter). Über
-- (p_x is null or col = p_x) -> ein RPC bedient gefiltert UND ungefiltert.

-- ── Overview inkl. Sessions/Bounce/Verweildauer ─────────────────────────────
create or replace function public.analytics_overview(
  p_from timestamptz, p_to timestamptz,
  p_locale text default null, p_country text default null, p_device text default null,
  p_source text default null, p_campaign text default null
)
returns table(
  pageviews bigint, visitors bigint, sessions bigint, bounces bigint,
  duration_sum bigint, saves bigint, ai_queries bigint, conversions bigint, event_links bigint
)
language sql stable as $$
  with ev as (
    select * from public.analytics_events
    where created_at >= p_from and created_at < p_to
      and (p_locale   is null or locale = p_locale)
      and (p_country  is null or country = p_country)
      and (p_device   is null or device = p_device)
      and (p_source   is null or source = p_source)
      and (p_campaign is null or utm_campaign = p_campaign)
  ),
  pv as (
    select visitor_hash, created_at, (created_at at time zone 'Europe/Vienna')::date as vday
    from ev where type = 'pageview' and visitor_hash is not null
  ),
  marked as (
    select *, case when lag(created_at) over w is null
      or created_at - lag(created_at) over w > interval '30 minutes' then 1 else 0 end as new_sess
    from pv window w as (partition by visitor_hash, vday order by created_at)
  ),
  sess as (
    select visitor_hash, vday, created_at,
      sum(new_sess) over (partition by visitor_hash, vday order by created_at) as sno
    from marked
  ),
  sagg as (
    select count(*) as pv_count,
      extract(epoch from (max(created_at) - min(created_at)))::bigint as dur
    from sess group by visitor_hash, vday, sno
  )
  select
    (select count(*) from ev where type = 'pageview')::bigint,
    (select count(distinct (visitor_hash, vday)) from pv)::bigint,
    (select count(*) from sagg)::bigint,
    (select count(*) from sagg where pv_count = 1)::bigint,
    (select coalesce(sum(dur), 0) from sagg)::bigint,
    (select count(*) from ev where type in ('spot_save', 'event_save'))::bigint,
    (select count(*) from ev where type = 'ai_query')::bigint,
    (select count(*) from ev where type = 'conversion')::bigint,
    (select count(*) from ev where type = 'event_link')::bigint;
$$;

-- ── Zeitreihe mit Bucket (day/week/month) + Filter ──────────────────────────
create or replace function public.analytics_timeseries(
  p_from timestamptz, p_to timestamptz, p_bucket text,
  p_locale text default null, p_country text default null, p_device text default null,
  p_source text default null, p_campaign text default null
)
returns table(bucket date, pageviews bigint, visitors bigint)
language plpgsql stable as $$
begin
  if p_bucket not in ('day', 'week', 'month') then p_bucket := 'day'; end if;
  return query execute format($q$
    select date_trunc(%L, created_at at time zone 'Europe/Vienna')::date as bucket,
      count(*) filter (where type='pageview')::bigint,
      count(distinct visitor_hash) filter (where type='pageview')::bigint
    from public.analytics_events
    where created_at >= $1 and created_at < $2
      and ($4 is null or locale = $4) and ($5 is null or country = $5)
      and ($6 is null or device = $6) and ($7 is null or source = $7)
      and ($8 is null or utm_campaign = $8)
    group by 1 order by 1
  $q$, p_bucket) using p_from, p_to, p_bucket, p_locale, p_country, p_device, p_source, p_campaign;
end $$;

-- ── Top-Entities nach Views ODER Merkungen + Filter ─────────────────────────
create or replace function public.analytics_top(
  p_kind text, p_metric text, p_from timestamptz, p_to timestamptz, p_limit int,
  p_locale text default null, p_country text default null, p_device text default null,
  p_source text default null, p_campaign text default null
)
returns table(target text, cnt bigint)
language sql stable as $$
  select target, count(*)::bigint
  from public.analytics_events
  where created_at >= p_from and created_at < p_to and target is not null
    and ((p_metric = 'view' and type = 'pageview' and kind = p_kind)
      or (p_metric = 'save' and type = p_kind || '_save'))
    and (p_locale is null or locale = p_locale) and (p_country is null or country = p_country)
    and (p_device is null or device = p_device) and (p_source is null or source = p_source)
    and (p_campaign is null or utm_campaign = p_campaign)
  group by target order by 2 desc limit p_limit;
$$;

-- ── Kategorie-Beliebtheit nach View/Save + Filter ───────────────────────────
create or replace function public.analytics_category(
  p_entity text, p_metric text, p_from timestamptz, p_to timestamptz,
  p_locale text default null, p_country text default null, p_device text default null,
  p_source text default null, p_campaign text default null
)
returns table(label text, cnt bigint)
language sql stable as $$
  select category, count(*)::bigint
  from public.analytics_events
  where created_at >= p_from and created_at < p_to and category is not null
    and ((p_metric = 'view' and type = 'pageview' and kind = p_entity)
      or (p_metric = 'save' and type = p_entity || '_save'))
    and (p_locale is null or locale = p_locale) and (p_country is null or country = p_country)
    and (p_device is null or device = p_device) and (p_source is null or source = p_source)
    and (p_campaign is null or utm_campaign = p_campaign)
  group by category order by 2 desc limit 12;
$$;

-- ── Breakdown nach whitelisteter Spalte + Filter ────────────────────────────
create or replace function public.analytics_breakdown(
  p_column text, p_from timestamptz, p_to timestamptz, p_limit int,
  p_locale text default null, p_country text default null, p_device text default null,
  p_source text default null, p_campaign text default null
)
returns table(label text, cnt bigint)
language plpgsql stable as $$
begin
  if p_column not in ('source', 'device', 'locale', 'country', 'utm_source', 'utm_campaign') then
    raise exception 'invalid column';
  end if;
  return query execute format(
    'select coalesce(%I, ''(unbekannt)'') as label, count(*)::bigint as cnt
       from public.analytics_events
      where created_at >= $1 and created_at < $2 and type = ''pageview''
        and ($5 is null or locale = $5) and ($6 is null or country = $6)
        and ($7 is null or device = $7) and ($8 is null or source = $8)
        and ($9 is null or utm_campaign = $9)
      group by 1 order by 2 desc limit $3',
    p_column
  ) using p_from, p_to, p_limit, p_column, p_locale, p_country, p_device, p_source, p_campaign;
end $$;

-- ── Kampagnen-Performance (Ad-Qualität) + Filter (locale/country/device) ────
create or replace function public.analytics_campaigns(
  p_from timestamptz, p_to timestamptz,
  p_locale text default null, p_country text default null, p_device text default null
)
returns table(campaign text, sessions bigint, pageviews bigint, avg_pages numeric, bounce_rate numeric)
language sql stable as $$
  with pv as (
    select visitor_hash, created_at, utm_campaign,
      (created_at at time zone 'Europe/Vienna')::date as vday
    from public.analytics_events
    where type = 'pageview' and visitor_hash is not null
      and created_at >= p_from and created_at < p_to
      and (p_locale is null or locale = p_locale)
      and (p_country is null or country = p_country)
      and (p_device is null or device = p_device)
  ),
  marked as (
    select *, case when lag(created_at) over w is null
      or created_at - lag(created_at) over w > interval '30 minutes' then 1 else 0 end as new_sess
    from pv window w as (partition by visitor_hash, vday order by created_at)
  ),
  sess as (
    select *, sum(new_sess) over (partition by visitor_hash, vday order by created_at) as sno from marked
  ),
  sagg as (
    select count(*) as pv_count,
      (array_agg(utm_campaign order by created_at) filter (where utm_campaign is not null))[1] as entry_campaign
    from sess group by visitor_hash, vday, sno
  )
  select entry_campaign, count(*)::bigint, sum(pv_count)::bigint,
    round(avg(pv_count), 1), round(100.0 * count(*) filter (where pv_count = 1) / count(*), 1)
  from sagg where entry_campaign is not null
  group by entry_campaign order by 2 desc limit 20;
$$;

-- ── Zugriff sperren: nur Service-Client (Dashboard, admin-geprüft) ──────────
revoke all on function public.analytics_overview(timestamptz, timestamptz, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.analytics_timeseries(timestamptz, timestamptz, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.analytics_top(text, text, timestamptz, timestamptz, int, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.analytics_category(text, text, timestamptz, timestamptz, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.analytics_breakdown(text, timestamptz, timestamptz, int, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.analytics_campaigns(timestamptz, timestamptz, text, text, text) from public, anon, authenticated;
