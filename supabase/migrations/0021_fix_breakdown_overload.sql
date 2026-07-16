-- Fix (docs/34 §H): Beim v3-Upgrade (0020) wurde analytics_breakdown mit einer
-- ERWEITERTEN Signatur (Filter-Parameter) per CREATE OR REPLACE angelegt. Die ALTE
-- 4-Argument-Version aus 0019 blieb dabei als separates Overload bestehen. Folge:
-- PostgREST kann bei einem 4-Key-Aufruf nicht zwischen alt (4 Args) und neu
-- (9 Args mit Defaults) wählen -> Fehler PGRST203 (ambiguous function). Beim Live-
-- Test aufgefallen. Fix: die alte Signatur entfernen -> nur die neue bleibt übrig,
-- 4-Key- UND 9-Key-Aufrufe matchen dann eindeutig die neue Funktion.
drop function if exists public.analytics_breakdown(text, timestamptz, timestamptz, int);
