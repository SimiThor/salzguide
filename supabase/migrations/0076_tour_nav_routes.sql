-- Gespeicherte Navigationsrouten der Runden (Offline-Paket der App, docs/42).
-- Additiv: eine neue Tabelle, kein Datenverlust, wiederholbar (if not exists).
--
-- ── Warum es diese Tabelle gibt ─────────────────────────────────────────────────────────
--
-- Die Mapbox Product Terms (2.10.1) verbieten, Ergebnisse von Directions, Optimization und
-- Map Matching zu speichern oder auszuliefern. Deshalb kommen Linie und Abbiegeschritte seit
-- docs/42 aus unserem eigenen BRouter auf OpenStreetMap-Daten (ODbL). Diese Ergebnisse
-- gehören uns und dürfen gespeichert und offline ausgeliefert werden (Hinweis
-- "© OpenStreetMap-Mitwirkende" beim Anzeigen). In dieser Tabelle steht NIE etwas von
-- Mapbox und nie das Rohformat von BRouter: nur unsere Linie, unsere Schritte, Profil und
-- Quelle.
--
-- ── Was eine Zeile ist ──────────────────────────────────────────────────────────────────
--
-- Eine Route einer Runde, gerechnet ab dem TOUR-START (Start, Stopps, Wegpunkte, Ziel; Profil
-- nach tours.mode). route_hash ist tourRouteHash (lib/tour-route.ts), die
-- Formel von tours.route_hash, aber über die VERÖFFENTLICHTE Kette, nicht zwingend derselbe
-- Wert: ändert sich die Kette der Runde, gibt es eine neue Zeile, die alte
-- wird vom Server entfernt. Die wöchentlich frischen Wegdaten ändern eine gespeicherte
-- Zeile NICHT still.
--
-- lang: Die Schritte tragen keinen Text (der entsteht erst in der App aus den Sprachdateien),
-- eine Zeile gilt deshalb für alle Sprachen und steht unter 'und' (undefiniert). Die Spalte
-- bleibt Teil des Schlüssels, damit eine spätere Fassung mit Text ohne Migration möglich ist.
--
-- steps:     RouteStep[] (lib/routing/types.ts), sprachneutral.
-- via_along: { stopAlongM: number[], viaAlongM: { [viaId]: number } }, die Stellen der
--            veröffentlichten Stopps und der Wegpunkte auf der Linie, in Metern ab Start.
-- source:    { provider, profile, engine, data, attribution, computedAt }.
-- length_m:  Länge der gespeicherten Linie in Metern.
--
-- ── Zugriff ─────────────────────────────────────────────────────────────────────────────
--
-- RLS an, KEINE Richtlinie, Rechte für anon und authenticated entzogen: Gelesen und
-- geschrieben wird nur mit dem Service-Key. Die App bekommt die Daten ausschliesslich über
-- GET /api/app/v1/tours/{slug}/package, mit der Sicht des Betrachters.
create table if not exists public.tour_nav_routes (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references public.tours (id) on delete cascade,
  lang        text not null default 'und',
  route_hash  text not null,
  profile     text not null,
  source      jsonb not null,
  geometry    jsonb not null,
  steps       jsonb not null,
  via_along   jsonb not null,
  length_m    integer not null check (length_m >= 0),
  created_at  timestamptz not null default now(),
  unique (tour_id, lang, route_hash)
);

comment on table public.tour_nav_routes is
  'Navigationsroute einer Runde ab dem Tour-Start (BRouter, OpenStreetMap ODbL; nie Mapbox). Nur der Server liest und schreibt (Service-Key); die App bekommt sie über /api/app/v1/tours/{slug}/package.';

alter table public.tour_nav_routes enable row level security;

-- Absichtlich keine Richtlinie: Ohne Richtlinie ist alles verboten, was nicht ausdrücklich
-- erlaubt ist. Dazu die Tabellenrechte entziehen (Gürtel und Hosenträger): Die
-- Supabase-Voreinstellung gibt anon/authenticated sonst alle Rechte auf neue Tabellen, und
-- eine später versehentlich ergänzte Richtlinie würde sofort greifen.
revoke all on public.tour_nav_routes from anon, authenticated;
