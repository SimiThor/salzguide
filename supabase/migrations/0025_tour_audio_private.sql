-- 0025: Sicherheits-Härtung Audio-Touren (nach adversarialem Review 2026-07-07).
--
-- (A) Bezahltes Tour-Audio darf NICHT über den öffentlichen spot-media-Bucket
--     enumerier-/ladbar sein (dessen Read-Policy erlaubt anon das Listing aller
--     Objekte -> Random-UUID-Pfade sind nutzlos, Paywall umgehbar). Deshalb ein
--     EIGENER PRIVATER Bucket 'tour-audio': kein Public-Read; die App liefert nur
--     kurzlebige Signed-URLs, serverseitig und ausschließlich an berechtigte
--     (Gratis-Teaser oder Pro) Hörer erzeugt (src/lib/tours.ts). spot_audio.audio_url
--     speichert ab jetzt den OBJEKT-PFAD in diesem Bucket (keine öffentliche URL).
--
-- (B) Defense-in-depth: tour_stops nur öffentlich lesbar, wenn AUCH der referenzierte
--     Spot veröffentlicht ist -> keine Enumeration versteckter Draft-Stops via PostgREST.

-- ── (A) Privater Bucket + Policies (nur Admin; KEIN Public-Read) ──────────────
insert into storage.buckets (id, name, public)
values ('tour-audio', 'tour-audio', false)
on conflict (id) do update set public = false;

drop policy if exists "tour-audio insert" on storage.objects;
create policy "tour-audio insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tour-audio' and public.is_admin());

drop policy if exists "tour-audio update" on storage.objects;
create policy "tour-audio update" on storage.objects
  for update to authenticated
  using (bucket_id = 'tour-audio' and public.is_admin());

drop policy if exists "tour-audio delete" on storage.objects;
create policy "tour-audio delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tour-audio' and public.is_admin());

drop policy if exists "tour-audio read admin" on storage.objects;
create policy "tour-audio read admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'tour-audio' and public.is_admin());
-- KEIN Public/anon-Read -> öffentliche Wiedergabe läuft NUR über Signed-URLs, die
-- der service_role-Client (bypasst RLS) für berechtigte Stops erzeugt.

-- ── (B) tour_stops: referenzierter Spot muss veröffentlicht sein ──────────────
drop policy if exists "tour_stops_public_read" on public.tour_stops;
create policy "tour_stops_public_read" on public.tour_stops
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.tours t
      where t.id = tour_stops.tour_id and t.status = 'published'
    )
    and exists (
      select 1 from public.spots s
      where s.id = tour_stops.spot_id and s.status = 'published'
    )
  );
