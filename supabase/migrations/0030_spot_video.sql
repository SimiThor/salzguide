-- 0030: 9:16-Video je Spot (Anton-Wunsch 2026-07-10).
-- Ein optionales Hochkant-Video pro Spot (öffentliches Teaser-Asset wie die Fotos):
-- video_url = MP4 im PUBLIC-Bucket spot-media, video_poster_url = automatisch aus dem
-- ersten Frame erzeugtes WebP-Standbild. Kein eigenes Schema/RLS nötig: die Spalten
-- kommen mit der spots-Zeile; bei gesperrten Pro-Spots werden sie serverseitig genullt.
alter table public.spots
  add column if not exists video_url        text,
  add column if not exists video_poster_url text;
