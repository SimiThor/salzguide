-- 🔴 Privilege-Escalation-Schutz für public.profiles (docs/34).
-- Problem: Die RLS-Policy "profiles_update_own" erlaubt einem eingeloggten User,
-- die EIGENE Zeile zu ändern – aber RLS kennt keinen Spaltenschutz. Ohne diesen
-- Trigger könnte ein normaler User per direktem PostgREST-Call
--   PATCH /rest/v1/profiles?id=eq.<eigene-uid>  { "role": "admin" }   (oder is_pro:true)
-- sich selbst zum Admin machen bzw. Pro erschleichen (klassische Vibe-Code-Lücke).
--
-- Lösung: BEFORE INSERT/UPDATE-Trigger, der die privilegierten Spalten für normale
-- User auf ihre alten Werte zurücksetzt. Block-Bedingung über auth.uid()+is_admin(),
-- NICHT über Rollen-Strings -> Service-Client (auth.uid() null), Migrationen (postgres,
-- auth.uid() null) und Admins (is_admin()=true) bleiben ungehindert; nur der
-- eingeloggte Nicht-Admin wird gesperrt.

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nur normale, eingeloggte Nicht-Admin-User einschränken.
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'UPDATE' then
      new.role              := old.role;
      new.is_pro            := old.is_pro;
      new.pro_since         := old.pro_since;
      new.pro_source        := old.pro_source;
      new.stripe_customer_id := old.stripe_customer_id;
    elsif tg_op = 'INSERT' then
      -- Selbst-Anlage darf nie mit erhöhten Rechten geschehen.
      new.role              := 'user';
      new.is_pro            := false;
      new.pro_since         := null;
      new.pro_source        := null;
      new.stripe_customer_id := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before insert or update on public.profiles
  for each row execute function public.protect_profile_columns();
