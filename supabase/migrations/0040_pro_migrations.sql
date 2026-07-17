-- Freischalt-Liste für die Käufer der alten WordPress-Plattform (Membership-Plugin).
--
-- WARUM KEINE KONTEN VORAB ANLEGEN:
-- Naheliegend wäre, für die ~100 Käufer Konten zu erzeugen und ihnen Pro zu setzen. Dagegen
-- sprechen drei Dinge, und alle drei wiegen schwerer als die Bequemlichkeit:
--
--   ZUSTIMMUNG. Sie haben den AGB der ALTEN Plattform zugestimmt, nicht der neuen. Das
--   Login-Formular sagt „Mit dem Login stimmst du den AGB und der Datenschutzerklärung zu".
--   Wer vorher Konten anlegt, überspringt genau diesen Satz.
--
--   KARTEILEICHEN. Von 100 kommen vielleicht 60. Die anderen 40 wären für immer Konten mit
--   personenbezogenen Daten, die niemand angelegt hat und niemand löscht.
--
--   UMKEHRBARKEIT. Ein Listeneintrag ist eine Zeile, die man löscht. Ein angelegtes Konto
--   ist der Datensatz eines Menschen.
--
-- Stattdessen steht hier nur die E-Mail, die wir ohnehin schon haben. Meldet sich der
-- Mensch selbst an — per Magic-Link ODER Google —, bekommt er Pro im selben Moment, in
-- derselben Transaktion, in der sein Profil entsteht (siehe handle_new_user unten).
--
-- pro_source = 'migration' gibt es im Enum seit dem ersten Commit. Und der Stripe-Webhook
-- widerruft bei Rückerstattung ausdrücklich NUR pro_source = 'stripe' — migriertes Pro
-- überlebt das also. Jemand hat diesen Tag vorgedacht.
create table if not exists public.pro_migrations (
  -- Die E-Mail IST der Schlüssel: Zweimal dieselbe Adresse einzutragen ist keine zweite
  -- Freischaltung, sondern ein Versehen. Der Primärschlüssel macht daraus einen Fehler
  -- statt einer stillen Dublette.
  email      text primary key,
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  -- Wann eingelöst und von wem. Beantwortet die eine Frage am Umzugstag: „Wie viele haben
  -- sich schon gemeldet?" — und später „Wieso hat der Pro?".
  claimed_at timestamptz,
  claimed_by uuid references public.profiles (id) on delete set null,
  -- Immer klein geschrieben. Ohne das wäre „Anton@…" ein anderer Eintrag als „anton@…",
  -- und der Mensch stünde vor der Tür, obwohl er auf der Liste steht. Ein Export aus einem
  -- WordPress-Plugin ist genau der Ort, an dem gemischte Schreibweisen herkommen.
  constraint pro_migrations_email_lower check (email = lower(email))
);

comment on table public.pro_migrations is
  'E-Mails der Käufer der alten WordPress-Plattform. Wer sich damit anmeldet, bekommt Pro automatisch (handle_new_user). Es werden KEINE Konten vorab angelegt.';

-- Für die Fortschrittsanzeige („38 von 100 offen").
create index if not exists pro_migrations_claimed_idx on public.pro_migrations (claimed_at);

alter table public.pro_migrations enable row level security;

-- Nur Admins, in jede Richtung. Hier stehen die E-Mail-Adressen zahlender Kunden.
drop policy if exists "pro_migrations_admin_all" on public.pro_migrations;
create policy "pro_migrations_admin_all" on public.pro_migrations
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- handle_new_user erweitern: bei der Anmeldung die Liste prüfen.
--
-- WARUM IM TRIGGER UND NICHT IN DER APP:
-- Profil und Pro entstehen so in EINER Transaktion. Aus der App wären es zwei Schritte,
-- und scheitert der zweite, steht der Mensch ohne Pro da, obwohl er dafür bezahlt hat —
-- auf einer Plattform, die er gerade zum ersten Mal betritt. Und es gilt für JEDEN Weg
-- herein: Magic-Link, Google, was auch immer später dazukommt.
--
-- security definer (wie bisher): Der Trigger läuft mit den Rechten des Eigentümers, RLS
-- und der Spaltenschutz aus 0016 stehen ihm nicht im Weg. Der 0016-Trigger klemmt ohnehin
-- nur, wenn auth.uid() gesetzt ist — beim Signup läuft GoTrue, kein eingeloggter Nutzer.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wants_news boolean := coalesce((new.raw_user_meta_data->>'newsletter_opt_in')::boolean, false);
  mail       text    := lower(coalesce(new.email, ''));
  migrated   boolean := false;
begin
  -- Steht die Adresse auf der Liste und ist noch nicht eingelöst?
  if mail <> '' then
    select exists (
      select 1 from public.pro_migrations
      where email = mail and claimed_at is null
    ) into migrated;
  end if;

  insert into public.profiles (
    id, email, newsletter_opt_in, newsletter_opt_in_at, is_pro, pro_since, pro_source
  )
  values (
    new.id,
    new.email,
    wants_news,
    case when wants_news then now() else null end,
    migrated,
    case when migrated then now() else null end,
    case when migrated then 'migration'::pro_source else null end
  )
  on conflict (id) do nothing;

  -- NUR abhaken, wenn das Profil wirklich neu entstanden ist. Ohne `if found` würde ein
  -- Wiedereintritt (Profil existiert schon) den Eintrag als eingelöst markieren, ohne dass
  -- jemand Pro bekommen hätte — die Liste zeigte dann einen Erfolg, den es nicht gab.
  if migrated and found then
    update public.pro_migrations
       set claimed_at = now(), claimed_by = new.id
     where email = mail and claimed_at is null;
  end if;

  return new;
end;
$$;
