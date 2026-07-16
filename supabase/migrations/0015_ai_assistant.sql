-- KI-Assistent „Anton" (docs/16, 17, 02 §6):
--   1) ai_usage  — serverseitiges Free-Limit pro Subjekt (User bzw. Gast) & Tag.
--   2) ai_conversations / ai_messages — dauerhafter Chat-Verlauf je eingeloggtem User.
-- Alle Schreibzugriffe laufen serverseitig über den Service-Client (bypasst RLS);
-- die Lesezugriffe (Verlauf im Sheet) über den Session-Client -> RLS schützt sie.

-- ── 1) Free-Limit-Zähler ─────────────────────────────────────────────────────
-- subject = 'u:<user-uuid>' (eingeloggt) oder 'g:<anon-id>' (Gast, Cookie).
-- Pro-User werden gar nicht gezählt (unbegrenzt) -> stehen hier nie drin.
create table if not exists public.ai_usage (
  subject     text        not null,
  day         date        not null,
  count       integer     not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (subject, day)
);

alter table public.ai_usage enable row level security;
-- Keine Policies -> nur der Service-Client (service_role, bypasst RLS) kommt ran.

-- Atomarer Zähler-Hochlauf: legt (subject, day) an bzw. erhöht +1, gibt neuen Stand
-- zurück. So kann der Chat-Endpoint race-sicher zählen (ein Upsert statt read+write).
create or replace function public.bump_ai_usage(p_subject text)
returns integer
language plpgsql
as $$
declare
  new_count integer;
begin
  insert into public.ai_usage (subject, day, count, updated_at)
  values (p_subject, (now() at time zone 'Europe/Vienna')::date, 1, now())
  on conflict (subject, day)
  do update set count = public.ai_usage.count + 1, updated_at = now()
  returning count into new_count;
  return new_count;
end;
$$;

-- Nur serverseitig aufrufbar (Service-Client). Öffentliche Rollen bleiben außen vor.
revoke all on function public.bump_ai_usage(text) from public, anon, authenticated;

-- ── 2) Chat-Verlauf je User ──────────────────────────────────────────────────
create table if not exists public.ai_conversations (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  title       text,                       -- kurzer Anriss der ersten Frage (Anzeige)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ai_conversations_user_idx
  on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.ai_conversations(id) on delete cascade,
  role            text        not null check (role in ('user', 'assistant')),
  content         text        not null default '',
  -- Karten, die Anton zu einer Antwort gezeigt hat (Spots/Events) -> Verlauf
  -- rendert sie beim Wieder-Öffnen identisch nach. Form: { spots:[...], events:[...] }.
  cards           jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists ai_messages_conversation_idx
  on public.ai_messages (conversation_id, created_at);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;

-- User sieht/verwaltet nur die eigenen Konversationen (Verlauf-Abruf per Session-Client).
drop policy if exists ai_conversations_own on public.ai_conversations;
create policy ai_conversations_own on public.ai_conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Nachrichten sichtbar/schreibbar, wenn die Konversation dem User gehört.
drop policy if exists ai_messages_own on public.ai_messages;
create policy ai_messages_own on public.ai_messages
  for all using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.ai_conversations c
      where c.id = ai_messages.conversation_id and c.user_id = auth.uid()
    )
  );
