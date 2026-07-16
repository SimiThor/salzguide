-- ============================================================================
-- SalzGuide — Auftrag B: Seed (Kategorien + 5 Beispiel-Spots, DE+EN)
-- Quelle: docs/10 (Kategorien), docs/11/12/24 (Spots)
-- Idempotent: ON CONFLICT DO NOTHING. Nach 0001_init.sql ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Kategorien (Sommer: 8, Winter: 3) — Titel je de/en
-- ----------------------------------------------------------------------------
insert into public.categories (key, season, title_translations, sort_order) values
  ('favs',      'summer', '{"de":"Favoriten unserer Community ❤️","en":"Community Favorites ❤️"}', 1),
  ('hike-ez',   'summer', '{"de":"Wanderungen – Leicht & Mittel","en":"Hikes – Easy & Medium"}',  2),
  ('lakes',     'summer', '{"de":"Seen & Stege","en":"Lakes & Piers"}',                            3),
  ('food',      'summer', '{"de":"Food Spots","en":"Food Spots"}',                                 4),
  ('hills',     'summer', '{"de":"City & Nearby Hills","en":"City & Nearby Hills"}',               5),
  ('gorges',    'summer', '{"de":"Klammen & Wasserfälle","en":"Gorges & Waterfalls"}',             6),
  ('roads',     'summer', '{"de":"Panoramastraßen","en":"Scenic Roads"}',                          7),
  ('hike-hard', 'summer', '{"de":"Wanderungen – Anspruchsvoll","en":"Hikes – Challenging"}',       8),
  ('food',      'winter', '{"de":"Skihütten & Cafés","en":"Ski Huts & Cafés"}',                    1),
  ('view',      'winter', '{"de":"Aussicht & Erholung","en":"Views & Relaxation"}',                2),
  ('action',    'winter', '{"de":"Action & Bahnen","en":"Action & Lifts"}',                        3)
on conflict (key, season) do nothing;

-- ----------------------------------------------------------------------------
-- Spots (Stammdaten)
-- ----------------------------------------------------------------------------
insert into public.spots
  (slug, type, subtype, seasons, is_pro, status, sort_weight, emoji,
   lat, lng, parking_lat, parking_lng, transit_lat, transit_lng,
   difficulty, best_season, access, price_level, area, fame,
   loc, kids, bus, vibes, lake_name, has_opening_hours)
values
  ('aignerpark', 'activity', 'Spaziergang', '{summer}', false, 'published', 100, '🌳',
   47.7855, 13.0896, 47.78551, 13.08962, 47.78595, 13.08963,
   'leicht', 'Frühling–Herbst', 'beides', null, null, null,
   'stadt', true, true, '{wandern}', null, false),

  ('karaffu', 'food', 'Café', '{summer}', false, 'published', 90, '☕',
   47.8009, 13.0432, 47.8009, 13.0432, null, null,
   null, null, null, 'mittel', 'Stadt Salzburg', 'Hidden Gem',
   'stadt', false, true, '{}', null, true),

  ('fuschlsee', 'activity', 'See', '{summer}', false, 'published', 80, '🏊',
   47.7956, 13.2736, 47.7956, 13.2736, 47.7950, 13.2700,
   'leicht', 'Sommer', 'beides', null, null, null,
   'seen', true, true, '{wasser}', 'Fuschlsee', false),

  ('liechtensteinklamm', 'activity', 'Klamm', '{summer}', true, 'published', 70, '🏞️',
   47.3280, 13.1970, 47.3290, 13.1960, 47.3270, 13.1990,
   'mittel', 'Mai–Oktober', 'auto', null, null, null,
   'berge', true, false, '{wasser,wandern}', null, true),

  ('alpentherme-gastein', 'activity', 'Therme', '{winter}', false, 'published', 60, '♨️',
   47.1715, 13.0990, 47.1715, 13.0990, 47.1700, 13.1010,
   null, 'Ganzjährig', 'beides', null, 'Gastein', null,
   'berge', true, true, '{}', null, true)
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- Übersetzungen (DE + EN) — Brand-Voice, du-Form, Byline "Anton, Local"
-- ----------------------------------------------------------------------------

-- Aignerpark
insert into public.spot_translations
  (spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author)
select id, 'de', 'Aignerpark',
  'Ruhiger Stadtpark mit Teich und kurzem Waldweg.',
  'Der Aignerpark liegt am Stadtrand von Salzburg und ist perfekt für eine kurze Runde zwischen alten Bäumen. Ein kleiner Teich, schattige Wege und genug Platz zum Durchatmen – ohne weit rauszufahren.',
  'Geh früh am Morgen, dann hast du die Wege fast für dich. Oben am Hang gibts einen Blick über die Stadt, den kaum jemand kennt.',
  'Etwa 1 Stunde, leichte Runde. Gut auch mit Kinderwagen.',
  'Schön von Frühling bis Herbst, im Herbst besonders ruhig.',
  'Am südöstlichen Stadtrand. Mit dem Bus erreichbar, Parkplätze direkt am Eingang.',
  'Anton, Local'
from public.spots where slug = 'aignerpark'
on conflict (spot_id, lang) do nothing;

insert into public.spot_translations
  (spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author)
select id, 'en', 'Aignerpark',
  'Quiet city park with a pond and a short forest loop.',
  'Aignerpark sits at the edge of Salzburg and is perfect for a short loop among old trees. A small pond, shady paths and enough room to breathe – without driving far.',
  'Go early in the morning and the paths are almost yours. Up on the slope there is a view over the city that few people know.',
  'About 1 hour, easy loop. Stroller-friendly.',
  'Nice from spring to autumn, especially calm in fall.',
  'On the south-eastern edge of town. Reachable by bus, parking right at the entrance.',
  'Anton, Local'
from public.spots where slug = 'aignerpark'
on conflict (spot_id, lang) do nothing;

-- Karaffu (food: section_a = Küche & Stil, section_b = Preisniveau)
insert into public.spot_translations
  (spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author)
select id, 'de', 'Karaffu',
  'Kleiner Coffee Spot mit richtig gutem Espresso.',
  'Karaffu ist ein unaufgeregtes Café in der Stadt, in dem der Kaffee im Mittelpunkt steht. Specialty Coffee, ein paar Plätze, freundliche Leute – ideal für eine Pause zwischendurch.',
  'Frag nach dem Filterkaffee des Tages. Wenn der Pistazien-Snack da ist, nimm ihn.',
  'Specialty Coffee, klein und gemütlich.',
  'Mittleres Preisniveau, fair für die Qualität.',
  'Mitten in der Stadt Salzburg, gut zu Fuß oder mit dem Bus erreichbar.',
  'Anton, Local'
from public.spots where slug = 'karaffu'
on conflict (spot_id, lang) do nothing;

insert into public.spot_translations
  (spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author)
select id, 'en', 'Karaffu',
  'Small coffee spot with seriously good espresso.',
  'Karaffu is a laid-back café in town where the coffee is the point. Specialty coffee, a few seats, friendly people – ideal for a quick break.',
  'Ask for the filter coffee of the day. If the pistachio snack is in, grab it.',
  'Specialty coffee, small and cosy.',
  'Mid-range prices, fair for the quality.',
  'Right in the city of Salzburg, easy to reach on foot or by bus.',
  'Anton, Local'
from public.spots where slug = 'karaffu'
on conflict (spot_id, lang) do nothing;

-- Fuschlsee
insert into public.spot_translations
  (spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author)
select id, 'de', 'Fuschlsee',
  'Klarer See zum Schwimmen und Spazieren.',
  'Der Fuschlsee hat richtig klares Wasser und eine schöne Runde am Ufer. Im Sommer zum Schwimmen, sonst für einen entspannten Spaziergang mit Blick aufs Wasser.',
  'Das Ostufer ist ruhiger als der Ortsbereich. Nimm dir Zeit für die Uferrunde.',
  'Leichte Uferrunde, je nach Lust 1 bis 2 Stunden.',
  'Am besten im Sommer, klares Wasser auch im Frühherbst.',
  'Rund 20 Minuten von Salzburg. Mit Auto und Bus erreichbar.',
  'Anton, Local'
from public.spots where slug = 'fuschlsee'
on conflict (spot_id, lang) do nothing;

insert into public.spot_translations
  (spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author)
select id, 'en', 'Fuschlsee',
  'Clear lake for swimming and strolling.',
  'Fuschlsee has really clear water and a nice loop along the shore. Swim in summer, or take a relaxed walk with the water in view the rest of the year.',
  'The eastern shore is quieter than the village side. Take your time on the shore loop.',
  'Easy shore loop, 1 to 2 hours depending on your mood.',
  'Best in summer, clear water into early autumn too.',
  'About 20 minutes from Salzburg. Reachable by car and bus.',
  'Anton, Local'
from public.spots where slug = 'fuschlsee'
on conflict (spot_id, lang) do nothing;

-- Liechtensteinklamm (Pro)
insert into public.spot_translations
  (spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author)
select id, 'de', 'Liechtensteinklamm',
  'Enge Klamm mit tosendem Wasser und Steg.',
  'Die Liechtensteinklamm führt auf Stegen tief in eine enge Schlucht hinein. Das Wasser donnert neben dir, die Felswände rücken eng zusammen – ein kurzes, intensives Erlebnis.',
  'Geh unter der Woche und am Vormittag, dann ist weniger los auf den schmalen Stegen.',
  'Etwa 1 bis 1,5 Stunden hin und zurück, mittel. Festes Schuhwerk.',
  'Geöffnet von Mai bis Oktober, im Hochsommer am vollsten.',
  'Bei St. Johann im Pongau. Am besten mit dem Auto zum Parkplatz.',
  'Anton, Local'
from public.spots where slug = 'liechtensteinklamm'
on conflict (spot_id, lang) do nothing;

insert into public.spot_translations
  (spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author)
select id, 'en', 'Liechtensteinklamm',
  'Narrow gorge with roaring water and walkways.',
  'The Liechtensteinklamm takes you on walkways deep into a narrow gorge. The water roars beside you, the rock walls close in – a short, intense experience.',
  'Go midweek and in the morning for fewer people on the narrow walkways.',
  'About 1 to 1.5 hours round trip, medium. Wear sturdy shoes.',
  'Open from May to October, busiest in high summer.',
  'Near St. Johann im Pongau. Best reached by car to the car park.',
  'Anton, Local'
from public.spots where slug = 'liechtensteinklamm'
on conflict (spot_id, lang) do nothing;

-- Alpentherme Gastein (Winter)
insert into public.spot_translations
  (spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author)
select id, 'de', 'Alpentherme Gastein',
  'Große Therme zum Aufwärmen nach dem Skitag.',
  'Die Alpentherme in Bad Hofgastein ist der Ort zum Aufwärmen, wenn es draußen kalt ist. Innen- und Außenbecken, Sauna und genug Platz, um nach dem Skifahren runterzukommen.',
  'Komm am späten Nachmittag, wenn die Skifahrer noch am Berg sind – dann hast du mehr Ruhe im Wasser.',
  'Plan ein paar Stunden ein, ideal nach dem Skitag.',
  'Im Winter besonders schön, aber ganzjährig offen.',
  'In Bad Hofgastein im Gasteinertal. Mit Auto und Bahn erreichbar.',
  'Anton, Local'
from public.spots where slug = 'alpentherme-gastein'
on conflict (spot_id, lang) do nothing;

insert into public.spot_translations
  (spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author)
select id, 'en', 'Alpentherme Gastein',
  'Big thermal spa to warm up after a day on the slopes.',
  'The Alpentherme in Bad Hofgastein is the place to warm up when it is cold outside. Indoor and outdoor pools, sauna and plenty of room to wind down after skiing.',
  'Come late afternoon while the skiers are still on the mountain – the water is calmer then.',
  'Plan a few hours, ideal after a ski day.',
  'Especially nice in winter, but open all year.',
  'In Bad Hofgastein in the Gastein valley. Reachable by car and train.',
  'Anton, Local'
from public.spots where slug = 'alpentherme-gastein'
on conflict (spot_id, lang) do nothing;

-- ----------------------------------------------------------------------------
-- Spot <-> Kategorie verknüpfen
-- ----------------------------------------------------------------------------
insert into public.spot_categories (spot_id, category_id)
select s.id, c.id from public.spots s, public.categories c
where (s.slug, c.key, c.season) in (
  ('aignerpark',          'hills',  'summer'),
  ('aignerpark',          'favs',   'summer'),
  ('karaffu',             'food',   'summer'),
  ('fuschlsee',           'lakes',  'summer'),
  ('liechtensteinklamm',  'gorges', 'summer'),
  ('alpentherme-gastein', 'view',   'winter')
)
on conflict do nothing;
