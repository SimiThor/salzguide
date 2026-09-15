-- ============================================================================
-- SalzGuide, Migration 0071: Wegpunkte ohne Geschichte je kuratierter Runde
--
-- WARUM: Zwischen zwei Stationen entschied bisher allein Mapbox, welche Gasse oder
-- welcher Radweg genommen wird. Der Admin will den Verlauf steuern: um die
-- Fussgaengerzone herum (S-Bike drosselt dort den Motor, docs/40), ueber die Uferseite,
-- nicht durch den Tunnel. Der einzige Weg dahin war ein Pool-Punkt ohne Text als
-- Pseudo-Station, und der bekaeme im Player einen Play-Knopf ohne Geschichte.
--
-- Ab jetzt traegt die Runde ihre Wegpunkte selbst:
--   route_via = [{from, to, coords: [lng,lat][]}]
--   from/to   = 'start' | 'end' | tour_points.id, also der ABSCHNITT der Kette, zu dem
--               die Punkte gehoeren. Wird eine Station umsortiert oder entfernt, weiss
--               die Runde noch, wozu jeder Wegpunkt gehoerte (lib/tour-route.ts,
--               reconcileVia). Eine flache Liste mit Positionen wuesste das nicht.
--
-- Die Wegpunkte gehen als stille Zwischenpunkte in die Mapbox-Anfrage, im Editor und
-- in der Rad-Navigation (die ab der GPS-Position neu rechnet). Sie sind keine
-- Stationen: kein Audio, keine Nummer, im Player unsichtbar.
--
-- NACH DEM EINSPIELEN zeigen die bestehenden Runden einmal "Route veraltet": Die
-- Aktualitaets-Marke enthaelt jetzt Fortbewegung und Stations-Koordinaten, und die
-- Anfrage an Mapbox hat dieselbe Form wie die der Navigation (stille Wegpunkte). Einmal
-- "Route an die Wege anpassen" und speichern, fertig.
--
-- Der Rueckbau der alten Pfadspalten aus 0068 (tour_point_audio.audio_url/teaser_url)
-- rueckt damit auf 0072.
--
-- Idempotent, kein Datenverlust.
-- ============================================================================

alter table public.tours
  add column if not exists route_via jsonb;

comment on column public.tours.route_via is
  'Wegpunkte ohne Geschichte, je Abschnitt der Kette: [{from, to, coords: [lng,lat][]}], from/to = start | end | tour_points.id. Formen nur die Linie, sind keine Stationen (kein Audio, nicht im Player).';
