-- 0007: Storage-Bucket für Spot-Fotos + Policies.
-- Öffentlich lesbar (Bilder im Web), schreiben/ändern/löschen nur Admins (is_admin()).
insert into storage.buckets (id, name, public)
values ('spot-media', 'spot-media', true)
on conflict (id) do nothing;

drop policy if exists "spot-media read" on storage.objects;
create policy "spot-media read" on storage.objects
  for select using (bucket_id = 'spot-media');

drop policy if exists "spot-media insert" on storage.objects;
create policy "spot-media insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'spot-media' and public.is_admin());

drop policy if exists "spot-media update" on storage.objects;
create policy "spot-media update" on storage.objects
  for update to authenticated
  using (bucket_id = 'spot-media' and public.is_admin());

drop policy if exists "spot-media delete" on storage.objects;
create policy "spot-media delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'spot-media' and public.is_admin());
