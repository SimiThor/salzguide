-- ============================================================================
-- SalzGuide — Migration 0002: Locals (Empfehlende mit Foto für Insider-Tipps)
-- Wiederverwendbares Verzeichnis: einmal Local mit Name/Rolle/Foto anlegen,
-- dann pro Spot per local_id auswählen. Idempotent. Im SQL-Editor ausführen.
-- ============================================================================

create table if not exists public.locals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,   -- z.B. "Anton"
  role        text,                   -- z.B. "Local aus Salzburg"
  avatar_url  text,                   -- Foto (optional; bis Upload = Initiale)
  created_at  timestamptz not null default now()
);

-- Welcher Local empfiehlt den Spot
alter table public.spots
  add column if not exists local_id uuid references public.locals (id);

-- RLS: öffentlich lesbar, schreiben nur Admin
alter table public.locals enable row level security;

drop policy if exists "locals_public_read" on public.locals;
create policy "locals_public_read" on public.locals
  for select to anon, authenticated using (true);

drop policy if exists "locals_admin_all" on public.locals;
create policy "locals_admin_all" on public.locals
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
