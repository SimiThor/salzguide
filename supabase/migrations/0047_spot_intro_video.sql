-- 0047: Automatisch gerendertes 3D-Intro-Video je Spot (Wander-Animation).
-- Eigene Felder, bewusst GETRENNT von video_url (0030, das per Hand hochgeladene
-- Hero-Video): hier liegt das aus der Route erzeugte 10-Sek-3D-Satellitenvideo
-- (scripts/render-intro.ts), sprachneutral, öffentliches Asset im Bucket spot-media.
--   intro_video_url        = MP4 (1080x1920)
--   intro_video_poster_url = WebP-Standbild
--   intro_source_hash      = Hash aus Route + Renderer-Version (src/lib/intro-hash.ts).
--                            Weicht er vom aktuellen Hash ab, ist das Intro veraltet
--                            (Route geändert) und der Admin bietet "neu rendern" an.
-- Kein eigenes Schema/RLS nötig: die Spalten kommen mit der spots-Zeile; bei gesperrten
-- Pro-Spots werden sie serverseitig genullt (wie video_url).
alter table public.spots
  add column if not exists intro_video_url        text,
  add column if not exists intro_video_poster_url text,
  add column if not exists intro_source_hash      text;
