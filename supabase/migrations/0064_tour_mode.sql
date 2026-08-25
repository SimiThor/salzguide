-- ============================================================================
-- SalzGuide, Migration 0064: Fortbewegungsart je kuratierter Runde
--
-- WARUM: Der Rad-Audioguide hat einen eigenen Navigations-Screen (docs/40), und
-- der wird nur ausgeliefert, wenn `mode === "bike"` ist. Bisher gab es dafür keine
-- Spalte: `lib/tours.ts` hat an zwei Stellen hart `mode: "walk"` zurückgegeben, und
-- die EINZIGE Runde, die je "bike" war, ist die fest verdrahtete Testrunde in
-- `lib/test-sbike-tour.ts`, ohne DB-Zeile, nur über einen Footer-Link erreichbar.
--
-- Damit war der Testhaken nicht entfernbar: Eine echte Rad-Runde in der Datenbank
-- konnte es nicht geben, weil die Datenbank die Frage „Rad oder zu Fuß" gar nicht
-- stellen konnte. Genau das steht am Ende von docs/40 als offener Punkt.
--
-- DEFAULT IST 'walk', und das ist wichtig: Alle bestehenden Runden sind Geh-Touren.
-- Die Spalte ändert an ihnen nichts, sie macht nur die zweite Antwort möglich.
--
-- Idempotent, kein Datenverlust.
-- ============================================================================

do $$ begin
  create type tour_mode as enum ('walk', 'bike');
exception when duplicate_object then null; end $$;

alter table public.tours
  add column if not exists mode tour_mode not null default 'walk';

comment on column public.tours.mode is
  'Fortbewegungsart: walk = Geh-Tour (Standard), bike = S-Bike-Runde mit permanenter Abbiege-Navigation (docs/40). Steuert, ob /touren/[slug]/navigation ausgeliefert wird.';

-- Der Navigations-Screen fragt beim Laden nach der Fortbewegungsart. Ohne Index
-- ist das bei der heutigen Zeilenzahl egal, aber die Liste filtert später danach
-- ("nur Radrunden"), und dann steht er schon.
create index if not exists tours_mode_idx on public.tours (mode);
