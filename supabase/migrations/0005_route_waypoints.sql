-- 0005: Wander-Wegpunkte (Kontrollpunkte) getrennt von der gezeichneten Linie.
-- route_waypoints = vom Admin gesetzte Punkte [[lng,lat], ...] (zum Nachbearbeiten/erneut Snappen)
-- route_geojson  = die anzuzeigende Linie (an echte Wanderwege gesnappt; sonst Luftlinie)
alter table public.spots
  add column if not exists route_waypoints jsonb;

comment on column public.spots.route_waypoints is
  'Vom Admin gesetzte Kontrollpunkte [[lng,lat],...]; route_geojson hält die (ggf. an Wanderwege gesnappte) Linie.';
