-- 0043: Zusätzliche Karten-Punkte pro Spot — Wasserstellen und Hütten.
--
-- Wie route_waypoints (0005) reine jsonb-Arrays, hier aber Objekte mit optionalem
-- Namen: [{ "lng": 13.1, "lat": 47.8, "name": "Stögeralm" }, ...]. Der Admin setzt sie
-- auf der Karte (mehrere je Spot möglich); auf der User-Karte erscheinen sie als
-- Symbole wie Start/Ziel, der Name beim Antippen.
--
-- Nur additive Spalten -> keine Policy-Änderung nötig. RLS auf spots ist zeilen-, nicht
-- spaltenbasiert (0001/0017); admin schreibt über spots_admin_all, veröffentlichte
-- Nicht-Pro-Zeilen bleiben öffentlich lesbar. Für gesperrte Pro-Spots werden die Punkte
-- zusätzlich serverseitig in getSpotDetail genullt (App-Ebene, wie die übrigen Standorte).
alter table public.spots
  add column if not exists water_stops jsonb,
  add column if not exists huts jsonb;

comment on column public.spots.water_stops is
  'Wasserstellen entlang der Route: [{lng,lat,name?}, ...]. Vom Admin gesetzt, auf der Karte als 💧 dargestellt.';
comment on column public.spots.huts is
  'Hütten entlang der Route: [{lng,lat,name?}, ...]. Vom Admin gesetzt, auf der Karte als 🛖 dargestellt.';
