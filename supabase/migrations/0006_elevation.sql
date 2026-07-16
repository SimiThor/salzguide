-- 0006: Höhenprofil der Wanderung (nur Wanderwege).
-- { points: [{d: km, e: m}], ascent, descent, min, max, distanceKm }
alter table public.spots
  add column if not exists elevation_profile jsonb;

comment on column public.spots.elevation_profile is
  'Höhenprofil einer Wanderung: { points:[{d(km),e(m)}], ascent, descent, min, max, distanceKm }. Beim Snapping (ORS, elevation=true) befüllt.';
