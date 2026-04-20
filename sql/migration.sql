-- =============================================================================
-- Avatars bucket + RLS policies (Supabase Storage)
-- =============================================================================
--
-- This migration provisions the `avatars` Supabase Storage bucket used by
-- the generative avatar picker (see client/src/lib/avatar/upload.ts).
--
-- Path convention:
--   avatars/{userId}/avatar.png
-- where {userId} is the authenticated user's Supabase auth.uid(). This is
-- enforced by the RLS policies below, which restrict writes to a user's own
-- folder.
--
-- Run this against the project's Supabase database (Dashboard -> SQL Editor).
-- It is idempotent: safe to re-run on existing environments.
-- =============================================================================

-- 1. Create the bucket (public read, private write) if it doesn't exist.
--    - public = true so getPublicUrl() returns a URL usable in <img src>.
--    - file_size_limit = 2 MB (generated avatars are ~20-40 KB, this is headroom).
--    - allowed_mime_types restricted to the formats renderAvatarToBlob emits
--      plus common raster formats, for defense in depth.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Public read: anyone can GET an avatar (needed because avatars are
--    rendered across the site via <img src={publicUrl}>).
drop policy if exists "Avatars are publicly readable" on storage.objects;
create policy "Avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- 3. Authenticated users can INSERT only into their own folder.
--    Matches the `${userId}/avatar.png` path used by uploadGeneratedAvatar().
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. Authenticated users can UPDATE their own avatar.
--    Required because uploadGeneratedAvatar() uses upsert: true so re-rolls
--    overwrite the existing object instead of creating a new one.
drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Authenticated users can DELETE their own avatar.
--    Future-proofing for "remove avatar" or account-deletion flows.
drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
