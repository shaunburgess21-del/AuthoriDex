/**
 * Avatar upload pipeline.
 *
 * Two entry points, both ultimately writing into the user's slot in the
 * `avatars` Supabase Storage bucket so there's only one source of truth
 * for a user's avatar image:
 *
 *   - `uploadGeneratedAvatar` — for our generative avatars: renders a
 *     chosen seed to a PNG via the canvas helper and uploads directly
 *     to Supabase Storage at `avatars/{userId}/avatar.png`.
 *   - `uploadAvatarFile`      — for user-uploaded photos: posts the
 *     File to the server, which uses sharp to convert it to an
 *     optimized .webp (matching the admin image upload pipeline) and
 *     writes it to `avatars/{userId}/avatar.webp`. Returns the public
 *     URL.
 *
 * Both rely on `upsert: true`, so a new avatar always overwrites the
 * previous one — no orphaned files within the same pipeline. When a
 * user flips between pipelines we clean up the *other* path so the
 * bucket stays tidy:
 *
 *   - generated → uploaded: the server endpoint deletes `avatar.png`
 *     after the new `avatar.webp` is in place.
 *   - uploaded  → generated: `uploadGeneratedAvatar` deletes
 *     `avatar.webp` after the new `avatar.png` is in place.
 *
 * Cleanup is best-effort and non-fatal — the new avatar is the source
 * of truth and the orphan, if any, just costs a few KB of storage.
 *
 * The cache-busting `?v=${ts}` suffix ensures the CDN doesn't serve a
 * stale image after re-roll or upload.
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
const GENERATED_FILENAME = 'avatar.png';
const UPLOADED_FILENAME = 'avatar.webp';
// Phase 5 profile banner (Maven Tier 6+). Stored alongside the avatar in
// the user's own folder so the existing per-user storage RLS applies.
// Fixed path (no extension) + upsert keeps a single file per user — a
// re-upload overwrites, no orphans across formats.
const BANNER_FILENAME = 'banner';

// User-uploaded photos are converted to WebP server-side, so we accept
// a wider input pool and let the server do the heavy lifting. The cap
// matches the admin image upload (5 MB) — anything larger is almost
// certainly a phone photo straight out of the camera roll, and we'd
// rather error than wait on a 20 MB upload.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
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
  const path = `${userId}/${GENERATED_FILENAME}`;
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

  // Best-effort cleanup of the legacy uploaded-photo path
  // (`avatar.webp`). If the user previously uploaded a photo and now
  // re-rolls a generative avatar, we don't want a stale orphan
  // sitting in the bucket. Failure is non-fatal: the new PNG is
  // already live and the DB will point at it.
  void supabase.storage
    .from(BUCKET)
    .remove([`${userId}/${UPLOADED_FILENAME}`])
    .catch((err) => {
      console.warn(
        '[uploadGeneratedAvatar] uploaded-photo cleanup failed (non-fatal):',
        err?.message ?? err,
      );
    });

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
 * POSTs the raw file to `/api/me/avatar/upload`, which uses sharp to
 * convert it to an optimized .webp (matching the admin image pipeline)
 * and writes the result to `avatars/{userId}/avatar.webp` — where the
 * user id is derived from the verified JWT on the server, not from
 * anything the client sends. This makes the user-facing avatar (a) a
 * fraction of the original size — typical phone photos drop from 1–3
 * MB JPEG to ~30–80 KB WebP — and (b) served as `image/webp` so a
 * right-click save reflects the optimized file instead of the
 * unprocessed original.
 *
 * Validates MIME type and size BEFORE uploading so we surface a clean
 * error early rather than letting the request round-trip to the server.
 */
export async function uploadAvatarFile(file: File): Promise<UploadedAvatarFile> {
  if (!file) throw new Error('uploadAvatarFile: file required');

  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    throw new Error('Please upload a PNG, JPG, or WEBP image.');
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('Image is too large. Max 5 MB.');
  }

  // Pull the access token off the active Supabase session — the server
  // endpoint is gated by `requireAuth`, and we don't want the upload to
  // silently 401 because no Authorization header was attached.
  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('You must be signed in to upload an avatar.');
  }

  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/me/avatar/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
    credentials: 'include',
  });

  if (!res.ok) {
    let message = 'Avatar upload failed';
    try {
      // Our API uses `{ error }` for the avatar route, but the global
      // Express error handler in server/index.ts (which catches anything
      // a route doesn't handle) responds with `{ message }`. Read both
      // shapes so users see the actual reason instead of a fallback.
      const body = (await res.json()) as { error?: string; message?: string };
      const reason = body?.error ?? body?.message;
      if (reason) message = reason;
    } catch {
      // Body wasn't JSON — fall back to a generic message rather than
      // leaking the raw HTML/text we'd otherwise hand the user.
    }
    throw new Error(message);
  }

  const { url, path } = (await res.json()) as { url: string; path: string };
  return { url, path };
}

/**
 * Upload a user-supplied image as the profile banner (Phase 5, Maven
 * Tier 6+). Uploads directly to the user's folder in the `avatars`
 * bucket at a fixed `{userId}/banner` path (upsert), mirroring the
 * generated-avatar client-upload path so no new bucket/RLS is needed.
 * Returns the cache-busted public URL; the caller persists it via
 * PATCH /api/profile/me { profileBannerUrl }.
 */
export async function uploadBannerFile(
  userId: string,
  file: File,
): Promise<UploadedAvatarFile> {
  if (!userId) throw new Error('uploadBannerFile: userId required');
  if (!file) throw new Error('uploadBannerFile: file required');

  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    throw new Error('Please upload a PNG, JPG, or WEBP image.');
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('Image is too large. Max 5 MB.');
  }

  const supabase = await getSupabase();
  const path = `${userId}/${BANNER_FILENAME}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: true,
      cacheControl: '3600',
    });

  if (uploadError) {
    throw new Error(`Banner upload failed: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error('Banner upload succeeded but public URL resolution failed');
  }

  const url = `${data.publicUrl}?v=${Date.now()}`;
  return { url, path };
}
