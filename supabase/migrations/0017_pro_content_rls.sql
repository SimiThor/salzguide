-- 🔴 C1 (docs/34): Pro-Inhalte waren über den öffentlichen Anon-Key via PostgREST
-- direkt lesbar (spots_public_read erlaubte alle published inkl. is_pro=true).
-- Das umging die Paywall + leakte das Premium-IP. Fix: RLS so verschärfen, dass
-- anon/Nicht-Pro nur NICHT-Pro-Spots (+ deren Übersetzungen/Medien) lesen dürfen;
-- Pro-Zeilen nur für Pro-User (is_pro_user()) bzw. Admin (eigene admin_all-Policy).
--
-- Die App zeigt weiterhin gesperrte Teaser (Pin/Karte) — das läuft server-seitig
-- über den Service-Client mit autoritativem Blanking (src/lib/spots.ts), NICHT über
-- diese öffentlichen Policies. Diese RLS ist die harte Sperre für den Direktzugriff.

-- Helfer: ist der aktuelle User Pro? (SECURITY DEFINER -> liest profiles ohne RLS,
-- keine Rekursion; fixer search_path gegen Hijacking.)
create or replace function public.is_pro_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_pro = true
  );
$$;

-- spots: öffentlich nur NICHT-Pro published; Pro nur für Pro-User. (Admin: admin_all.)
drop policy if exists "spots_public_read" on public.spots;
create policy "spots_public_read" on public.spots
  for select to anon, authenticated
  using (
    status = 'published' and (is_pro = false or public.is_pro_user())
  );

-- spot_translations: nur, wenn der zugehörige Spot published UND (nicht Pro ODER Pro-User).
drop policy if exists "spot_translations_public_read" on public.spot_translations;
create policy "spot_translations_public_read" on public.spot_translations
  for select to anon, authenticated
  using (exists (
    select 1 from public.spots s
    where s.id = spot_translations.spot_id
      and s.status = 'published'
      and (s.is_pro = false or public.is_pro_user())
  ));

-- media: analog.
drop policy if exists "media_public_read" on public.media;
create policy "media_public_read" on public.media
  for select to anon, authenticated
  using (exists (
    select 1 from public.spots s
    where s.id = media.spot_id
      and s.status = 'published'
      and (s.is_pro = false or public.is_pro_user())
  ));
