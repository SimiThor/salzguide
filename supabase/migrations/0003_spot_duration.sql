-- ============================================================================
-- SalzGuide — Migration 0003: Dauer/Zeit als Quick-Fact (Aktiv-Spots)
-- 4. Quick-Fact für Aktiv-Spots (docs/11: ⏱ Zeit/Dauer). Idempotent.
-- Im SQL-Editor ausführen.
-- ============================================================================

alter table public.spots
  add column if not exists duration text; -- Anzeige-String, z.B. "~1 Std", "1–2 Std"
