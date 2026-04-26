/**
 * Avatar upload pipeline.
 *
 * Two entry points, both writing to the SAME Supabase Storage path
 * (`avatars/{userId}/avatar.png`) so the bucket only ever has one
 * source of truth for the user's avatar image:
 *
 *   - `uploadGeneratedAvatar` — for our generative avatars: renders
 *     a chosen seed to a PNG via the canvas helper, uploads, returns
 *     the public URL.
 *   - `uploadAvatarFile`      — for user-uploaded photos: validates
 *     a File (size + MIME type), uploads as-is, returns the public
 *     URL. Replaces the legacy "Profile Photo URL" field that lived
 *     in Settings; the new camera+ popover calls into this helper.
 *
 * Both rely on `upsert: true`, so a new avatar always overwrites the
 * previous one — no orphaned files. The cache-busting `?v=${ts}`
 * suffix ensures the CDN doesn't serve a stale image after re-roll
 * or upload.
 *
 * The caller is responsible for then PATCHing the profile with
 * { avatarSeed?, avatarUrl } via the backend.
 *
 * Requires the `avatars` bucket to exist with appropriate RLS policies
 * (see sql/migration.sql).
 */

import { getSupabase } from '@/lib/supabase';
import { renderAvatarToBlob } from './render';

const BUCKET = 'avatars';
const FILENAME = 'avatar.png';

// Mirror what the legacy UploadImageInput enforced (PNG/JPG/WEBP, ~2MB)
// so behaviour for users coming from the old field is unchanged.
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export interface UploadedAvatar {
  url: string;
  seed: string;
  path: string;
}

export interface UploadedAvatarFile {
  url: string;
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

/**
 * Upload a user-supplied image file as the user's avatar.
 *
 * Used by the Settings hover-camera popover ("Upload a photo") to
 * replace the legacy URL/file field. We rebrand the same Supabase
 * Storage path used by the generative avatar pipeline, so a user can
 * freely flip between generative and uploaded photos without leaving
 * orphaned files behind.
 *
 * Validates MIME type and size BEFORE uploading so we surface a clean
 * error early rather than letting the bucket reject and the user
 * misinterpret the resulting toast.
 */
export async function uploadAvatarFile(
  userId: string,
  file: File,
): Promise<UploadedAvatarFile> {
  if (!userId) throw new Error('uploadAvatarFile: userId required');
  if (!file) throw new Error('uploadAvatarFile: file required');

  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    throw new Error('Please upload a PNG, JPG, or WEBP image.');
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('Image is too large. Max 2 MB.');
  }

  const supabase = await getSupabase();
  const path = `${userId}/${FILENAME}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: true,
      cacheControl: '3600',
    });

  if (uploadError) {
    throw new Error(`Avatar upload failed: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error('Avatar upload succeeded but public URL resolution failed');
  }

  const url = `${data.publicUrl}?v=${Date.now()}`;

  return { url, path };
}
