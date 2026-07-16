-- ============================================================================
-- SalzGuide — Gespeicherte Events (eigene Merkliste, getrennt von Spots)
-- Bewusst eigene Tabelle: Events erscheinen NICHT auf der Gespeichert-Karte und
-- laufen zeitbasiert aus der Liste. Berührt saved_items/saved_lists (Spots) nicht.
-- Ausführen im Supabase SQL-Editor.
-- ============================================================================

create table if not exists public.saved_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create index if not exists saved_events_user_idx on public.saved_events (user_id);

-- RLS: jeder sieht/verwaltet nur seine eigenen gespeicherten Events.
alter table public.saved_events enable row level security;

drop policy if exists "saved_events_own" on public.saved_events;
create policy "saved_events_own" on public.saved_events
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
