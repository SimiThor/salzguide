-- ============================================================================
-- SalzGuide — Migration 0004: Newsletter-Einwilligung (DSGVO Opt-in)
-- Speichert ausdrückliche Zustimmung + Zeitpunkt. handle_new_user übernimmt
-- die Zustimmung aus den Signup-Metadaten. Idempotent.
-- ============================================================================

alter table public.profiles
  add column if not exists newsletter_opt_in boolean not null default false,
  add column if not exists newsletter_opt_in_at timestamptz;

-- Auto-Profil bei Signup: E-Mail + Newsletter-Einwilligung übernehmen
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wants_news boolean := coalesce((new.raw_user_meta_data->>'newsletter_opt_in')::boolean, false);
begin
  insert into public.profiles (id, email, newsletter_opt_in, newsletter_opt_in_at)
  values (
    new.id,
    new.email,
    wants_news,
    case when wants_news then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
