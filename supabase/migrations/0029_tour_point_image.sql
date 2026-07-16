-- 0029: Bild je Audio-Punkt (Anton-Wunsch 2026-07-10).
-- Öffentliches Teaser-Bild pro Pool-Punkt (wie Spot-/Gebiets-Cover): liegt im PUBLIC
-- Bucket spot-media, gespeichert wird die öffentliche URL. Kein Pro-Gating (Titel/Bild
-- sind Teaser; nur Audio-Text+MP3 bleiben Pro). Bestehende RLS reicht: Punkt sichtbar,
-- wenn Punkt UND Gebiet published -> image_url kommt automatisch mit.
alter table public.tour_points
  add column if not exists image_url text;
