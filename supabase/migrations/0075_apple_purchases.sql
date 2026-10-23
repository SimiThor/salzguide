-- Apple-Kauf (StoreKit 2): Tabelle der verbuchten Käufe, und 'apple' als BEZAHLTES Pro.
-- docs/41 Abschnitt 7. Voraussetzung: 0074 (Enum-Wert 'apple') ist eingespielt.
--
-- Reihenfolge beim Einspielen: erst 0074, dann diese Datei, beides VOR dem Merge des Codes.
-- Additiv: eine neue Tabelle und eine ersetzte Funktion (set_user_pro), kein Datenverlust.
-- Die Datei ist wiederholbar (if not exists, drop policy if exists, create or replace).
--
-- ── Schutz: ohne 0074 nichts tun ────────────────────────────────────────────────────────
--
-- set_user_pro vergleicht unten mit 'apple'. Fehlt der Enum-Wert, legt Postgres die Funktion
-- trotzdem an und bricht erst BEIM AUFRUF ab: Dann schlüge jedes Schenken und Entziehen im
-- Admin mit einem Datenbankfehler fehl. Darum bricht diese Datei lieber gleich ab, bevor sie
-- irgendetwas anlegt (der SQL Editor führt sie als eine Transaktion aus, es bleibt nichts zurück).
do $guard$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'pro_source' and e.enumlabel = 'apple'
  ) then
    raise exception 'Migration 0075 abgebrochen: erst 0074 einspielen';
  end if;
end
$guard$;


-- ── Was NICHT angepasst wird, und warum ─────────────────────────────────────────────────
--
--   handle_new_user (letzte Fassung: 0054): bleibt unverändert. Die Funktion vergibt Pro
--   beim ANLEGEN eines Profils aus pro_purchases (Stripe) oder pro_migrations. Einen
--   Apple-Kauf gibt es immer erst nach der Anmeldung (die App kauft nur angemeldet, die
--   Verbuchung braucht ein Bearer-Token), also nie "vor dem Konto". Ein Konto, das nach
--   einer Löschung neu angelegt wird, bekommt Pro ausschliesslich über "Käufe
--   wiederherstellen" (Server bindet die Zeile mit user_id null an das neue Konto). Eine
--   vollständige Kopie der Funktion nur für einen Kommentar wäre das Risiko, das das Repo
--   schon einmal erlebt hat (Teilkopie, die eine Bedingung verliert), ohne Nutzen.
--
--   Rückerstattungsfunktion (0054): ist keine SQL-Funktion. Sie steht in
--   lib/pro-purchase.ts (revokePro) und filtert ausdrücklich auf pro_source = 'stripe'.
--   Apple-Pro bleibt dadurch bei einer Stripe-Erstattung unberührt. Der Gegenweg
--   (Apple-Erstattung entzieht nur 'apple') steht in lib/apple-purchase.ts.


-- ── 1. apple_purchases ──────────────────────────────────────────────────────────────────
--
-- Eine Zeile je original_transaction_id. Das ist die eine Kennung, die über Wiederherstellen,
-- Geräte- und Kontowechsel gleich bleibt, und der Primärschlüssel macht aus "Kauf zweimal
-- gemeldet" (App-Neustart, Wiederherstellen, Notification) eine Verbuchung.
--
-- user_id: on delete set null. Löscht jemand sein Konto, bleibt der Kaufvorgang stehen (Apple
-- kennt ihn weiter) und verliert nur den Namen. Meldet sich der Käufer später mit einem neuen
-- Konto und stellt Käufe wieder her, bindet der Server die Zeile mit user_id null an das neue
-- Konto. Referenz auf auth.users (nicht profiles): Die Zeile soll beim Löschen des
-- Auth-Kontos auf null fallen, egal in welcher Reihenfolge Supabase aufräumt.
create table if not exists public.apple_purchases (
  original_transaction_id text primary key,
  user_id            uuid references auth.users (id) on delete set null,
  product_id         text not null,
  -- Nur diese zwei. Xcode/LocalTesting-Transaktionen sind nicht von Apple signiert und
  -- kommen nie bis hierher (der Server verifiziert die Signaturkette gegen Apples Wurzeln).
  environment        text not null check (environment in ('Production', 'Sandbox')),
  purchased_at       timestamptz not null,
  -- Gesetzt bei Erstattung (REFUND) oder Entzug (REVOKE). Eine Zeile mit revoked_at wird nie
  -- wieder freigeschaltet, auch nicht durch eine alte, noch gültig signierte Transaktion.
  revoked_at         timestamptz,
  -- Der appAccountToken aus der Transaktion (die App setzt ihn auf die Supabase-User-ID).
  -- Nur zur Nachvollziehbarkeit; die Zuordnung entscheidet user_id.
  app_account_token  uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.apple_purchases is
  'Verbuchte Käufe aus der iOS-App (Apple StoreKit 2). Schreiben nur der Server (Service-Key). Nutzer lesen nur eigene Zeilen.';

-- "Hat dieser Nutzer noch einen anderen, nicht erstatteten Kauf?" (Entzug nur, wenn nein.)
create index if not exists apple_purchases_user_idx
  on public.apple_purchases (user_id)
  where user_id is not null;

-- updated_at pflegen: dieselbe Funktion wie bei den anderen Tabellen (0001).
drop trigger if exists apple_purchases_set_updated_at on public.apple_purchases;
create trigger apple_purchases_set_updated_at
  before update on public.apple_purchases
  for each row execute function public.set_updated_at();

alter table public.apple_purchases enable row level security;

-- Lesen: nur die eigenen Zeilen (Datenexport nach Art. 15/20 DSGVO läuft über den
-- Session-Client, wie bei pro_purchases in 0053). Admin-Lesen gibt es hier bewusst nicht:
-- Der Admin sieht das Ergebnis (profiles.pro_source), und für Streitfälle gibt es den
-- Service-Zugriff im Dashboard.
drop policy if exists "apple_purchases_read_own" on public.apple_purchases;
create policy "apple_purchases_read_own" on public.apple_purchases
  for select to authenticated
  using (user_id = auth.uid());

-- KEINE insert-, update- oder delete-Policy: Ohne Policy ist alles verboten, was nicht
-- ausdrücklich erlaubt ist. Geschrieben wird nur mit dem Service-Key (umgeht RLS).
-- Zusätzlich die Tabellenrechte entziehen (Gürtel und Hosenträger): Die Supabase-Voreinstellung
-- gibt anon/authenticated sonst alle Rechte auf neue Tabellen, und eine später versehentlich
-- ergänzte Policy würde sofort greifen.
revoke all on public.apple_purchases from anon, authenticated;
grant select on public.apple_purchases to authenticated;


-- ── 2. set_user_pro: 'apple' zählt wie 'stripe' als BEZAHLT ─────────────────────────────
--
-- Übernommen aus 0038, VOLLSTÄNDIG. Geändert ist genau eine Bedingung (die Prüfung auf
-- bezahltes Pro) und ihre Antwort; alles andere ist Zeichen für Zeichen die Fassung aus 0038.
--
-- WARUM: 0038 schützt nur aktives 'stripe'-Pro. Ohne diese Änderung könnte ein Admin
--   Schenken -> pro_source auf 'comp' setzen: Die Apple-Erstattung entzieht nur
--                'apple'-Pro und fände die Zeile nicht mehr. Der Mensch bekäme sein Geld
--                von Apple zurück UND behielte Pro.
--   Entziehen -> bezahltes Apple-Pro stillschweigend wegnehmen. Das ist Sache der
--                Erstattung bei Apple.
-- Die Antwort 'apple_pro' ist neu (statt 'stripe_pro' wiederzuverwenden), damit der Admin den
-- richtigen Hinweis bekommt ("Erstattung bei Apple" statt "in Stripe").
create or replace function public.set_user_pro(
  target_user uuid,
  grant_pro   boolean,
  grant_note  text
)
returns text
language plpgsql
set search_path = public
as $$
declare
  cur_is_pro boolean;
  cur_source pro_source;
begin
  -- Erste Mauer. RLS würde ohnehin blocken, aber hier steht sie lesbar.
  if not public.is_admin() then
    return 'forbidden';
  end if;

  select is_pro, pro_source into cur_is_pro, cur_source
  from public.profiles
  where id = target_user;

  if not found then
    return 'not_found';
  end if;

  -- BEZAHLTES PRO IST TABU, in beide Richtungen:
  --   Entziehen -> wer bezahlt hat, wäre zu Recht wütend. Erstattung gehört zu Stripe,
  --                dann entzieht der Webhook es selbst, mit Beleg.
  --   Schenken  -> würde pro_source auf 'comp' setzen; der Webhook filtert beim Refund auf
  --                pro_source = 'stripe' und fände die Zeile nicht mehr. Der Mensch bekäme
  --                sein Geld zurück UND behielte Pro.
  -- Geprüft wird AKTIVES Stripe-Pro: Nach einer Rückerstattung bleibt pro_source auf
  -- 'stripe', aber is_pro ist false, so jemandem darf man sehr wohl schenken.
  if cur_is_pro and cur_source = 'stripe' then
    return 'stripe_pro';
  end if;

  -- NEU (0075): dieselbe Regel für aktives Apple-Pro, mit eigener Antwort. Gleiche
  -- Begründung wie oben; die Erstattung läuft über Apple (Notification REFUND/REVOKE).
  if cur_is_pro and cur_source = 'apple' then
    return 'apple_pro';
  end if;

  -- Nichts zu tun ist kein Fehler, aber auch keine Protokollzeile wert.
  if cur_is_pro = grant_pro then
    return 'ok';
  end if;

  if grant_pro then
    update public.profiles
       set is_pro = true, pro_since = now(), pro_source = 'comp'
     where id = target_user;
  else
    -- Entziehen wie der Webhook: nur is_pro. pro_source und pro_since bleiben stehen,
    -- sonst verlöre die Zeile ihre Herkunft.
    update public.profiles set is_pro = false where id = target_user;
  end if;

  insert into public.pro_grants (user_id, granted, source, note, admin_id)
  values (target_user, grant_pro, 'comp', nullif(btrim(grant_note), ''), auth.uid());

  return 'ok';
end;
$$;

comment on function public.set_user_pro(uuid, boolean, text) is
  'Schenkt Pro (comp) oder nimmt es zurück, samt Protokollzeile, atomar. Fasst aktives bezahltes Pro (Stripe, Apple) NICHT an. Nur Admins.';

-- anon darf das nie sehen; authenticated schon – die Funktion prüft selbst und RLS auch.
revoke all on function public.set_user_pro(uuid, boolean, text) from public, anon;
grant execute on function public.set_user_pro(uuid, boolean, text) to authenticated;
