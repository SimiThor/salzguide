-- Gast-Kauf: erst zahlen, dann Konto.
--
-- WARUM: Bis hierher musste sich jeder VOR dem Kauf anmelden — und die Anmeldung ist ein
-- Magic-Link. Der Weg zum Geld sah also so aus: Häkchen, „Jetzt Pro freischalten", E-Mail
-- eintippen, App verlassen, Postfach suchen, Link antippen, zurück auf /pro, Häkchen NOCHMAL
-- (der Zustand war nach dem Seitenwechsel weg), Knopf nochmal, dann erst Stripe. Sieben
-- Schritte mit einem Postfach-Umweg mitten in der Kaufabsicht. Wer da abbricht, ist nicht
-- unentschlossen, sondern abgehängt.
--
-- Jetzt: Häkchen, Knopf, Stripe (Apple/Google Pay = ein Tap), fertig. Die E-Mail sammelt
-- Stripe ohnehin ein, sie ist im Checkout ein Pflichtfeld. Das Konto entsteht NACH der
-- Zahlung — aus derselben Adresse.
--
-- DIESE TABELLE IST DER ANSPRUCH, NICHT DAS KONTO. Genau das Muster, das 0040 für die
-- Alt-Käufer der WordPress-Seite eingeführt hat (pro_migrations): Es steht nur die
-- bezahlte E-Mail da, und wer sich mit ihr anmeldet, bekommt Pro in derselben Transaktion,
-- in der sein Profil entsteht (handle_new_user unten). Der Anspruch überlebt damit alles,
-- was zwischen Zahlung und Konto schiefgehen kann: geschlossener Tab, Akku leer, anderes
-- Gerät, gelöschte Cookies. Bezahlt ist bezahlt.
--
-- WARUM DIE STRIPE-SESSION-ID DER SCHLÜSSEL IST: Sie ist die eine Sache, die es pro Kauf
-- genau einmal gibt. Freigeschaltet wird an zwei Stellen (Rücksprung-Route UND Webhook,
-- weil ein geschlossener Tab sonst niemanden freischaltet und ein tauber Webhook den
-- Käufer warten liesse) — der Primärschlüssel macht daraus zwei Versuche mit einem
-- Ergebnis. Ohne ihn wäre die zweite Zustellung eine zweite Freischaltung.
create table if not exists public.pro_purchases (
  stripe_session_id     text primary key,
  -- Die Adresse, mit der bezahlt wurde, immer klein geschrieben (Vergleich mit
  -- auth.users.email, das GoTrue ebenfalls kleinschreibt). Gleiche Begründung wie in 0040.
  email                 text not null,
  stripe_customer_id    text,
  stripe_payment_intent text,
  -- Betrag/Währung wie bezahlt. Nicht für die Anzeige (die kommt live aus Stripe), sondern
  -- damit später beantwortbar ist, was dieser Mensch tatsächlich gezahlt hat.
  amount_minor          integer,
  currency              text,
  paid_at               timestamptz not null default now(),
  -- Wem der Anspruch gutgeschrieben wurde. NULL = noch niemandem (Konto fehlt noch).
  -- on delete set null: Wer sein Konto löscht, löscht nicht den Zahlungsvorgang.
  user_id               uuid references public.profiles (id) on delete set null,
  granted_at            timestamptz,
  -- Ist das Konto DURCH diesen Kauf entstanden? Nur dann darf der Rücksprung überhaupt
  -- über einen Auto-Login nachdenken: Bei einem Konto, das es vorher schon gab, wäre das
  -- ein Einstieg in ein fremdes Konto — die E-Mail aus dem Stripe-Formular ist getippt,
  -- nicht bewiesen.
  account_created       boolean not null default false,
  -- SHA-256 des Kauf-Nachweises aus dem Cookie „sg_buy" (der Klartext liegt nur im Browser
  -- des Käufers). Zweiter Faktor für den Auto-Login: die zurückkehrende session_id allein
  -- reicht nicht, es muss derselbe Browser sein, der den Checkout gestartet hat.
  claim_hash            text,
  -- Wann der Auto-Login eingelöst wurde. Genau einmal, danach nie wieder.
  auto_login_at         timestamptz,
  -- Wann der Mensch bewiesen hat, dass ihm das Postfach gehört (Anmeldung über Magic-Link
  -- oder Google). Bis dahin ist eine per Auto-Login vergebene Sitzung „geliehen" und wird
  -- beim ersten bewiesenen Login gekappt (auth/callback).
  verified_at           timestamptz,
  created_at            timestamptz not null default now(),
  constraint pro_purchases_email_lower check (email = lower(email))
);

comment on table public.pro_purchases is
  'Bezahlte Pro-Käufe. Der Anspruch hängt an der E-Mail, nicht am Konto: Wer sich damit '
  'anmeldet, bekommt Pro automatisch (handle_new_user) — auch Tage später, auf jedem Gerät.';

-- Die eine Suche des Triggers: „gibt es für diese Adresse einen offenen Kauf?"
create index if not exists pro_purchases_open_idx
  on public.pro_purchases (email)
  where granted_at is null;

-- Die eine Suche des Login-Callbacks: „hat dieses Konto noch eine geliehene Sitzung?"
-- Teilindex -> die Zeile fällt aus dem Index, sobald der Mensch sich einmal angemeldet hat.
create index if not exists pro_purchases_unproven_idx
  on public.pro_purchases (user_id)
  where auto_login_at is not null and verified_at is null;

alter table public.pro_purchases enable row level security;

-- Hier stehen E-Mail-Adressen zahlender Kunden -> von aussen nur Admin, in jede Richtung.
-- Der Server (Service-Client) umgeht RLS und macht die Freischaltung.
drop policy if exists "pro_purchases_admin_all" on public.pro_purchases;
create policy "pro_purchases_admin_all" on public.pro_purchases
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Seinen eigenen Kauf darf jeder lesen. Nicht aus Bequemlichkeit: Der Datenexport
-- (Art. 15/20 DSGVO, account-actions.ts) läuft bewusst über den Session-Client, damit RLS
-- garantiert, dass niemand fremde Daten exportiert. Ohne diese Policy fehlte im Export
-- genau der Vorgang, an dem der Mensch am meisten hängt.
drop policy if exists "pro_purchases_read_own" on public.pro_purchases;
create policy "pro_purchases_read_own" on public.pro_purchases
  for select to authenticated
  using (user_id = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════════════════
--  handle_new_user: Pro beim Anlegen des Profils gutschreiben — jetzt aus ZWEI Listen
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- Unverändert die Begründung aus 0040, warum das im Trigger steht und nicht in der App:
-- Profil und Pro entstehen in EINER Transaktion. Scheitert ein zweiter Schritt aus der App,
-- steht jemand ohne Pro da, der gerade dafür bezahlt hat. Und es gilt für jeden Weg herein
-- (Magic-Link, Google, Auto-Login nach dem Kauf, was auch immer noch kommt).
--
-- REIHENFOLGE: Der bezahlte Kauf gewinnt vor der Umzugs-Liste. Wer beides hat, hat gerade
-- Geld überwiesen, und pro_source MUSS dann 'stripe' sein: Der Webhook entzieht bei einer
-- Rückerstattung ausdrücklich nur 'stripe'-Pro. Stünde dort 'migration', bliebe Pro nach
-- der Rückerstattung stehen.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wants_news boolean := coalesce((new.raw_user_meta_data->>'newsletter_opt_in')::boolean, false);
  mail       text    := lower(coalesce(new.email, ''));
  purchase   public.pro_purchases;
  migrated   boolean := false;
  src        pro_source;
begin
  if mail <> '' then
    -- Bezahlt und noch nicht gutgeschrieben. Der ältere zuerst: Wer (versehentlich) zweimal
    -- gekauft hat, löst den ersten Kauf ein; der zweite bleibt offen stehen und ist damit
    -- auffindbar — als Rückerstattungsfall, nicht als stille Dublette.
    select * into purchase
      from public.pro_purchases
     where email = mail and granted_at is null
     order by paid_at
     limit 1;

    if purchase.stripe_session_id is not null then
      src := 'stripe';
    else
      select exists (
        select 1 from public.pro_migrations
        where email = mail and claimed_at is null
      ) into migrated;
      if migrated then src := 'migration'; end if;
    end if;
  end if;

  insert into public.profiles (
    id, email, newsletter_opt_in, newsletter_opt_in_at,
    is_pro, pro_since, pro_source, stripe_customer_id
  )
  values (
    new.id,
    new.email,
    wants_news,
    case when wants_news then now() else null end,
    src is not null,
    case when src is not null then now() else null end,
    src,
    -- Die Verknüpfung zum Stripe-Kunden gehört ans Profil, sonst findet der Webhook bei
    -- einer Rückerstattung (charge.refunded, nur die Kunden-ID im Gepäck) niemanden.
    purchase.stripe_customer_id
  )
  on conflict (id) do nothing;

  -- NUR abhaken, wenn das Profil wirklich neu entstanden ist (Begründung aus 0040: sonst
  -- markiert ein Wiedereintritt den Anspruch als eingelöst, ohne dass jemand Pro bekam).
  if src is not null and found then
    if src = 'stripe' then
      update public.pro_purchases
         set granted_at = now(), user_id = new.id
       where stripe_session_id = purchase.stripe_session_id
         and granted_at is null;
    end if;

    -- Die Umzugs-Liste wird in BEIDEN Fällen abgehakt: Der Mensch ist da und hat Pro. Bliebe
    -- sein Eintrag offen, zählte der Admin ihn für immer als „wartet noch" — und ein Kauf,
    -- für den es längst einen freien Anspruch gab, fiele niemandem als Rückerstattungsfall auf.
    update public.pro_migrations
       set claimed_at = now(), claimed_by = new.id
     where email = mail and claimed_at is null;
  end if;

  return new;
end;
$$;
