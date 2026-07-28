-- ============================================================================
-- SalzGuide — Migration 0061: Start, Ziel und echte Geh-Route je kuratierter Runde
--
-- WARUM: Die KI-gebauten Runden (user_tours, 0028) haben längst beides — einen
-- fixen Startpunkt und eine an echte Wege gesnappte Linie (Mapbox Walking). Die
-- KURATIERTEN Runden hatten nur eine Liste von Stationen; die Karte zog deshalb
-- gerade Luftlinien quer über Häuserblöcke.
--
-- Ab jetzt setzt der Admin Start und Ziel selbst (Rundweg = beides derselbe Punkt)
-- und lässt die Linie einmal an die Wege anpassen. Das Ergebnis wird gecacht:
--   route_geo  = [lng,lat][] der gesnappten Geh-Route (wie user_tours.route_geo)
--   route_hash = Marke, aus welchem Stand sie gerechnet wurde (Start + Stationen +
--                Ziel). Weicht sie ab, ist die Route veraltet — dasselbe Muster wie
--                source_hash bei den Übersetzungen (0031/0060).
--
-- start_spot_id/end_spot_id aus 0024 bleiben unangetastet: Sie zeigen auf `spots`
-- und stammen aus dem alten Modell (Stop = Spot). Stationen sind heute Pool-Punkte,
-- und Start/Ziel sind freie Koordinaten, keine Spots.
--
-- Idempotent, kein Datenverlust.
-- ============================================================================

alter table public.tours
  add column if not exists start_lat   double precision,
  add column if not exists start_lng   double precision,
  add column if not exists end_lat     double precision,
  add column if not exists end_lng     double precision,
  add column if not exists route_geo   jsonb,
  add column if not exists route_hash  text;

comment on column public.tours.start_lat is
  'Startpunkt der Runde (frei gesetzt, nicht zwingend eine Station). Ohne Wert startet die Runde an der ersten Station.';
comment on column public.tours.end_lat is
  'Ziel der Runde. Gleich dem Start = Rundweg. Ohne Wert endet die Runde an der letzten Station.';
comment on column public.tours.route_geo is
  '[lng,lat][] der an Fusswege gesnappten Geh-Route (Mapbox Walking), gecacht wie user_tours.route_geo.';
comment on column public.tours.route_hash is
  'Stand, aus dem route_geo gerechnet wurde (Start + Stations-Reihenfolge + Ziel). Weicht er ab, ist die Route veraltet.';
