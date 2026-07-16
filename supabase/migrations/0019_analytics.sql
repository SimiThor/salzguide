-- Datenschutzkonforme First-Party-Analytics (docs/34 §H). Modell wie Plausible
-- (DSK 2022 akzeptiert): NULL Cookies/Storage am Gerät -> keine TKG-2021-Consent-
-- Pflicht; Unique Visitors über einen TÄGLICH rotierenden, verworfenen Salt-Hash
-- (IP + User-Agent + Tag) -> nach Salt-Löschung unumkehrbar anonym. IP wird NIE
-- gespeichert. Rechtsgrundlage: berechtigtes Interesse (Art. 6(1)(f)), aggregat-only.

-- Roh-Events (nur Aggregate werden ausgewertet).
create table if not exists public.analytics_events (
  id            bigint generated always as identity primary key,
  type          text        not null,          -- 'pageview' | 'save' | 'ai_query'
  kind          text,                           -- 'spot'|'event'|'home'|'events'|'explore'|'water'|'saved'|'profile'|'other'
  target        text,                           -- Slug/ID (bei spot/event), sonst null
  source        text,                           -- 'direct'|'search'|'social'|<referrer-host>
  device        text,                           -- 'mobile'|'desktop'|'tablet'|'other'
  locale        text,                           -- 'de'|'en'
  visitor_hash  text,                           -- täglich gesalzener Hash (kein Klartext-IP)
  created_at    timestamptz not null default now()
);

create index if not exists analytics_events_created_idx on public.analytics_events (created_at);
create index if not exists analytics_events_type_created_idx on public.analytics_events (type, created_at);
create index if not exists analytics_events_kind_target_idx on public.analytics_events (kind, target);

-- Täglicher Salt für den Visitor-Hash. Wird nach 2 Tagen gelöscht (Cron) -> die
-- Hashes sind danach nicht mehr rekonstruierbar (endgültig anonym).
create table if not exists public.analytics_salt (
  day   date primary key,
  salt  text not null
);

alter table public.analytics_events enable row level security;
alter table public.analytics_salt   enable row level security;

-- events: nur Admin liest (Dashboard über Service-Client; diese Policy erlaubt
-- zusätzlich direkte Admin-Reads). Schreiben ausschließlich Service-Client.
drop policy if exists analytics_events_admin_read on public.analytics_events;
create policy analytics_events_admin_read on public.analytics_events
  for select to authenticated using (public.is_admin());
-- analytics_salt: keine Policy -> nur Service-Client.

-- Heutigen Salt holen/anlegen (atomar). SECURITY DEFINER, nur Service ruft es auf.
create or replace function public.analytics_get_salt(p_day date)
returns text
language plpgsql
as $$
declare s text;
begin
  insert into public.analytics_salt (day, salt)
  values (p_day, encode(gen_random_bytes(16), 'hex'))
  on conflict (day) do nothing;
  select salt into s from public.analytics_salt where day = p_day;
  return s;
end;
$$;

-- ── Aggregations-RPCs (SECURITY DEFINER; nur Service-Client) ─────────────────
create or replace function public.analytics_counts(p_from timestamptz, p_to timestamptz)
returns table(pageviews bigint, visitors bigint, saves bigint, ai_queries bigint)
language sql stable as $$
  select
    count(*) filter (where type = 'pageview')::bigint,
    count(distinct visitor_hash) filter (where type = 'pageview')::bigint,
    count(*) filter (where type = 'save')::bigint,
    count(*) filter (where type = 'ai_query')::bigint
  from public.analytics_events
  where created_at >= p_from and created_at < p_to;
$$;

create or replace function public.analytics_timeseries(p_from timestamptz, p_to timestamptz)
returns table(day date, pageviews bigint, visitors bigint)
language sql stable as $$
  select (created_at at time zone 'Europe/Vienna')::date as day,
         count(*) filter (where type = 'pageview')::bigint,
         count(distinct visitor_hash) filter (where type = 'pageview')::bigint
  from public.analytics_events
  where created_at >= p_from and created_at < p_to
  group by 1 order by 1;
$$;

create or replace function public.analytics_top(
  p_kind text, p_from timestamptz, p_to timestamptz, p_limit int
)
returns table(target text, views bigint)
language sql stable as $$
  select target, count(*)::bigint as views
  from public.analytics_events
  where created_at >= p_from and created_at < p_to
    and type = 'pageview' and kind = p_kind and target is not null
  group by target order by views desc limit p_limit;
$$;

-- Breakdown nach einer WHITELISTETEN Spalte (source/device/locale) -> keine Injection.
create or replace function public.analytics_breakdown(
  p_column text, p_from timestamptz, p_to timestamptz, p_limit int
)
returns table(label text, cnt bigint)
language plpgsql stable as $$
begin
  if p_column not in ('source', 'device', 'locale') then
    raise exception 'invalid column';
  end if;
  return query execute format(
    'select coalesce(%I, ''(unbekannt)'') as label, count(*)::bigint as cnt
       from public.analytics_events
      where created_at >= $1 and created_at < $2 and type = ''pageview''
      group by 1 order by 2 desc limit $3',
    p_column
  ) using p_from, p_to, p_limit;
end;
$$;

-- Nur der Service-Client (serverseitig, admin-geprüft) darf die RPCs aufrufen.
revoke all on function public.analytics_get_salt(date) from public, anon, authenticated;
revoke all on function public.analytics_counts(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.analytics_timeseries(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.analytics_top(text, timestamptz, timestamptz, int) from public, anon, authenticated;
revoke all on function public.analytics_breakdown(text, timestamptz, timestamptz, int) from public, anon, authenticated;
