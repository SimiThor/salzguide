-- ============================================================================
-- SalzGuide — Migration 0031: Übersetzungs-Aktualität (Anti-Chaos)
-- Speichert je Übersetzung den Hash der deutschen Quelltexte, aus denen sie erzeugt
-- wurde. Ändert sich Deutsch, weicht der Hash ab -> Admin sieht „veraltet" und wird
-- zum Neu-Übersetzen aufgefordert. Sprachneutral, idempotent.
-- ============================================================================

alter table public.spot_translations
  add column if not exists source_hash text;

alter table public.tour_point_translations
  add column if not exists source_hash text;

alter table public.tour_area_translations
  add column if not exists source_hash text;
-- event_translations bekommt source_hash direkt bei seiner Erstellung (Events-Migration).
