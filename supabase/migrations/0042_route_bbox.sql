-- 0042: Bounding-Box der Wanderroute als generierte Spalte.
--
-- Warum: Die Explore-Seite braucht pro Spot nur vier Zahlen (den Ausschnitt, auf den
-- die Karte beim Antippen zoomt), hat dafür aber bisher route_geojson ALLER Spots aus
-- der DB geholt, die Box in JS gerechnet und die Geometrie weggeworfen. Bei 8 Spots
-- sind das 20 KB und 9ms — bei den geplanten 100-200 Spots wäre es rund 1 MB pro
-- Seitenaufruf. Postgres rechnet die Box jetzt einmal beim Schreiben.
--
-- Generiert statt normaler Spalte + Trigger: Die Box kann so nie veralten und der
-- Schreibpfad (admin-actions) muss nichts davon wissen.
-- ACHTUNG: Ein späteres `create or replace` der Funktion rechnet BESTEHENDE Zeilen
-- NICHT neu. Ändert sich die Logik, muss die Spalte neu aufgebaut werden (siehe unten).

-- Reine Funktion von route_geojson -> [minLng, minLat, maxLng, maxLat].
-- Muss immutable sein, sonst lässt Postgres sie nicht in eine generierte Spalte.
-- Spiegelt bewusst 1:1 die alte JS-Fassung (routeBBox in src/lib/spots.ts):
--   - nur LineString mit mindestens 2 Punkten
--   - Einträge, die keine Zahlen sind, werden übersprungen
--   - bleibt nichts Brauchbares übrig -> NULL
-- jsonb und nicht double precision[]: Ein Postgres-Array kommt über PostgREST je nach
-- Weg auch als Textform „{1,2,3,4}" an, jsonb ist immer ein echtes JSON-Array. Passt
-- außerdem zu route_geojson, das schon jsonb ist.
create or replace function public.sg_route_bbox(rg jsonb)
returns jsonb
language sql
immutable
strict
parallel safe
as $$
  select case
           when count(*) > 0 then jsonb_build_array(
             min((c->>0)::double precision),
             min((c->>1)::double precision),
             max((c->>0)::double precision),
             max((c->>1)::double precision)
           )
         end
  from jsonb_array_elements(
         case
           when rg->>'type' = 'LineString'
            and jsonb_typeof(rg->'coordinates') = 'array'
            and jsonb_array_length(rg->'coordinates') >= 2
           then rg->'coordinates'
           else '[]'::jsonb
         end
       ) as c
  where jsonb_typeof(c->0) = 'number'
    and jsonb_typeof(c->1) = 'number';
$$;

comment on function public.sg_route_bbox(jsonb) is
  'Bounding-Box [minLng,minLat,maxLng,maxLat] eines LineString-GeoJSON; NULL wenn keine gültige Linie. Trägt spots.route_bbox.';

alter table public.spots
  add column if not exists route_bbox jsonb
    generated always as (public.sg_route_bbox(route_geojson)) stored;

comment on column public.spots.route_bbox is
  'Automatisch aus route_geojson: [minLng,minLat,maxLng,maxLat]. Damit die Explore-Abfrage die Geometrie nicht mehr anfassen muss. Nicht beschreibbar.';

-- Wenn sich sg_route_bbox jemals ändert, rechnen bestehende Zeilen NICHT nach.
-- Dann diese zwei Zeilen als eigene Migration nachziehen:
--   alter table public.spots drop column route_bbox;
--   alter table public.spots add column route_bbox jsonb
--     generated always as (public.sg_route_bbox(route_geojson)) stored;
