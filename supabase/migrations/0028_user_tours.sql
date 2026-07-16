-- 0028: Gespeicherte User-Runden (Konzept-Update Anton 2026-07-09).
-- Jede vom Nutzer im KI-Builder erzeugte Runde bekommt einen coolen KI-Namen und kann
-- GESPEICHERT werden: so findet der User sie unter „Audio Guide" wieder UND es entstehen
-- beim erneuten Ansehen KEINE API-Kosten (Claude/Mapbox laufen nur einmal beim Bauen).
-- Persistiert wird nur der SNAPSHOT: geordnete Pool-Punkt-IDs + fertige Geh-Route +
-- Meta. Titel/Audio werden beim Ansehen frisch aus tour_points/tour_point_audio geladen,
-- neu gegatet (Pro kann sich ändern) und signiert. Reine Nutzerdaten -> RLS: nur Owner.

create table if not exists public.user_tours (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  area_id      uuid references public.tour_areas (id) on delete set null,
  name         text not null,                     -- cooler KI-Name (Zielgruppen-Stil)
  emoji        text,
  interests    text[] not null default '{}',      -- gewählte Interessen (Anzeige)
  point_ids    uuid[] not null,                   -- GEORDNETE Auswahl (die Runde selbst)
  route_geo    jsonb,                             -- [lng,lat][] Loop-Geometrie (gecacht)
  start_lat    double precision,
  start_lng    double precision,
  distance_km  numeric,
  duration_min integer,
  created_at   timestamptz not null default now()
);
create index if not exists user_tours_user_idx
  on public.user_tours (user_id, created_at desc);

-- ── Row Level Security: strikt nur der Eigentümer ────────────────────────────
alter table public.user_tours enable row level security;

drop policy if exists "user_tours_select_own" on public.user_tours;
create policy "user_tours_select_own" on public.user_tours
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "user_tours_insert_own" on public.user_tours;
create policy "user_tours_insert_own" on public.user_tours
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "user_tours_delete_own" on public.user_tours;
create policy "user_tours_delete_own" on public.user_tours
  for delete to authenticated using (auth.uid() = user_id);
