-- Anonyme KI-Chatbot-Auswertung (docs/34 §I). Datenschutz by design:
-- Aus jeder Chat-Anfrage werden NUR geschlossene Codes abgeleitet und hier
-- gespeichert — KEIN Rohtext, KEIN Nutzerbezug (user_id/Session/IP), KEINE Uhrzeit
-- (nur der Tag). Damit ist jede Zeile für sich anonym -> außerhalb der DSGVO
-- (Recital 26). Zusätzlich k-Anonymität in den Read-RPCs: Buckets mit weniger als
-- p_min Fällen werden ausgeblendet, damit auch seltene Kombinationen niemanden
-- isolieren. Schreiben/Lesen ausschließlich serverseitig über den Service-Client.

create table if not exists public.ai_insights (
  id            uuid    primary key default gen_random_uuid(), -- v4 (zeitfrei)
  day           date    not null,                              -- nur Tag, keine Uhrzeit
  intent        text    not null,                              -- geschlossene Enums (siehe ai-insights.ts)
  category      text,
  region        text,
  answered      boolean not null default true,                 -- konnte der Bot den Wunsch erfüllen?
  unmet_reason  text,                                          -- nur bei answered=false relevant
  locale        text
);

create index if not exists ai_insights_day_idx      on public.ai_insights (day);
create index if not exists ai_insights_intent_idx   on public.ai_insights (intent);
create index if not exists ai_insights_answered_idx on public.ai_insights (answered);
create index if not exists ai_insights_category_idx on public.ai_insights (category);

alter table public.ai_insights enable row level security;
-- Keine Policies -> nur der Service-Client (service_role, bypasst RLS) kommt ran.

-- ── Überblick (Gesamt + Antwort-Quote) ───────────────────────────────────────
create or replace function public.ai_insights_overview(p_from date, p_to date)
returns table (total bigint, answered_count bigint, unanswered_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint,
         count(*) filter (where answered)::bigint,
         count(*) filter (where not answered)::bigint
  from public.ai_insights
  where day >= p_from and day <= p_to;
$$;

-- ── Breakdown je Dimension mit k-Anonymität (Buckets < p_min ausgeblendet) ────
create or replace function public.ai_insights_breakdown(
  p_column text,
  p_from   date,
  p_to     date,
  p_min    int default 5
)
returns table (label text, cnt bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Whitelist gegen Injection (Spalte kommt in dynamisches SQL).
  if p_column not in ('intent', 'category', 'region', 'locale') then
    raise exception 'invalid column %', p_column;
  end if;
  return query execute format(
    'select coalesce(%I::text, ''(unbekannt)'') as label, count(*)::bigint as cnt
       from public.ai_insights
      where day >= $1 and day <= $2
      group by 1
     having count(*) >= $3
      order by cnt desc',
    p_column
  ) using p_from, p_to, p_min;
end;
$$;

-- ── Content-Lücken: nur unbeantwortete Anfragen, Kategorie × Region × Grund ───
-- Das ist das wertvollste Signal: Was wollten Nutzer, das wir NICHT liefern konnten.
create or replace function public.ai_insights_gaps(
  p_from date,
  p_to   date,
  p_min  int default 5
)
returns table (category text, region text, unmet_reason text, cnt bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(category, '(unbekannt)'),
         coalesce(region, '(unbekannt)'),
         coalesce(unmet_reason, '(unbekannt)'),
         count(*)::bigint
  from public.ai_insights
  where day >= p_from and day <= p_to and not answered
  group by 1, 2, 3
  having count(*) >= p_min
  order by count(*) desc;
$$;

-- Öffentliche Rollen komplett aussperren; nur der Service-Client darf lesen.
revoke all on function public.ai_insights_overview(date, date) from public, anon, authenticated;
revoke all on function public.ai_insights_breakdown(text, date, date, int) from public, anon, authenticated;
revoke all on function public.ai_insights_gaps(date, date, int) from public, anon, authenticated;
grant execute on function public.ai_insights_overview(date, date) to service_role;
grant execute on function public.ai_insights_breakdown(text, date, date, int) to service_role;
grant execute on function public.ai_insights_gaps(date, date, int) to service_role;
