-- ============================================================================
-- SalzGuide — Migration 0060: Kuratierte Runden in ALLEN Sprachen
--
-- WARUM: Titel, Untertitel und Beschreibung einer kuratierten Runde gab es bisher
-- nur auf Deutsch und Englisch, obwohl die Stationen derselben Runde (tour_points)
-- längst in allen neun Sprachen stehen. Ein Gast auf /it sah damit italienische
-- Stationen unter einem deutschen Runden-Titel.
--
-- Die Sprach-Zeilen selbst brauchen kein Schema: tour_translations ist bereits
-- eine Zeile je (tour_id, lang). Es fehlt nur die Aktualitäts-Marke, die Spots,
-- Punkte und Gebiete seit 0031 haben: der Hash der deutschen Quelltexte, aus denen
-- übersetzt wurde. Ändert sich Deutsch, weicht der Hash ab -> der Admin sieht
-- „veraltet" und wird zum Neu-Übersetzen aufgefordert.
--
-- Idempotent, sprachneutral, kein Datenverlust.
-- ============================================================================

alter table public.tour_translations
  add column if not exists source_hash text;

comment on column public.tour_translations.source_hash is
  'Hash der deutschen Quelltexte (src/lib/spot-hash.ts), aus denen diese Übersetzung erzeugt wurde. Weicht er vom aktuellen DE-Hash ab, ist die Übersetzung veraltet.';
