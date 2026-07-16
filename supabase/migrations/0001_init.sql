-- ============================================================================
-- SalzGuide — Auftrag B: Datenbank-Schema (Phase 1 / MVP)
-- Quelle: docs/02_ARCHITEKTUR.md §2, docs/33_SICHERHEIT_DSGVO.md
-- Idempotent: kann gefahrlos mehrfach ausgeführt werden.
-- Ausführen im Supabase SQL-Editor.
-- ============================================================================

-- Für gen_random_uuid()
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. Enums (in DO-Blöcken gekapselt, damit re-runnable)
-- ----------------------------------------------------------------------------
do $$ begin
  create type spot_type as enum ('activity', 'food');
exception when duplicate_object then null; end $$;

do $$ begin
  create type spot_status as enum ('draft', 'published');
exception when duplicate_object then null; end $$;

do $$ begin
  create type access_mode as enum ('oeffis', 'auto', 'beides');
exception when duplicate_object then null; end $$;

do $$ begin
  create type difficulty_level as enum ('leicht', 'mittel', 'schwer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pro_source as enum ('stripe', 'migration', 'comp');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('user', 'admin');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Tabellen
-- ----------------------------------------------------------------------------

-- Spots: sprachneutrale Stammdaten
create table if not exists public.spots (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  type            spot_type not null,
  subtype         text,
  seasons         text[] not null default '{summer}',
  is_pro          boolean not null default false,
  status          spot_status not null default 'draft',
  sort_weight     integer not null default 0,
  emoji           text,

  -- Geo
  lat             double precision,
  lng             double precision,
  parking_lat     double precision,
  parking_lng     double precision,
  transit_lat     double precision,
  transit_lng     double precision,
  route_geojson   jsonb,
  distance_km     double precision,
  ascent_m        double precision,
  descent_m       double precision,

  -- Quick-Facts (typabhängige Anzeige)
  difficulty      difficulty_level,
  best_season     text,
  access          access_mode,
  price_level     text,
  area            text,
  fame            text,

  -- KI-Guide-Tags
  loc             text,                       -- 'stadt' | 'seen' | 'berge' | null
  kids            boolean not null default false,
  bus             boolean not null default false,
  vibes           text[] not null default '{}',

  -- Integrationen / Action-Tiles
  google_place_id text,
  phone           text,
  lake_name       text,
  ticket_url      text,
  ticket_partner  text,
  price           text,
  currency        text,
  website_url     text,
  has_opening_hours boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists spots_status_idx on public.spots (status);
create index if not exists spots_seasons_idx on public.spots using gin (seasons);

-- Übersetzungen pro Spot × Sprache
create table if not exists public.spot_translations (
  id              uuid primary key default gen_random_uuid(),
  spot_id         uuid not null references public.spots (id) on delete cascade,
  lang            text not null,
  title           text not null,
  short_desc      text,
  general         text,
  insider_tip     text,
  section_a       text,                       -- activity: Dauer&Schwierigkeit / food: Küche&Stil
  section_b       text,                       -- activity: Beste Jahreszeit / food: Preisniveau
  location_text   text,
  insider_author  text,
  unique (spot_id, lang)
);

-- Kategorien (Karussell-Reihen, saison-spezifisch)
create table if not exists public.categories (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null,
  season             text not null,           -- 'summer' | 'winter'
  title_translations jsonb not null default '{}',
  sort_order         integer not null default 0,
  unique (key, season)
);

-- m:n Spot <-> Kategorie
create table if not exists public.spot_categories (
  spot_id     uuid not null references public.spots (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (spot_id, category_id)
);

-- Medien pro Spot
create table if not exists public.media (
  id          uuid primary key default gen_random_uuid(),
  spot_id     uuid not null references public.spots (id) on delete cascade,
  type        text not null check (type in ('image', 'video')),
  role        text,                           -- hero | gallery | content | preview
  url         text not null,
  variants    jsonb,
  poster_url  text,
  alt         text,
  sort_order  integer not null default 0
);

-- Profile (erweitert auth.users)
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text,
  display_name       text,
  locale             text default 'de',
  is_pro             boolean not null default false,
  pro_since          timestamptz,
  pro_source         pro_source,
  stripe_customer_id text,
  role               user_role not null default 'user',
  created_at         timestamptz not null default now()
);

-- Merklisten + Einträge
create table if not exists public.saved_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.saved_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.saved_lists (id) on delete cascade,
  spot_id     uuid not null references public.spots (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (list_id, spot_id)
);

-- Generischer API-Cache (Wetter/Places/Wassertemp) — nur serverseitig
create table if not exists public.api_cache (
  cache_key   text primary key,
  payload     jsonb,
  fetched_at  timestamptz not null default now(),
  ttl         integer                          -- Sekunden
);

-- ----------------------------------------------------------------------------
-- 3. Funktionen & Trigger
-- ----------------------------------------------------------------------------

-- Admin-Check (SECURITY DEFINER -> umgeht RLS, verhindert Rekursion in Policies)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Profil bei neuem Auth-User automatisch anlegen
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at pflegen
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists spots_set_updated_at on public.spots;
create trigger spots_set_updated_at
  before update on public.spots
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Row Level Security (Default deny) — auf ALLEN Tabellen aktiv
-- ----------------------------------------------------------------------------
alter table public.spots            enable row level security;
alter table public.spot_translations enable row level security;
alter table public.categories       enable row level security;
alter table public.spot_categories  enable row level security;
alter table public.media            enable row level security;
alter table public.profiles         enable row level security;
alter table public.saved_lists      enable row level security;
alter table public.saved_items      enable row level security;
alter table public.api_cache        enable row level security;

-- spots: öffentlich nur published lesbar; Admin alles
drop policy if exists "spots_public_read" on public.spots;
create policy "spots_public_read" on public.spots
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists "spots_admin_all" on public.spots;
create policy "spots_admin_all" on public.spots
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- spot_translations: lesbar wenn zugehöriger Spot published; Admin alles
drop policy if exists "spot_translations_public_read" on public.spot_translations;
create policy "spot_translations_public_read" on public.spot_translations
  for select to anon, authenticated
  using (exists (
    select 1 from public.spots s
    where s.id = spot_translations.spot_id and s.status = 'published'
  ));

drop policy if exists "spot_translations_admin_all" on public.spot_translations;
create policy "spot_translations_admin_all" on public.spot_translations
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- categories: öffentlich lesbar; Admin schreibt
drop policy if exists "categories_public_read" on public.categories;
create policy "categories_public_read" on public.categories
  for select to anon, authenticated using (true);

drop policy if exists "categories_admin_all" on public.categories;
create policy "categories_admin_all" on public.categories
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- spot_categories: öffentlich lesbar; Admin schreibt
drop policy if exists "spot_categories_public_read" on public.spot_categories;
create policy "spot_categories_public_read" on public.spot_categories
  for select to anon, authenticated using (true);

drop policy if exists "spot_categories_admin_all" on public.spot_categories;
create policy "spot_categories_admin_all" on public.spot_categories
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- media: lesbar wenn zugehöriger Spot published; Admin alles
drop policy if exists "media_public_read" on public.media;
create policy "media_public_read" on public.media
  for select to anon, authenticated
  using (exists (
    select 1 from public.spots s
    where s.id = media.spot_id and s.status = 'published'
  ));

drop policy if exists "media_admin_all" on public.media;
create policy "media_admin_all" on public.media
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- profiles: nur eigene Zeile; Admin alles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- saved_lists: nur eigene
drop policy if exists "saved_lists_own" on public.saved_lists;
create policy "saved_lists_own" on public.saved_lists
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- saved_items: nur wenn die Liste dem User gehört
drop policy if exists "saved_items_own" on public.saved_items;
create policy "saved_items_own" on public.saved_items
  for all to authenticated
  using (exists (
    select 1 from public.saved_lists l
    where l.id = saved_items.list_id and l.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.saved_lists l
    where l.id = saved_items.list_id and l.user_id = auth.uid()
  ));

-- api_cache: KEINE Policy -> nur service_role (serverseitig) hat Zugriff.
-- (RLS aktiv + keine Policy = Default deny für anon/authenticated.)
