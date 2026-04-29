-- Remove broad storage SELECT policies that permit bucket-wide listing.
-- Keep bucket public URL access behavior unchanged.

DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Allow public reads" ON storage.objects;
