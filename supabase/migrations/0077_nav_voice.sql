-- ═══════════════════════════════════════════════════════════════════════════════════════
--  0077: Gesprochene Ansagen der Navigation (zuerst: Wanderführung), mit der Stimme aus
--        tts_voices statt der System-Stimme des Handys.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- Nur additiv. Die App lädt die Clips über /api/app/v1/nav-voice (signierte Links, 1 h) und
-- spricht sie am Handy ab. Ohne aktive Ansage-Stimme bleibt alles bei der System-Stimme.
--
-- Eine Datei je (Ansage, Sprache, Stimme), wie tour_point_voice_files: Der Hash ist NUR der
-- Text (ttsTextHash), nie Stimme oder Einstellungen. Ersetzte Dateien löscht der Waisen-Sweep
-- nach 48 Stunden, nie synchron. WICHTIG: scripts/lib/storage-refs.mjs listet
-- nav_prompt_files.audio_path, sonst löscht dieser Sweep jeden Clip 48 Stunden nach dem
-- Erzeugen. Diese Migration muss deshalb VOR dem Merge des Web-PRs laufen.

-- Welche Stimme die Ansagen spricht: höchstens eine (Partial-Unique-Index wie is_default).
-- Die Migration setzt keine; aktiviert wird im Admin, sobald alle Dateien da sind.
alter table public.tts_voices add column if not exists is_nav boolean not null default false;
comment on column public.tts_voices.is_nav is 'Stimme der gesprochenen Navigations-Ansagen (nav_prompt_files). Höchstens eine; gesetzt wird sie im Admin erst, wenn alle Ansagen in allen Sprachen existieren.';
create unique index if not exists tts_voices_single_nav
  on public.tts_voices (is_nav) where is_nav;

create table if not exists public.nav_prompt_files (
  id          uuid primary key default gen_random_uuid(),
  -- hike.offTrail, später z. B. bike.left.200m
  prompt_key  text not null check (prompt_key ~ '^[a-z]+(\.[a-zA-Z0-9]+){1,4}$'),
  lang        text not null check (lang in ('de','en','it','nl','ko','fr','zh','es','pt','pl','cs','hu','sk')),
  voice_id    uuid not null references public.tts_voices (id) on delete restrict,
  audio_path  text not null,
  text_hash   text not null,
  duration_ms integer,
  tts_profile text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (prompt_key, lang, voice_id)
);
comment on table  public.nav_prompt_files is 'Gesprochene Navigations-Ansagen (MP3) je Ansage, Sprache und Stimme im privaten Bucket tour-audio. KEIN Public-Read: Auslieferung nur über signierte Links der Manifest-Route.';
comment on column public.nav_prompt_files.audio_path is 'OBJEKT-PFAD im Bucket tour-audio (nie eine URL). Steht in scripts/lib/storage-refs.mjs, sonst löscht der Waisen-Sweep die Datei.';
comment on column public.nav_prompt_files.text_hash is 'ttsTextHash(text) zum Zeitpunkt der Vertonung. Nur der Text, nie Stimme oder Einstellungen.';
comment on column public.nav_prompt_files.tts_profile is 'Modell|Einstellungen|ElevenLabs-ID bei der Erzeugung, nur zur Information.';

create index if not exists nav_prompt_files_voice_idx on public.nav_prompt_files (voice_id);

drop trigger if exists nav_prompt_files_set_updated_at on public.nav_prompt_files;
create trigger nav_prompt_files_set_updated_at before update on public.nav_prompt_files
  for each row execute function public.set_updated_at();

alter table public.nav_prompt_files enable row level security;
drop policy if exists "nav_prompt_files_admin_all" on public.nav_prompt_files;
create policy "nav_prompt_files_admin_all" on public.nav_prompt_files
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
