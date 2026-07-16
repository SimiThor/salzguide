-- 0026: Audio-Tour POOL-Modell (Konzept-Update Anton 2026-07-07).
-- Tour-Stops sind NICHT die Explore-Spots, sondern ein eigener POOL aus dedizierten
-- Audio-Punkten je GEBIET. Ein Gebiet hat einen fixen Startpunkt (top mit Bus/Auto
-- erreichbar, z.B. Mirabellplatz) und mehr Punkte, als eine einzelne Tour braucht.
-- Titel/Position sind öffentlich (Teaser); das Audio (Text + MP3) ist bezahlter
-- Pro-Inhalt -> eigene RLS-DICHTE Tabelle, Auslieferung serverseitig via Signed-URLs
-- aus dem privaten tour-audio-Bucket (0025). Enum tour_status stammt aus 0024.

-- ── Gebiete ──────────────────────────────────────────────────────────────────
create table if not exists public.tour_areas (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  status      tour_status not null default 'draft',
  start_lat   double precision,   -- fixer, gut erreichbarer Startpunkt (= Ende der Runde)
  start_lng   double precision,
  emoji       text,
  cover_url   text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tour_areas_status_idx on public.tour_areas (status);

create table if not exists public.tour_area_translations (
  id        uuid primary key default gen_random_uuid(),
  area_id   uuid not null references public.tour_areas (id) on delete cascade,
  lang      text not null,
  name      text not null,
  subtitle  text,
  unique (area_id, lang)
);

-- ── Pool-Punkte ──────────────────────────────────────────────────────────────
create table if not exists public.tour_points (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.tour_areas (id) on delete cascade,
  lat         double precision,
  lng         double precision,
  kind        text,                              -- optionaler Typ (Aussicht, Sage, Café …)
  tags        text[] not null default '{}',      -- Themen für KI-Interessen-Matching
  weight      integer not null default 0,        -- Wichtigkeit / must-see-Ranking
  emoji       text,
  status      tour_status not null default 'draft',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tour_points_area_idx on public.tour_points (area_id);
create index if not exists tour_points_tags_idx on public.tour_points using gin (tags);

create table if not exists public.tour_point_translations (
  id        uuid primary key default gen_random_uuid(),
  point_id  uuid not null references public.tour_points (id) on delete cascade,
  lang      text not null,
  title     text not null,
  unique (point_id, lang)
);

-- Audio = Pro-Asset: Text + MP3-PFAD im privaten tour-audio-Bucket. KEIN Public-Read.
create table if not exists public.tour_point_audio (
  id           uuid primary key default gen_random_uuid(),
  point_id     uuid not null references public.tour_points (id) on delete cascade,
  lang         text not null,
  audio_text   text,
  audio_url    text,          -- OBJEKT-PFAD im privaten Bucket (keine öffentliche URL)
  duration_sec integer,
  updated_at   timestamptz not null default now(),
  unique (point_id, lang)
);

-- ── updated_at-Trigger ───────────────────────────────────────────────────────
drop trigger if exists tour_areas_set_updated_at on public.tour_areas;
create trigger tour_areas_set_updated_at before update on public.tour_areas
  for each row execute function public.set_updated_at();
drop trigger if exists tour_points_set_updated_at on public.tour_points;
create trigger tour_points_set_updated_at before update on public.tour_points
  for each row execute function public.set_updated_at();
drop trigger if exists tour_point_audio_set_updated_at on public.tour_point_audio;
create trigger tour_point_audio_set_updated_at before update on public.tour_point_audio
  for each row execute function public.set_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.tour_areas             enable row level security;
alter table public.tour_area_translations enable row level security;
alter table public.tour_points            enable row level security;
alter table public.tour_point_translations enable row level security;
alter table public.tour_point_audio       enable row level security;

-- Gebiete: öffentlich nur published; Admin alles.
drop policy if exists "tour_areas_public_read" on public.tour_areas;
create policy "tour_areas_public_read" on public.tour_areas
  for select to anon, authenticated using (status = 'published');
drop policy if exists "tour_areas_admin_all" on public.tour_areas;
create policy "tour_areas_admin_all" on public.tour_areas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Gebiets-Übersetzungen: lesbar wenn Gebiet published; Admin alles.
drop policy if exists "tour_area_translations_public_read" on public.tour_area_translations;
create policy "tour_area_translations_public_read" on public.tour_area_translations
  for select to anon, authenticated
  using (exists (
    select 1 from public.tour_areas a
    where a.id = tour_area_translations.area_id and a.status = 'published'
  ));
drop policy if exists "tour_area_translations_admin_all" on public.tour_area_translations;
create policy "tour_area_translations_admin_all" on public.tour_area_translations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Punkte: öffentlich nur wenn Punkt UND Gebiet published; Admin alles.
drop policy if exists "tour_points_public_read" on public.tour_points;
create policy "tour_points_public_read" on public.tour_points
  for select to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1 from public.tour_areas a
      where a.id = tour_points.area_id and a.status = 'published'
    )
  );
drop policy if exists "tour_points_admin_all" on public.tour_points;
create policy "tour_points_admin_all" on public.tour_points
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Punkt-Titel: lesbar wenn Punkt + Gebiet published; Admin alles.
drop policy if exists "tour_point_translations_public_read" on public.tour_point_translations;
create policy "tour_point_translations_public_read" on public.tour_point_translations
  for select to anon, authenticated
  using (exists (
    select 1 from public.tour_points p
    join public.tour_areas a on a.id = p.area_id
    where p.id = tour_point_translations.point_id
      and p.status = 'published' and a.status = 'published'
  ));
drop policy if exists "tour_point_translations_admin_all" on public.tour_point_translations;
create policy "tour_point_translations_admin_all" on public.tour_point_translations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Punkt-Audio: KEIN Public-Read (Pro-Asset) -> nur Admin; App liefert via Signed-URL.
drop policy if exists "tour_point_audio_admin_all" on public.tour_point_audio;
create policy "tour_point_audio_admin_all" on public.tour_point_audio
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
