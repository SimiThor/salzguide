-- ═══════════════════════════════════════════════════════════════════════════════════════
--  0069: Sprech-Einstellungen JE STIMME (Stabilität, Ähnlichkeit, Stil, Tempo, Boost).
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- WARUM: Bis hierher schickte lib/tts.ts fuer JEDE Stimme dieselben Werte mit (Tempo 0,9,
-- Stabilitaet 0,55; einst fuer Tonis Erzaehlton gewaehlt, ueber ENV ueberschreibbar, aber
-- nirgends gesetzt). ElevenLabs im Web nimmt dagegen je Stimme deren eigene Empfehlung. Bei
-- Simons Klon klang der Rhythmus deshalb bei uns weniger nach Simon als in ElevenLabs
-- direkt (15.09.2026). Die Werte gehoeren zur Stimme, also in ihre Zeile.
--
-- Bestehende Stimmen behalten, was sie bisher bekamen (Toni: 0,55 / 0,75 / 0 / 0,9 / an),
-- damit der vertonte Bestand und neue Toni-Dateien gleich klingen. Neue Stimmen starten mit
-- den ElevenLabs-Standardwerten (0,5 / 0,75 / 0 / 1,0 / an).
--
-- Das Entfernen der alten Pfadspalten auf tour_point_audio (in 0068 als "0069" angekuendigt)
-- rueckt damit auf 0070.

alter table public.tts_voices
  add column if not exists stability     real    not null default 0.5  check (stability  between 0 and 1),
  add column if not exists similarity    real    not null default 0.75 check (similarity between 0 and 1),
  add column if not exists style         real    not null default 0    check (style      between 0 and 1),
  add column if not exists speed         real    not null default 1.0  check (speed      between 0.7 and 1.2),
  add column if not exists speaker_boost boolean not null default true;

comment on column public.tts_voices.stability     is 'ElevenLabs voice_settings.stability (0..1). Niedrig = lebendiger, hoch = gleichmaessiger.';
comment on column public.tts_voices.similarity    is 'ElevenLabs voice_settings.similarity_boost (0..1). Wie eng an der Vorlage; bei Klonen entscheidend.';
comment on column public.tts_voices.style         is 'ElevenLabs voice_settings.style (0..1). Ausdruck; kostet Stabilitaet, ElevenLabs empfiehlt 0.';
comment on column public.tts_voices.speed         is 'ElevenLabs voice_settings.speed (0,7..1,2). 1,0 = natuerliches Tempo der Stimme.';
comment on column public.tts_voices.speaker_boost is 'ElevenLabs voice_settings.use_speaker_boost.';

-- Toni behaelt die Werte, mit denen der gesamte Bestand vertont wurde.
update public.tts_voices
  set stability = 0.55, similarity = 0.75, style = 0, speed = 0.9, speaker_boost = true
  where key = 'toni';
