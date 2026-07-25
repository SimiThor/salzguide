-- Storage härten: Listing schliessen + Bucket-Limits.
--
-- (A) spot-media: Die SELECT-Policy galt bisher für JEDEN (auch anon) und schaltet die
--     List-/Search-API frei. Jeder mit dem öffentlichen anon-Key konnte damit den ganzen
--     Bucket AUFLISTEN, also die UUID-Pfade der Original-Fotos gesperrter Pro-Spots und
--     unveröffentlichter Entwürfe finden. Die öffentliche AUSLIEFERUNG läuft bei einem
--     public Bucket über /object/public/ OHNE RLS-Check und braucht diese Policy nicht;
--     das Listing brauchen nur Admin-Werkzeuge (und der Service-Key umgeht RLS ohnehin).
--     Also: SELECT nur noch für eingeloggte Admins.
--
-- (B) Bucket-Limits (Grösse + MIME): Alle Format-/Grössen-Checks waren rein clientseitig.
--     Diese Limits sind die serverseitige Grenze, die auch eine kompromittierte
--     Admin-Session nicht überschreiten kann.
--     - spot-media: WebP/JPEG (Bilder inkl. Blur-Vorschauen und Video-Poster) + MP4
--       (Spot-Videos, Intro-Renders, Erklärvideos). 70 MiB deckt das 60-MB-Limit des
--       Video-Uploads plus Puffer ab. Alt-Dateien (PNG aus früheren Zeiten) bleiben
--       liegen – Limits gelten nur für NEUE Uploads.
--     - tour-audio: nur MP3 (TTS erzeugt MP3, der Admin-Upload akzeptiert seit diesem
--       Stand nur noch MP3), 20 MiB reicht für jede Sprechtext-Länge.

drop policy if exists "spot-media read" on storage.objects;
create policy "spot-media read" on storage.objects
  for select to authenticated
  using (bucket_id = 'spot-media' and public.is_admin());

update storage.buckets
set
  file_size_limit = 73400320, -- 70 MiB
  allowed_mime_types = array['image/webp', 'image/jpeg', 'video/mp4']
where id = 'spot-media';

update storage.buckets
set
  file_size_limit = 20971520, -- 20 MiB
  allowed_mime_types = array['audio/mpeg']
where id = 'tour-audio';
