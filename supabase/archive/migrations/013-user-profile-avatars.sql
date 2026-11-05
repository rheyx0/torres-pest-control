-- Migration 013 — Shared user profile pictures
-- Run after schema-v2.sql and the migrations used by the current app.

alter table public.admins add column if not exists avatar_url text;
alter table public.staff add column if not exists avatar_url text;
alter table public.technicians add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Profile avatars readable" on storage.objects;
create policy "Profile avatars readable" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'profile-avatars');

drop policy if exists "Profile avatars uploadable" on storage.objects;
create policy "Profile avatars uploadable" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'profile-avatars');

drop policy if exists "Profile avatars replaceable" on storage.objects;
create policy "Profile avatars replaceable" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'profile-avatars')
  with check (bucket_id = 'profile-avatars');

notify pgrst, 'reload schema';
