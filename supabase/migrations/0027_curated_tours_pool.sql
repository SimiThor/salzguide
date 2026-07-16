-- 0027: Kuratierte Touren aufs POOL-Modell umstellen.
-- Eine kuratierte „Local-Runde" gehört zu einem GEBIET und besteht aus geordneten
-- POOL-PUNKTEN (tour_points) statt Explore-Spots. tour_stops wird von spot_id auf
-- point_id umgestellt (war leer -> unkritisch neu aufgesetzt). Audio kommt jetzt aus
-- tour_point_audio (0026), nicht mehr aus spot_audio.

alter table public.tours
  add column if not exists area_id uuid references public.tour_areas (id) on delete set null;

-- tour_stops neu: point_id statt spot_id.
drop table if exists public.tour_stops cascade;
create table public.tour_stops (
  id         uuid primary key default gen_random_uuid(),
  tour_id    uuid not null references public.tours (id) on delete cascade,
  point_id   uuid not null references public.tour_points (id) on delete cascade,
  sort_order integer not null default 0,
  unique (tour_id, point_id)
);
create index if not exists tour_stops_tour_idx on public.tour_stops (tour_id, sort_order);

alter table public.tour_stops enable row level security;

-- Öffentlich lesbar nur, wenn Tour published UND der Punkt (+ dessen Gebiet) published.
drop policy if exists "tour_stops_public_read" on public.tour_stops;
create policy "tour_stops_public_read" on public.tour_stops
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.tours t
      where t.id = tour_stops.tour_id and t.status = 'published'
    )
    and exists (
      select 1 from public.tour_points p
      join public.tour_areas a on a.id = p.area_id
      where p.id = tour_stops.point_id
        and p.status = 'published' and a.status = 'published'
    )
  );

drop policy if exists "tour_stops_admin_all" on public.tour_stops;
create policy "tour_stops_admin_all" on public.tour_stops
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
