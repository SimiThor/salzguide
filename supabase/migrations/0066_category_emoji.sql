-- Ein Emoji je Kategorie, fuer die Filter-Pillen ueber der Explore-Karte.
--
-- WARUM EINE SPALTE UND NICHT IM TITEL: Bisher stand das einzige Kategorie-Emoji mitten
-- im Text ("Favoriten unserer Community ❤️") und damit dreizehnmal, in jeder Sprache
-- einzeln. Wer es aendern wollte, musste alle Uebersetzungen anfassen, und eine Pille
-- kann ein Symbol nicht vom Titel trennen (Groesse, Abstand, Umbruch). Als eigene Spalte
-- ist es sprachunabhaengig, weil ein Emoji nicht uebersetzt wird.
--
-- ADDITIV UND NULLABLE, aber trotzdem VOR dem Code-Deploy einspielen: Der Lese-Select in
-- lib/spots.ts nennt die Spalte explizit; fehlt sie, liefert Supabase einen Fehler und
-- die Explore-Karte faellt still auf leere Listen zurueck (Regel "Migration vor den Code").
alter table public.categories
  add column if not exists emoji text;

comment on column public.categories.emoji is
  'Symbol der Kategorie-Pille auf der Explore-Karte (CategoryFilterStrip.tsx). Sprachunabhaengig, im Admin aenderbar. null = Pille ohne Symbol.';

-- Startwerte fuer den Bestand. Bewusst nur Startwerte: Was am Ende dasteht, entscheidet
-- der Admin. Der Schluessel `key` ist nur je Saison eindeutig ('food' gibt es zweimal),
-- deshalb steht die Saison in jeder Bedingung mit drin.
update public.categories set emoji = '❤️'  where season = 'summer' and key = 'favs';
update public.categories set emoji = '🥾'  where season = 'summer' and key = 'hike-ez';
update public.categories set emoji = '💧'  where season = 'summer' and key = 'lakes';
update public.categories set emoji = '🍽️' where season = 'summer' and key = 'food';
update public.categories set emoji = '🌳'  where season = 'summer' and key = 'hills';
update public.categories set emoji = '📸'  where season = 'summer' and key = 'sights';
update public.categories set emoji = '🏞️' where season = 'summer' and key = 'gorges';
update public.categories set emoji = '🚗'  where season = 'summer' and key = 'roads';
update public.categories set emoji = '⛰️'  where season = 'summer' and key = 'hike-hard';
update public.categories set emoji = '☕️' where season = 'winter' and key = 'food';
update public.categories set emoji = '♨️'  where season = 'winter' and key = 'view';
update public.categories set emoji = '🚠'  where season = 'winter' and key = 'action';
