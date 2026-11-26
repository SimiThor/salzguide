-- Apple-Kauf ohne Konto (Apple-Regel 5.1.1, 26.11.2026): Mehrere ANONYME Konten derselben Apple-ID
-- teilen sich einen Kauf. docs/41 Abschnitt 1 und 7, Regeln in lib/apple-purchase-core.ts (2a, 2b).
--
-- Voraussetzung: 0075 ist eingespielt. Additiv und wiederholbar (if not exists, create or replace).
-- Einspielen VOR dem Merge des Codes (Supabase › SQL Editor), wie jede Migration hier.
--
-- WARUM: Kauft jemand ohne Anmeldung auf dem iPhone, hängt der Kauf an einem anonymen Konto A1.
-- Öffnet er die App auf dem iPad (gleiche Apple-ID, wieder ohne Anmeldung), legt das iPad ein
-- eigenes anonymes Konto A2 an. Ein nicht verbrauchbarer Kauf gilt auf allen Geräten der Apple-ID,
-- also bekommt A2 Pro DAZU, statt es A1 wegzunehmen. Damit eine Erstattung beide erreicht, steht A2
-- hier in `anon_holders`. Meldet sich der Nutzer an, wandert der Kauf ins echte Konto, und alle
-- anonymen Inhaber verlieren ihr Apple-Pro (die Liste wird dabei geleert).

alter table public.apple_purchases
  add column if not exists anon_holders uuid[] not null default '{}';

create index if not exists apple_purchases_anon_holders_idx
  on public.apple_purchases using gin (anon_holders);

-- Einen anonymen Mit-Inhaber eintragen. Nur solange die Zeile nicht erstattet ist, genau diesem
-- Besitzer gehört und weniger als 4 Mit-Inhaber hat (MAX_ANON_HOLDERS in apple-purchase-core.ts;
-- sonst ließe sich ein weitergegebener Kauf an beliebig viele anonyme Konten verteilen). Die
-- Bedingung steckt im UPDATE: zwei Geräte überholen sich nicht. true = eingetragen oder schon drin.
create or replace function public.apple_purchase_add_holder(
  p_transaction text,
  p_owner uuid,
  p_holder uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.apple_purchases
     set anon_holders = case
           when p_holder = any(anon_holders) then anon_holders
           else array_append(anon_holders, p_holder)
         end
   where original_transaction_id = p_transaction
     and user_id = p_owner
     and revoked_at is null
     and (p_holder = any(anon_holders) or coalesce(array_length(anon_holders, 1), 0) < 4);
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Eine frühere Entwurfsfassung mit drei Argumenten (ohne Prüfung der Liste) darf nicht liegen bleiben.
drop function if exists public.apple_purchase_move(text, uuid, uuid);

-- Ins echte Konto umziehen: Besitzer wechseln und die anonymen Mit-Inhaber leeren, in EINEM
-- Schritt. Nur wenn die Zeile noch dem erwarteten anonymen Besitzer gehört, nicht erstattet ist UND
-- genau die Mit-Inhaber hat, denen der Server gerade Pro genommen hat (p_expected). Kam inzwischen
-- einer dazu, scheitert der Umzug, und der Server liest neu (sonst behielte der neue Pro ohne Zeile).
create or replace function public.apple_purchase_move(
  p_transaction text,
  p_from uuid,
  p_to uuid,
  p_expected uuid[]
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.apple_purchases
     set user_id = p_to,
         anon_holders = '{}'
   where original_transaction_id = p_transaction
     and user_id = p_from
     and revoked_at is null
     and anon_holders = coalesce(p_expected, '{}');
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Nur der Server (Service-Key) ruft diese Funktionen auf.
revoke all on function public.apple_purchase_add_holder(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.apple_purchase_move(text, uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.apple_purchase_add_holder(text, uuid, uuid) to service_role;
grant execute on function public.apple_purchase_move(text, uuid, uuid, uuid[]) to service_role;


-- ── Anonyme Konten dürfen nichts selbst schreiben ──────────────────────────────────────
--
-- Mit „Allow anonymous sign-ins“ (Supabase › Authentication) kann JEDER mit dem öffentlichen
-- Schlüssel ein anonymes Konto anlegen. Es hat die Rolle `authenticated` wie ein echtes Konto, und
-- alle Policies "to authenticated" gälten auch für es (Merkliste, Events, eigene Runden, Support,
-- Uploads). Anonyme Konten brauchen aber nur LESEN (Pro-Inhalte nach einem Kauf); den Kauf verbucht
-- der Server mit dem Service-Key. Darum je Tabelle mit RLS eine EINSCHRÄNKENDE Policy (restrictive):
-- Sie gilt zusätzlich zu allen anderen und verbietet Schreiben, sobald das Token `is_anonymous` trägt.
-- Gilt für alle Tabellen in public und für storage.objects. NEUE TABELLEN bekommen sie nicht von
-- selbst: Diesen Block nach jeder Migration mit neuen Schreib-Policies erneut ausführen (wiederholbar).

create or replace function public.jwt_is_anonymous() returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

do $block$
declare
  t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r'
       and c.relrowsecurity
       and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('drop policy if exists "no_anonymous_insert" on %I.%I', t.schema_name, t.table_name);
    execute format('drop policy if exists "no_anonymous_update" on %I.%I', t.schema_name, t.table_name);
    execute format('drop policy if exists "no_anonymous_delete" on %I.%I', t.schema_name, t.table_name);
    execute format(
      'create policy "no_anonymous_insert" on %I.%I as restrictive for insert to authenticated with check (not public.jwt_is_anonymous())',
      t.schema_name, t.table_name);
    execute format(
      'create policy "no_anonymous_update" on %I.%I as restrictive for update to authenticated using (not public.jwt_is_anonymous()) with check (not public.jwt_is_anonymous())',
      t.schema_name, t.table_name);
    execute format(
      'create policy "no_anonymous_delete" on %I.%I as restrictive for delete to authenticated using (not public.jwt_is_anonymous())',
      t.schema_name, t.table_name);
  end loop;
end
$block$;
