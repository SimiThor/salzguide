-- 0067: Privater Bucket 'exports' für Clean-Fassungen der Intro-Videos auf Abruf.
--
-- WARUM ÜBERHAUPT WIEDER SPEICHERN, wo doch am 10.08.2026 genau das Gegenteil entschieden
-- wurde: Damals lagen ALLE Clean-Videos DAUERHAFT im Storage (551 MiB, der grösste Posten).
-- Hier liegt jeweils EINE Datei, nur weil sie angefordert wurde, und der tägliche
-- Aufräum-Lauf löscht sie nach EXPORT_TTL_DAYS wieder (src/lib/intro-export.ts). Die
-- Alternative wäre der bisherige Weg: Lauf auf GitHub suchen, einloggen, ZIP laden,
-- entpacken. Das ist am Handy der eigentliche Grund, warum die Fassung nie geholt wurde.
--
-- WARUM EIN EIGENER BUCKET UND NICHT spot-media:
-- spot-media ist öffentlich. Eine Clean-Fassung ist Rohmaterial für eigene Werbevideos und
-- zeigt auch Routen von Pro- und Entwurf-Spots. Sie darf nicht unter einer erratbaren
-- öffentlichen Adresse liegen. Also privat, wie tour-audio (Migration 0025): kein
-- Public-Read, die App erzeugt serverseitig kurzlebige Signed-URLs.
--
-- WARUM KEIN LISTING FÜR anon: gleiche Begründung wie in 0050. Wer auflisten darf, findet
-- jeden Pfad, und dann nützt auch ein unratbarer Dateiname nichts.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exports', 'exports', false, 314572800, array['video/mp4']) -- 300 MiB
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Schreiben/Löschen macht im Normalbetrieb der service_role-Client (umgeht RLS): der
-- GitHub-Runner beim Hochladen, der Aufräum-Lauf beim Löschen. Die Policies hier gelten
-- für eingeloggte Admins, damit man im Supabase-Dashboard und aus dem Admin heraus
-- nachsehen und notfalls von Hand aufräumen kann.
drop policy if exists "exports insert" on storage.objects;
create policy "exports insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'exports' and public.is_admin());

drop policy if exists "exports update" on storage.objects;
create policy "exports update" on storage.objects
  for update to authenticated
  using (bucket_id = 'exports' and public.is_admin());

drop policy if exists "exports delete" on storage.objects;
create policy "exports delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'exports' and public.is_admin());

drop policy if exists "exports read admin" on storage.objects;
create policy "exports read admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'exports' and public.is_admin());
-- KEIN anon-Read: Der Download läuft ausschliesslich über die Signed-URL aus der Mail.
