-- Eine Rückerstattung muss auch den NOCH NICHT eingelösten Anspruch löschen.
--
-- Gefunden beim Durchtesten von 0053, nicht beim Lesen: Der Webhook entzieht bei
-- `charge.refunded` das Pro am Profil (pro_source = 'stripe'). Der Anspruch in
-- pro_purchases blieb dabei unangetastet — und der ist die zweite, unabhängige Quelle,
-- aus der handle_new_user Pro vergibt.
--
-- Der Weg dorthin, nachgestellt und bestätigt:
--   1. Jemand kauft als Gast. Die Kauf-Zeile steht, das Anlegen des Kontos scheitert
--      (Aussetzer bei Supabase, abgebrochene Funktion) -> granted_at bleibt NULL.
--   2. Er bekommt sein Geld zurück. Am Profil ist nichts zu entziehen, es gibt keins.
--   3. Er meldet sich Wochen später mit derselben Adresse an. Der Trigger findet einen
--      offenen bezahlten Kauf und schaltet Pro frei. Bezahlt hat er nichts mehr.
--
-- Selten (es braucht einen Fehlschlag genau im richtigen Moment), aber es ist die einzige
-- Stelle im ganzen Kaufweg, an der jemand ohne Zahlung an Pro kommt. Und ein Loch, das nur
-- nach einem anderen Fehler aufgeht, findet man im Betrieb nie.
alter table public.pro_purchases
  add column if not exists refunded_at timestamptz;

comment on column public.pro_purchases.refunded_at is
  'Wann das Geld zurückerstattet wurde. Gesetzt vom Stripe-Webhook (charge.refunded). '
  'Ein zurückerstatteter Kauf wird von handle_new_user nicht mehr eingelöst.';

-- Der Index für die eine Suche des Triggers, jetzt mit derselben Bedingung wie die Abfrage.
-- Ohne den Nachzug bliebe er zwar korrekt, würde aber Zeilen mitschleppen, die nie wieder
-- in Frage kommen.
drop index if exists pro_purchases_open_idx;
create index if not exists pro_purchases_open_idx
  on public.pro_purchases (email)
  where granted_at is null and refunded_at is null;

-- handle_new_user: unverändert bis auf die eine zusätzliche Bedingung.
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
    -- Bezahlt, noch nicht gutgeschrieben UND nicht zurückerstattet. Der ältere zuerst: Wer
    -- (versehentlich) zweimal gekauft hat, löst den ersten Kauf ein; der zweite bleibt offen
    -- stehen und ist damit auffindbar — als Rückerstattungsfall, nicht als stille Dublette.
    select * into purchase
      from public.pro_purchases
     where email = mail and granted_at is null and refunded_at is null
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
    purchase.stripe_customer_id
  )
  on conflict (id) do nothing;

  if src is not null and found then
    if src = 'stripe' then
      update public.pro_purchases
         set granted_at = now(), user_id = new.id
       where stripe_session_id = purchase.stripe_session_id
         and granted_at is null;
    end if;

    update public.pro_migrations
       set claimed_at = now(), claimed_by = new.id
     where email = mail and claimed_at is null;
  end if;

  return new;
end;
$$;
