-- ═══════════════════════════════════════════════════════════════════════════════════════
--  0070: Sprechfassung je Text. Ziffern im Transkript, Woerter fuer die Stimme.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- WARUM: ElevenLabs liest Jahreszahlen falsch vor ("1945" wird nicht
-- "neunzehnhundertfuenfundvierzig"), in jeder Stimme, und der Sprach-Parameter, der dem
-- Normalisierer helfen wuerde, gilt fuer unser Modell nicht. ElevenLabs empfiehlt fuer diesen
-- Fall selbst, den Text vorher per LLM in eine vorlesbare Form zu bringen. Genau das steht
-- hier: `audio_text` bleibt die geschriebene Fassung mit Ziffern (Transkript im Player,
-- Editor), `audio_spoken` ist die gesprochene Fassung (Zahlen, Daten, Einheiten,
-- Abkuerzungen ausgeschrieben, wie man sie in der Sprache spricht), und NUR die geht an
-- ElevenLabs (lib/spoken-text.ts, aufgerufen aus lib/tts-files.ts).
--
-- Die Marke haelt fest, aus welchem Textstand (und welcher Prompt-Fassung) die Sprechfassung
-- entstand: Nur wenn sie passt, wird sie wiederverwendet, sonst einmal neu erzeugt. Kein
-- LLM-Aufruf fuer einen Text, der sich nicht geaendert hat.
--
-- Das Entfernen der alten Pfadspalten (in 0068/0069 angekuendigt) rueckt auf 0071.

alter table public.tour_point_audio
  add column if not exists audio_spoken       text,
  add column if not exists audio_spoken_hash  text,
  add column if not exists teaser_spoken      text,
  add column if not exists teaser_spoken_hash text;

comment on column public.tour_point_audio.audio_spoken       is 'Sprechfassung von audio_text (Zahlen/Daten/Einheiten ausgeschrieben). Geht an ElevenLabs; nie im Player anzeigen.';
comment on column public.tour_point_audio.audio_spoken_hash  is 'hashTexts([SPOKEN_PROMPT_VERSION, audio_text]) zum Zeitpunkt der Erzeugung (lib/spoken-rules.ts).';
comment on column public.tour_point_audio.teaser_spoken      is 'Sprechfassung von teaser_text (Kostprobe).';
comment on column public.tour_point_audio.teaser_spoken_hash is 'Marke wie audio_spoken_hash, fuer teaser_text.';
