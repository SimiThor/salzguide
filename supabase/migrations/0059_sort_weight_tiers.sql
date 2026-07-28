-- Gewichtungs-Stufen statt freier Zahlen (Konzept: docs/38).
--
-- WARUM: Ein freies Zahlenfeld heisst bei 100 Spots, 100 Zahlen gegeneinander abzuwägen —
-- das kann niemand im Kopf halten, und weil JEDES Explore-Regal nach derselben Zahl
-- sortiert, steht der stärkste Spot in jedem seiner Regale auf Platz 1 (das
-- "Hochkeil zweimal ganz oben"-Problem).
--
-- Ab jetzt hat ein Spot eine von vier Stufen, die für sich allein vergeben wird
-- ("wie gut ist DIESER Spot?", nicht "besser als welche 99 anderen?"):
--
--   3 = Highlight       (das Beste vom Land, darf vorne stehen)
--   2 = Stark           (sehr gut, vordere Hälfte)
--   1 = Normal          (Standard für jeden guten Spot; neuer Default)
--   0 = Zurückhaltend   (füllt Regale auf, steht hinten)
--
-- Die Reihenfolge JE Regal rechnet der Server daraus (src/lib/explore-ranking.ts) und
-- sorgt dabei für Abwechslung zwischen den Regalen. Die Stufen wohnen bewusst weiter in
-- sort_weight: Alle bestehenden Sortierungen (Admin-Listen, Gespeichert-Seite, Toni)
-- funktionieren unverändert, es entsteht keine zweite, fast gleiche Spalte.

-- 1) Alt-Werte in die Stufen 1..3 einteilen: dense_rank über die vorhandenen Werte,
--    linear skaliert (höchster Alt-Wert -> 3, niedrigster -> 1). Gleiche Alt-Werte
--    bleiben gleich, die grobe Reihenfolge bleibt erhalten. Bewusst NICHT bis 0:
--    "Zurückhaltend" ist eine bewusste Abwertung, die bisher niemand ausgedrückt hat —
--    die soll ein Admin vergeben, nicht eine Migration erraten.
with n as (
  select count(distinct sort_weight)::numeric as cnt from public.spots
), ranks as (
  select id, dense_rank() over (order by sort_weight) as r
  from public.spots
)
update public.spots s
set sort_weight = case
  when (select cnt from n) <= 1 then 1
  else 1 + round((ranks.r - 1) * 2 / ((select cnt from n) - 1))::int
end
from ranks
where ranks.id = s.id;

-- 2) Neue Spots starten auf Normal, und die Spalte kennt nur noch die vier Stufen.
--    Der Constraint ist die Linie, die auch hält, wenn eine Schreibstelle das Klemmen
--    auf 0..3 vergisst (saveSpot klemmt zusätzlich clientseitig).
alter table public.spots alter column sort_weight set default 1;
alter table public.spots
  add constraint spots_sort_weight_tier check (sort_weight between 0 and 3);
comment on column public.spots.sort_weight is
  'Gewichtungs-Stufe: 3 Highlight, 2 Stark, 1 Normal, 0 Zurückhaltend (docs/38)';
