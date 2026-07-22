-- 0048: Saubere Variante des Intro-Videos (ohne Text-Overlay) für die eigene Videoproduktion.
-- Der Renderer (scripts/render-intro.ts) erzeugt IMMER zwei Varianten aus denselben Frames:
--   intro_video_url        = normal, MIT Titelkarte (Name/Werte/SalzGuide) -> für User (0047)
--   intro_video_clean_url  = NUR Karte + Route + Attribution, OHNE Text-Overlay -> nur Admin,
--                            als Download fürs Schneiden neuer Werbevideos.
-- Bewusst nicht in getSpotDetail ausgeliefert (kein User-Feature); nur der Admin liest es.
alter table public.spots
  add column if not exists intro_video_clean_url text;
