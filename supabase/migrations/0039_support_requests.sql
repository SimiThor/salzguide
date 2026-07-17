-- Service-Anfragen von Nutzern: Formular -> Tabelle -> Admin.
--
-- WARUM ÜBERHAUPT EINE TABELLE UND NICHT NUR EINE MAIL:
-- Eine Mail an office@ hat keinen Status. Sie landet im Spam, jemand liest sie im Zug und
-- vergisst sie, oder zwei Leute antworten. Nichts davon merkt man. Die Tabelle beantwortet
-- „was ist offen?" — die Mail bleibt trotzdem, als zweiter Weg (siehe support-actions.ts).
do $$ begin
  create type support_status as enum ('open', 'done');
exception when duplicate_object then null; end $$;

create table if not exists public.support_requests (
  id         uuid primary key default gen_random_uuid(),
  -- Wer schreibt, FALLS angemeldet. Nicht Pflicht: Der häufigste Support-Fall ist „ich
  -- komme nicht rein" — genau die Person ist nicht eingeloggt.
  --
  -- on delete CASCADE, nicht set null: Löscht jemand sein Konto, muss seine Anfrage mit
  -- seiner E-Mail und seinem Text mitgehen (Art. 17 DSGVO). Bliebe die Zeile mit `email`
  -- stehen, hätten wir seine Daten behalten, obwohl er gegangen ist.
  user_id    uuid references public.profiles (id) on delete cascade,
  email      text not null,
  name       text,
  message    text not null,
  -- In welcher Sprache geschrieben wurde. Verrät, ob man auf Deutsch antworten kann.
  locale     text,
  status     support_status not null default 'open',
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.support_requests is
  'Service-Anfragen aus dem /support-Formular. Kein Insert-Recht für anon/authenticated: geschrieben wird NUR serverseitig, nachdem Turnstile bestanden ist.';

-- Die Arbeitsliste: offene zuerst, neueste zuerst.
create index if not exists support_requests_status_idx
  on public.support_requests (status, created_at desc);

alter table public.support_requests enable row level security;

-- HIER FEHLT ABSICHTLICH DIE INSERT-POLICY, und das ist die wichtigste Zeile dieser Datei.
--
-- Dürfte anon einfügen, könnte jeder Bot mein Formular UMGEHEN und direkt an PostgREST
-- posten (POST /rest/v1/support_requests). Der Turnstile-Schutz sitzt in der Server-Action —
-- wer die Tabelle direkt erreicht, läuft daran vorbei. Die Tabelle wäre ein offener
-- Briefkasten, und unser Resend-Kontingent gleich mit.
--
-- Ohne Policy kommt nur der Service-Client rein, also ausschliesslich unser Server, und
-- der prüft vorher. Dasselbe Muster wie ai_burst (Migration 0018).

-- Lesen: nur Admins. Es stehen fremde E-Mail-Adressen und Nachrichten drin.
drop policy if exists "support_requests_admin_read" on public.support_requests;
create policy "support_requests_admin_read" on public.support_requests
  for select to authenticated
  using (public.is_admin());

-- Status setzen: nur Admins.
drop policy if exists "support_requests_admin_update" on public.support_requests;
create policy "support_requests_admin_update" on public.support_requests
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Löschen: nur Admins. Anders als beim Pro-Protokoll ist das hier RICHTIG — eine Anfrage
-- ist kein Nachweis, sondern fremde personenbezogene Daten. Wer die Löschung verlangt
-- (Art. 17 DSGVO) und kein Konto hat, kann nur über uns gelöscht werden.
drop policy if exists "support_requests_admin_delete" on public.support_requests;
create policy "support_requests_admin_delete" on public.support_requests
  for delete to authenticated
  using (public.is_admin());
