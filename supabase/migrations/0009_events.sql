-- ============================================================================
-- SalzGuide — Events / „SalzGuide Weekly" (Wochenkalender Land Salzburg)
-- Quelle: docs/29_KONZEPT_Events.md
-- Idempotent: kann gefahrlos mehrfach ausgeführt werden.
-- Ausführen im Supabase SQL-Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums (in DO-Blöcken gekapselt, damit re-runnable)
-- ----------------------------------------------------------------------------
-- Kategorie = ART des Events (Filter-Pills). "Highlights" ist KEINE eigene Kategorie,
-- sondern die Auszeichnung is_highlight (Badge) -> eine Party kann auch Highlight sein.
do $$ begin
  create type event_category as enum ('party', 'tradition', 'kultur', 'kids');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_status as enum ('draft', 'published');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Tabelle
-- ----------------------------------------------------------------------------
create table if not exists public.events (
  id             uuid primary key default gen_random_uuid(),

  -- Inhalt (DE-Basis, EN inline — kein Über-Engineering, docs/29 §6)
  title          text not null,
  title_en       text,
  description    text,                 -- Kurzbeschreibung (Brand-Voice)
  description_en text,
  emoji          text,                 -- Card-Icon (iOS-Look, wie Spots)

  -- Zeit
  starts_at      timestamptz not null,
  ends_at        timestamptz,          -- optional; null = eintägig/ohne Endzeit
  all_day        boolean not null default false, -- ganztägig -> keine Uhrzeit anzeigen

  -- Ort (Land Salzburg); Koordinaten optional -> Pin auf Explore-Karte
  location_name  text,
  lat            double precision,
  lng            double precision,

  -- Klassifizierung & Auszeichnung
  category       event_category not null default 'kultur',
  is_highlight   boolean not null default false,

  -- Herkunft / Medien
  source_url     text,                 -- belegte Quelle (Grounding, docs/29 §4)
  image_url      text,

  status         event_status not null default 'draft',

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column public.events.category is
  'Art des Events (Filter-Pill): party | tradition | kultur | kids. Highlights = is_highlight, keine eigene Kategorie.';
comment on column public.events.is_highlight is
  'Redaktions-Tipp -> "Highlight"-Badge; genau diese Events zeigt die "Highlights"-Filter-Pill.';
comment on column public.events.all_day is
  'true = ganztägig (z.B. Markt/Festival) -> Uhrzeit wird nicht angezeigt.';

-- Öffentliche Wochenabfrage: status + Zeitfenster, nach Start sortiert.
create index if not exists events_public_idx on public.events (status, starts_at);
-- Auto-Ablauf-Filter (ends_at bzw. starts_at >= now) profitiert vom Start-Index.
create index if not exists events_starts_at_idx on public.events (starts_at);

-- updated_at pflegen (Funktion aus 0001_init.sql wiederverwenden)
drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Row Level Security (Default deny)
-- ----------------------------------------------------------------------------
alter table public.events enable row level security;

-- Öffentlich nur veröffentlichte Events lesbar; Admin alles (auch Drafts).
drop policy if exists "events_public_read" on public.events;
create policy "events_public_read" on public.events
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists "events_admin_all" on public.events;
create policy "events_admin_all" on public.events
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Hinweis: Der wöchentliche KI-Draft-Lauf (Cron) schreibt über den service_role-Key
-- (umgeht RLS) — analog api_cache. Kein anon/authenticated-Schreibrecht nötig.
