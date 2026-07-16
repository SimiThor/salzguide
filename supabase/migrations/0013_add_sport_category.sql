-- ============================================================================
-- SalzGuide — Kategorie „Sport" zum Event-Enum hinzufügen.
-- WICHTIG: ALTER TYPE ... ADD VALUE muss ALLEIN (außerhalb einer Transaktion)
-- laufen -> deshalb eine EIGENE Migration. Erst DIESE ausführen, DANN 0014.
-- Idempotent (IF NOT EXISTS). Im Supabase SQL-Editor ausführen.
-- ============================================================================

alter type event_category add value if not exists 'sport';
