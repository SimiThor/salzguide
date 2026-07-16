-- ============================================================================
-- SalzGuide — Migration 0032: Events mehrsprachig (N Sprachen)
-- Ersetzt die 2-Sprachen-Spalten title_en/description_en durch eine JSONB-Spalte
-- `translations` (locale -> {title, description}, wie categories.title_translations).
-- Deutsch bleibt in title/description (Basis). source_hash = Aktualitäts-Marke.
-- Alte EN-Texte werden nach translations.en migriert. Idempotent; alte Spalten bleiben.
-- ============================================================================

alter table public.events
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.events
  add column if not exists source_hash text;

-- Bestehende englische Texte nach translations.en übernehmen (nur wo vorhanden).
update public.events
set translations = jsonb_build_object(
  'en', jsonb_strip_nulls(jsonb_build_object('title', title_en, 'description', description_en))
)
where (title_en is not null or description_en is not null)
  and (translations = '{}'::jsonb or translations is null);
