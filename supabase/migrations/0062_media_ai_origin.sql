-- KI-Herkunft je Spot-Foto (EU AI Act, Art. 50; Einstufung: docs/39_RECHT_KI-Transparenz.md).
-- null = ohne KI (Normalfall). 'generated' = mit KI erstellt, 'edited' = mit KI bearbeitet,
-- 'extended' = mit KI erweitert (z. B. Raender fuer Breitbild gestreckt).
--
-- ADDITIV UND NULLABLE, aber trotzdem VOR dem Code-Deploy einspielen: Die Lese-Selects
-- nennen die Spalte explizit; fehlt sie, liefert Supabase einen Fehler und die Anzeige
-- faellt still auf leere Listen zurueck (dieselbe Falle wie beim Explore-Karten-Vorfall,
-- siehe docs/38 bzw. Regel "Migration vor den Code").
--
-- Die Startseiten-Slots (home_content.media) brauchen KEINE Migration: jsonb, der Wert
-- wird in lib/landing-media.ts beim Lesen und Schreiben geprueft.
alter table public.media
  add column if not exists ai_origin text
  check (ai_origin is null or ai_origin in ('generated', 'edited', 'extended'));

comment on column public.media.ai_origin is
  'KI-Herkunft des Bilds: generated | edited | extended | null (ohne KI). Werte-Quelle: src/lib/ai-origin.ts; sichtbares Label: AiMedia.* in messages/*.json.';
