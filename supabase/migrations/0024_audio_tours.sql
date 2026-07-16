-- Audio-Tour-Feature (docs/31) — Phase 1: Fundament.
-- Eine Audio-Tour ist eine geordnete Route aus STOPS; ein Stop IST ein bestehender
-- Spot (keine Doppel-Daten). Die gesprochene Narration je Spot & Sprache liegt in
-- einer EIGENEN Tabelle `spot_audio` OHNE Public-Read — Audio ist bezahlter
-- Pro-Inhalt und wird ausschließlich serverseitig mit Teaser/Pro-Gating
-- ausgeliefert (src/lib/tours.ts), analog zum Muster in 0017_pro_content_rls.sql.
-- „Teaser gratis + Pro": Tour-Struktur ist öffentlich sichtbar (der Reiz), aber nur
-- die ersten `free_stops` Stationen sind ohne Pro anspielbar.

-- ----------------------------------------------------------------------------
-- 0. Enum
-- ----------------------------------------------------------------------------
do $$ begin
  create type tour_status as enum ('draft', 'published');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1. Audio je Spot × Sprache (Pro-Asset, RLS-dicht)
-- ----------------------------------------------------------------------------
create table if not exists public.spot_audio (
  id           uuid primary key default gen_random_uuid(),
  spot_id      uuid not null references public.spots (id) on delete cascade,
  lang         text not null,
  audio_url    text,                 -- MP3 in Storage (Bucket spot-media): TTS ODER Upload
  audio_text   text,                 -- Transkript/Skript (Basis für TTS + Anzeige)
  duration_sec integer,              -- optionale Länge für den Player
  updated_at   timestamptz not null default now(),
  unique (spot_id, lang)
);
create index if not exists spot_audio_spot_idx on public.spot_audio (spot_id);

-- ----------------------------------------------------------------------------
-- 2. Touren
-- ----------------------------------------------------------------------------
create table if not exists public.tours (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  region        text not null default 'stadt-salzburg',  -- multi-region-fähig
  status        tour_status not null default 'draft',
  is_pro        boolean not null default true,   -- Tour ist Pro-Inhalt …
  free_stops    integer not null default 1,      -- … aber die ersten N Stops sind gratis (Teaser)
  emoji         text,
  cover_url     text,
  start_spot_id uuid references public.spots (id) on delete set null,
  end_spot_id   uuid references public.spots (id) on delete set null,
  duration_min  integer,                          -- geschätzte Gesamtdauer (optional)
  distance_km   double precision,                 -- optional
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tours_status_idx on public.tours (status);
create index if not exists tours_region_idx on public.tours (region);

-- Übersetzungen je Tour × Sprache
create table if not exists public.tour_translations (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references public.tours (id) on delete cascade,
  lang        text not null,
  title       text not null,
  subtitle    text,
  description text,
  unique (tour_id, lang)
);

-- Stops = geordnete Spots einer Tour
create table if not exists public.tour_stops (
  id         uuid primary key default gen_random_uuid(),
  tour_id    uuid not null references public.tours (id) on delete cascade,
  spot_id    uuid not null references public.spots (id) on delete cascade,
  sort_order integer not null default 0,
  unique (tour_id, spot_id)
);
create index if not exists tour_stops_tour_idx on public.tour_stops (tour_id, sort_order);

-- ----------------------------------------------------------------------------
-- 3. updated_at-Trigger
-- ----------------------------------------------------------------------------
drop trigger if exists tours_set_updated_at on public.tours;
create trigger tours_set_updated_at
  before update on public.tours
  for each row execute function public.set_updated_at();

drop trigger if exists spot_audio_set_updated_at on public.spot_audio;
create trigger spot_audio_set_updated_at
  before update on public.spot_audio
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.spot_audio        enable row level security;
alter table public.tours             enable row level security;
alter table public.tour_translations enable row level security;
alter table public.tour_stops        enable row level security;

-- spot_audio: KEIN Public-Read. Audio ist Pro-Asset -> nur Admin direkt; die App
-- liefert Audio ausschließlich serverseitig (Service-Client) mit Teaser/Pro-Gating.
drop policy if exists "spot_audio_admin_all" on public.spot_audio;
create policy "spot_audio_admin_all" on public.spot_audio
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- tours: öffentlich nur published lesbar (Struktur = Teaser); Admin alles.
drop policy if exists "tours_public_read" on public.tours;
create policy "tours_public_read" on public.tours
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists "tours_admin_all" on public.tours;
create policy "tours_admin_all" on public.tours
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- tour_translations: lesbar wenn Tour published; Admin alles.
drop policy if exists "tour_translations_public_read" on public.tour_translations;
create policy "tour_translations_public_read" on public.tour_translations
  for select to anon, authenticated
  using (exists (
    select 1 from public.tours t
    where t.id = tour_translations.tour_id and t.status = 'published'
  ));

drop policy if exists "tour_translations_admin_all" on public.tour_translations;
create policy "tour_translations_admin_all" on public.tour_translations
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- tour_stops: lesbar wenn Tour published; Admin alles.
drop policy if exists "tour_stops_public_read" on public.tour_stops;
create policy "tour_stops_public_read" on public.tour_stops
  for select to anon, authenticated
  using (exists (
    select 1 from public.tours t
    where t.id = tour_stops.tour_id and t.status = 'published'
  ));

drop policy if exists "tour_stops_admin_all" on public.tour_stops;
create policy "tour_stops_admin_all" on public.tour_stops
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
