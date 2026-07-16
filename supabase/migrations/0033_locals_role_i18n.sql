-- ============================================================================
-- SalzGuide — Migration 0033: Mehrsprachige Local-Rolle
-- Die Rolle eines Locals (z.B. „Local aus Salzburg") soll in ALLEN Sprachen
-- angezeigt werden. Name + Foto sind sprachneutral und bleiben unverändert.
-- role bleibt die deutsche Basis (Rückwärtskompatibilität); role_i18n hält die
-- Übersetzungen je Locale ({ "en": "Local from Salzburg", ... }). Idempotent.
-- ============================================================================

alter table public.locals
  add column if not exists role_i18n jsonb not null default '{}'::jsonb;
