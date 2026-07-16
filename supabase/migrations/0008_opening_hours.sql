-- Öffnungszeiten: Modus wählbar je Spot.
--   opening_hours_manual = false (Default) -> via google_place_id (Google Places, gecacht)
--   opening_hours_manual = true            -> manuell gepflegte Zeiten in opening_hours (jsonb)
--
-- Format opening_hours (nur im manuellen Modus):
--   { "days": [ { "closed": false, "ranges": [ { "open": "09:00", "close": "18:00" } ] }, ... ] }
--   Genau 7 Einträge, Index 0 = Montag … 6 = Sonntag. "ranges" leer/[] = keine Angabe.

alter table public.spots
  add column if not exists opening_hours_manual boolean not null default false,
  add column if not exists opening_hours jsonb;

comment on column public.spots.opening_hours_manual is
  'true = Zeiten manuell in opening_hours gepflegt; false = via google_place_id (Google Places)';
comment on column public.spots.opening_hours is
  'Manuelle Öffnungszeiten (Mo..So): { "days": [ {"closed":bool,"ranges":[{"open":"HH:MM","close":"HH:MM"}]} ] }';
