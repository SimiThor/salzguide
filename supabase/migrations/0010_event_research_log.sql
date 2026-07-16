-- ============================================================================
-- SalzGuide — Log der KI-Wochenrecherche (welche Kalenderwoche wurde schon gesucht)
-- Zweck: der Cron recherchiert jede Woche (Mo–So) GENAU EINMAL -> keine
-- Doppel-Suchen, rollt automatisch weiter. Quelle: docs/29 §6.
-- Ausführen im Supabase SQL-Editor.
-- ============================================================================

create table if not exists public.event_research_log (
  week_start    date primary key,               -- Montag der recherchierten Woche (Wiener Zeit)
  researched_at timestamptz not null default now(),
  inserted      integer not null default 0,     -- neu angelegte Draft-Events
  skipped       integer not null default 0      -- als Dublette übersprungen
);

comment on table public.event_research_log is
  'Merkt sich pro Kalenderwoche (Montag), ob/wann die KI-Recherche lief -> keine Doppel-Suchen.';

-- RLS: Schreiben nur per service_role (Cron/Action, umgeht RLS) -> keine Write-Policy.
-- Admin darf lesen (Anzeige „zuletzt recherchiert" im Dashboard).
alter table public.event_research_log enable row level security;

drop policy if exists "event_research_log_admin_read" on public.event_research_log;
create policy "event_research_log_admin_read" on public.event_research_log
  for select to authenticated
  using (public.is_admin());
