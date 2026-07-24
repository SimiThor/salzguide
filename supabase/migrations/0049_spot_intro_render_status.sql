-- 0049: Render-Status der Intro-Videos, damit der Admin sie per Button erzeugen kann
-- (statt lokal per Terminal, siehe .github/workflows/render-intro.yml).
--
-- Ablauf: Der Admin-Button setzt 'queued' und stösst den GitHub-Actions-Workflow an; das
-- Render-Skript (scripts/render-intro.ts) setzt beim Start 'rendering' und am Ende 'idle'
-- (bzw. 'error' mit Meldung). Die Admin-Seite pollt diese Felder und zeigt den Fortschritt.
--
--   intro_render_status      idle | queued | rendering | error
--   intro_render_error       Fehlermeldung des letzten Fehlversuchs (sonst null)
--   intro_render_started_at  Startzeitpunkt -> hängengebliebene Läufe (>15 min) erkennbar
alter table public.spots
  add column if not exists intro_render_status text not null default 'idle',
  add column if not exists intro_render_error text,
  add column if not exists intro_render_started_at timestamptz;
