-- ═══════════════════════════════════════════════════════════════════════════════════════
--  0068: Wählbare Stimmen. Eine Stimme je Runde, Dateien je Punkt, Sprache UND Stimme.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- WARUM: Bis hierher sprach in jeder Audio-Runde dieselbe Stimme, und sie stand in der ENV
-- (ELEVENLABS_VOICE_ID). Jetzt sollen Runden mit verschiedenen Stimmen sprechen (Route 66
-- mit Simons geklonter Stimme, der Giro mit Antons, alles andere mit der Erzählstimme
-- "Toni"), und durch EINE Runde spricht immer genau eine Stimme.
--
-- Das Datenmodell folgt aus zwei Tatsachen:
--   1. Audio hängt am PUNKT (tour_point_audio, eindeutig je point_id + lang), und Runden
--      wählen Punkte aus dem Pool ihres Gebiets. Zwei Rad-Runden aus demselben Pool werden
--      sich Punkte teilen (Mirabell, Mülln).
--   2. Eine MP3 hat genau eine Stimme.
-- Also bleibt der TEXT je Punkt und Sprache (tour_point_audio), und die DATEIEN wandern in
-- eine Tabelle je Punkt, Sprache und Stimme (tour_point_voice_files). Die Runde trägt ihre
-- Stimme (tours.voice_id) und liest ausschließlich deren Dateien.
--
-- Jede Datei merkt sich den Hash des Textes, aus dem sie entstand (audio_hash/teaser_hash,
-- hashTexts([text]) aus lib/spot-hash.ts). Damit vertont der Admin nur, was fehlt oder
-- veraltet ist, statt bei jedem Klick ElevenLabs-Guthaben auszugeben. Die Stimme ist
-- BEWUSST NICHT Teil des Hashs, sondern der Schlüssel voice_id: Sonst würde eine geänderte
-- Einstellung (Sprechtempo in der ENV) 228 Dateien für veraltet erklären.

-- ── Die Stimmen ──────────────────────────────────────────────────────────────────────────
create table if not exists public.tts_voices (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,
  name            text not null,
  kind            text not null default 'synthetic'
                  check (kind in ('synthetic', 'cloned', 'human')),
  eleven_voice_id text check (eleven_voice_id is null or eleven_voice_id ~ '^[A-Za-z0-9]{10,40}$'),
  person_name     text,
  is_default      boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Geklont oder echt aufgenommen heißt: Es gibt eine Person, die im Player genannt wird.
  check (kind = 'synthetic' or person_name is not null),
  -- Eine echte Aufnahme hat keine ElevenLabs-Stimme.
  check (kind <> 'human' or eleven_voice_id is null)
);
comment on table  public.tts_voices is 'Stimmen der Audio-Runden (ElevenLabs). Admin-only; Voice-IDs verlassen den Server nie, der Player bekommt nur name/kind/person_name.';
comment on column public.tts_voices.key is 'Stabiler Slug (toni, simon), beim Anlegen aus dem Namen. Steht im Dateinamen der MP3s.';
comment on column public.tts_voices.kind is 'synthetic = Kunststimme · cloned = KI-Kopie einer echten Person (Art. 50(4) AI Act, Offenlegung mit Namen, docs/39) · human = echte Aufnahme, keine KI.';
comment on column public.tts_voices.eleven_voice_id is 'ElevenLabs Voice-ID. NULL nur als Brücke beim Standard: dann gilt noch ELEVENLABS_VOICE_ID aus der ENV, bis die ID im Admin steht.';
comment on column public.tts_voices.person_name is 'Name in der Offenlegung ("Die Stimme von Simon, per KI gesprochen"). Pflicht bei cloned/human.';
comment on column public.tts_voices.is_default is 'Vorbelegung für neue Runden und Stimme der KI-Runden bei Gleichstand. Höchstens eine (Partial-Unique-Index).';

create unique index if not exists tts_voices_single_default
  on public.tts_voices (is_default) where is_default;

drop trigger if exists tts_voices_set_updated_at on public.tts_voices;
create trigger tts_voices_set_updated_at before update on public.tts_voices
  for each row execute function public.set_updated_at();

alter table public.tts_voices enable row level security;
-- KEIN public read: Die Voice-IDs sind zwar ohne API-Key wertlos, gehören aber trotzdem
-- nicht ins Netz. Der Player liest name/kind/person_name über den Service-Client.
drop policy if exists "tts_voices_admin_all" on public.tts_voices;
create policy "tts_voices_admin_all" on public.tts_voices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Die Erzählstimme von heute. Ihre ID kommt weiter aus der ENV, bis Anton sie unter
-- Einstellungen → Stimmen einträgt (die Seite belegt das Feld mit dem ENV-Wert vor).
insert into public.tts_voices (key, name, kind, is_default, sort_order)
  values ('toni', 'Toni', 'synthetic', true, 0)
  on conflict (key) do nothing;

-- ── Die Runde trägt ihre Stimme ──────────────────────────────────────────────────────────
alter table public.tours
  add column if not exists voice_id uuid references public.tts_voices (id) on delete restrict;
-- Bestand: jede Runde sprach mit der ENV-Stimme, also Toni.
update public.tours
  set voice_id = (select id from public.tts_voices where key = 'toni')
  where voice_id is null;
-- NOT NULL, nicht "NULL heißt Standard": Ein späterer Wechsel des Standards würde sonst jede
-- Runde still umstellen, und im Admin stünde plötzlich überall "Dateien fehlen".
alter table public.tours alter column voice_id set not null;
create index if not exists tours_voice_idx on public.tours (voice_id);
comment on column public.tours.voice_id is 'Die EINE Stimme der Runde. Der Player liest nur Dateien dieser Stimme; Veröffentlichen verlangt sie für jede Station in allen Sprachen.';

-- ── Dateien je Punkt, Sprache und Stimme ─────────────────────────────────────────────────
create table if not exists public.tour_point_voice_files (
  id          uuid primary key default gen_random_uuid(),
  -- Direkter FK auf den Punkt, obwohl der zusammengesetzte unten ihn schon enthält:
  -- PostgREST kann von tour_points aus nur über einen direkten FK einbetten.
  point_id    uuid not null references public.tour_points (id) on delete cascade,
  lang        text not null,
  voice_id    uuid not null references public.tts_voices (id) on delete restrict,
  audio_url   text,
  audio_hash  text,
  teaser_url  text,
  teaser_hash text,
  tts_profile text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (point_id, lang, voice_id),
  -- Ohne Textzeile keine Datei: Der Text ist die Quelle, die Datei nur seine Aussprache.
  foreign key (point_id, lang) references public.tour_point_audio (point_id, lang) on delete cascade
);
comment on table  public.tour_point_voice_files is 'MP3-Pfade im privaten tour-audio-Bucket, je Punkt, Sprache und Stimme. Volldatei + Kostprobe. KEIN Public-Read (Pro-Ware).';
comment on column public.tour_point_voice_files.audio_url  is 'OBJEKT-PFAD der Volldatei im Bucket tour-audio (keine URL). Steht in scripts/lib/storage-refs.mjs, sonst löscht der Waisen-Sweep die Datei.';
comment on column public.tour_point_voice_files.audio_hash is 'hashTexts([audio_text]) zum Zeitpunkt der Vertonung. NULL = Altbestand oder manueller Upload, gilt als aktuell.';
comment on column public.tour_point_voice_files.teaser_url is 'OBJEKT-PFAD der Kostprobe (eigene Datei, kein Ausschnitt; lib/tour-audio-gate.ts). Ebenfalls in storage-refs.mjs.';
comment on column public.tour_point_voice_files.teaser_hash is 'hashTexts([teaser_text]) zum Zeitpunkt der Vertonung.';
comment on column public.tour_point_voice_files.tts_profile is 'Modell|Settings|ElevenLabs-ID bei der Erzeugung, nur zur Information. Nie eine Veraltet-Regel.';

create index if not exists tour_point_voice_files_voice_idx on public.tour_point_voice_files (voice_id);

drop trigger if exists tour_point_voice_files_set_updated_at on public.tour_point_voice_files;
create trigger tour_point_voice_files_set_updated_at before update on public.tour_point_voice_files
  for each row execute function public.set_updated_at();

alter table public.tour_point_voice_files enable row level security;
drop policy if exists "tour_point_voice_files_admin_all" on public.tour_point_voice_files;
create policy "tour_point_voice_files_admin_all" on public.tour_point_voice_files
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Bestand übernehmen ───────────────────────────────────────────────────────────────────
-- Alles, was bisher vertont wurde, sprach mit der ENV-Stimme, also Toni. Ohne diesen
-- Backfill hielte "Prüfen" an der Runde alle 228 Dateien für fehlend und würde sie
-- kostenpflichtig neu erzeugen. Die Hashes bleiben NULL (Altbestand, gilt als aktuell);
-- scripts/tts-backfill-hashes.ts trägt sie aus dem aktuellen Text nach.
insert into public.tour_point_voice_files (point_id, lang, voice_id, audio_url, teaser_url)
select a.point_id, a.lang, (select id from public.tts_voices where key = 'toni'), a.audio_url, a.teaser_url
from public.tour_point_audio a
where a.audio_url is not null or a.teaser_url is not null
on conflict (point_id, lang, voice_id) do nothing;

-- Die alten Pfadspalten bleiben bis 0069 stehen (Rückweg, falls etwas schiefgeht). Der
-- Waisen-Sammler liest beide; die App liest nur noch die neue Tabelle.
comment on column public.tour_point_audio.audio_url  is 'VERALTET seit 0068: Dateien stehen in tour_point_voice_files. Bis 0069 nur noch vom Waisen-Sammler gelesen.';
comment on column public.tour_point_audio.teaser_url is 'VERALTET seit 0068: Dateien stehen in tour_point_voice_files. Bis 0069 nur noch vom Waisen-Sammler gelesen.';
