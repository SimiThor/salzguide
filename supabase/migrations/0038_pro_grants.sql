-- Protokoll: wer wem wann Pro geschenkt oder entzogen hat.
--
-- WARUM EINE EIGENE TABELLE UND NICHT ZWEI SPALTEN AUF profiles:
-- Zwei Spalten (granted_by, granted_at) kennen nur den LETZTEN Stand. Wer wissen will,
-- warum jemand im Mai Pro hatte, im Juni nicht und im Juli wieder, findet dort nichts.
-- Genau diese Frage stellt man aber, wenn sich jemand beschwert — und dann ist die Antwort
-- „weiß keiner mehr" die teuerste.
--
-- WARUM NUR ANHÄNGEND:
-- Es gibt bewusst KEINE update- und KEINE delete-Policy. Ein Protokoll, das man ändern
-- kann, ist kein Protokoll, sondern eine Behauptung. Auch ein Admin kann hier nur
-- schreiben und lesen. Wer eine Zeile für falsch hält, schreibt eine neue dagegen.
--
-- WAS HIER NICHT LANDET:
-- Stripe-Käufe. Die stehen bei Stripe, vollständig und mit Beleg — sie hier zu doppeln
-- hieße, zwei Wahrheiten zu pflegen. Dieses Protokoll beantwortet genau eine Frage:
-- „Warum hat dieser Mensch Pro, obwohl er nie bezahlt hat?"
create table if not exists public.pro_grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- true = gegeben, false = entzogen. Beides gehört ins Protokoll: Ein Entzug ohne Grund
  -- ist die Beschwerde von morgen.
  granted    boolean not null,
  source     pro_source not null,
  -- Warum. Freiwillig, aber der eigentliche Wert der Zeile: „Gewinnspiel Juli",
  -- „Beschwerde Rückerstattung", „Testkonto Simon".
  note       text,
  -- Wer. on delete set null: Verlässt ein Admin das Projekt, bleibt die Zeile stehen und
  -- verliert nur den Namen. Ein Protokoll, das beim Löschen eines Kontos Löcher bekommt,
  -- ist zur Hälfte nutzlos.
  admin_id   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.pro_grants is
  'Anhängendes Protokoll jeder manuellen Pro-Vergabe. Stripe-Käufe stehen NICHT hier (die kennt Stripe). Kein update/delete: ein änderbares Protokoll ist keins.';

-- Für die Detailansicht eines Nutzers: seine Historie, neueste zuerst.
create index if not exists pro_grants_user_idx on public.pro_grants (user_id, created_at desc);

alter table public.pro_grants enable row level security;

-- Lesen: nur Admins. Ein Nutzer hat hier nichts zu suchen — es steht drin, wer ihm was
-- warum gegeben hat, inklusive interner Notizen.
drop policy if exists "pro_grants_admin_read" on public.pro_grants;
create policy "pro_grants_admin_read" on public.pro_grants
  for select to authenticated
  using (public.is_admin());

-- Schreiben: nur Admins, und NUR im eigenen Namen. `admin_id = auth.uid()` ist der Punkt:
-- Ohne diese Zeile könnte ein Admin eine Vergabe auf einen Kollegen schreiben. Ein
-- Protokoll, in dem man fremde Namen eintragen kann, belastet den Falschen.
drop policy if exists "pro_grants_admin_insert" on public.pro_grants;
create policy "pro_grants_admin_insert" on public.pro_grants
  for insert to authenticated
  with check (public.is_admin() and admin_id = auth.uid());

-- KEINE update-Policy, KEINE delete-Policy. Das ist Absicht, siehe oben.


-- Pro schenken oder zurücknehmen — Änderung UND Protokoll in EINEM Schritt.
--
-- WARUM ALS DB-FUNKTION UND NICHT IN TYPESCRIPT:
--
-- 1. ATOMAR. Aus der App wären das zwei Aufrufe: erst profiles ändern, dann pro_grants
--    schreiben. Scheitert der zweite, hat jemand Pro ohne Protokollzeile — also genau das
--    „warum hat der eigentlich Pro?", gegen das dieses Protokoll gebaut wurde. Ein
--    Funktionsrumpf ist EINE Transaktion: beides oder nichts.
--
-- 2. DIE REGEL GILT AUCH FÜR DEN NÄCHSTEN. „Bezahltes Pro nicht anfassen" in der App wäre
--    eine Bitte an jeden, der später eine zweite Schreibstelle baut. Hier ist es Zwang,
--    wie schon beim Spaltenschutz (0016).
--
-- security invoker (Standard): Die Funktion läuft mit den Rechten des Aufrufers, RLS und
-- der 0016-Trigger greifen also weiterhin. Sie verschafft niemandem neue Rechte — sie
-- fasst nur zusammen, was ein Admin ohnehin dürfte, und macht es unteilbar.
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
  -- 'stripe', aber is_pro ist false — so jemandem darf man sehr wohl schenken.
  if cur_is_pro and cur_source = 'stripe' then
    return 'stripe_pro';
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
  'Schenkt Pro (comp) oder nimmt es zurück, samt Protokollzeile, atomar. Fasst aktives Stripe-Pro NICHT an. Nur Admins.';

-- anon darf das nie sehen; authenticated schon – die Funktion prüft selbst und RLS auch.
revoke all on function public.set_user_pro(uuid, boolean, text) from public, anon;
grant execute on function public.set_user_pro(uuid, boolean, text) to authenticated;
