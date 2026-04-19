/**
 * Avatar upload pipeline.
 *
 * Takes a chosen seed, renders to PNG, uploads to Supabase Storage under
 * avatars/{userId}/avatar.png, and returns the public URL.
 *
 * The caller is responsible for then PATCHing the profile with
 * { avatarSeed, avatarUrl } via the backend.
 *
 * Requires the `avatars` bucket to exist with appropriate RLS policies
 * (see sql/migration.sql).
 */

import { getSupabase } from '@/lib/supabase';
import { renderAvatarToBlob } from './render';

const BUCKET = 'avatars';
const FILENAME = 'avatar.png';

export interface UploadedAvatar {
  url: string;
  seed: string;
  path: string;
}

/**
 * Render the selected seed to PNG and upload to the user's avatar path.
 * Returns the public URL and the seed, ready to be persisted on the profile.
 *
 * Supabase Storage is configured for public read, so the public URL is
 * directly usable in <img src> / avatar_url columns.
 */
export async function uploadGeneratedAvatar(
  userId: string,
  seed: string,
): Promise<UploadedAvatar> {
  if (!userId) throw new Error('uploadGeneratedAvatar: userId required');
  if (!seed) throw new Error('uploadGeneratedAvatar: seed required');

  const supabase = await getSupabase();
  const path = `${userId}/${FILENAME}`;
  const blob = await renderAvatarToBlob(seed, 12); // 12x scale = 288x288 PNG

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: 'image/png',
      upsert: true,                 // overwrite previous avatar on re-roll
      cacheControl: '3600',         // 1h — short so re-rolls appear quickly
    });

  if (uploadError) {
    throw new Error(`Avatar upload failed: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error('Avatar upload succeeded but public URL resolution failed');
  }

  // Append a cache-busting query param so clients see the new PNG immediately
  // even if the CDN layer cached the previous version.
  const url = `${data.publicUrl}?v=${Date.now()}`;

  return { url, seed, path };
}
