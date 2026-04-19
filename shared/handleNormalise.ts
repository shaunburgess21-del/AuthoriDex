/**
 * Normalisation + validation for the five social-handle fields on
 * tracked_people. Kept in `shared/` so the backfill script, the admin API,
 * and the admin UI all agree on what a valid handle looks like.
 *
 * Rules:
 *  - xHandle / instagramHandle / tiktokHandle: free-form text; we trim and
 *    strip leading `@`. Empty string -> null.
 *  - youtubeId: YouTube channel ID. Must be exactly "UC" + 22 url-safe chars.
 *    Anything else is rejected as invalid (use channel ID, not @handle).
 *  - spotifyId: Spotify artist ID. 22-char base62. Anything else rejected.
 */

export type SocialHandleKey =
  | "xHandle"
  | "instagramHandle"
  | "tiktokHandle"
  | "youtubeId"
  | "spotifyId";

export const SOCIAL_HANDLE_KEYS: readonly SocialHandleKey[] = [
  "xHandle",
  "instagramHandle",
  "tiktokHandle",
  "youtubeId",
  "spotifyId",
] as const;

export const YOUTUBE_CHANNEL_ID_REGEX = /^UC[A-Za-z0-9_-]{22}$/;
export const SPOTIFY_ID_REGEX = /^[A-Za-z0-9]{22}$/;

/** Helper text shown beneath admin form inputs. */
export const SOCIAL_HANDLE_HELP: Record<SocialHandleKey, string> = {
  xHandle: "X/Twitter username, without the @.",
  instagramHandle: "Instagram username, without the @.",
  tiktokHandle: "TikTok username, without the @.",
  youtubeId: 'YouTube channel ID. Starts with "UC" and is 24 characters total. Not the @handle.',
  spotifyId: "Spotify artist ID. 22-character alphanumeric from the artist URL.",
};

export interface NormaliseResult {
  /** Fields that passed validation and should be written. Missing keys mean "unchanged". */
  values: Partial<Record<SocialHandleKey, string | null>>;
  /** Field-level validation errors. */
  errors: Partial<Record<SocialHandleKey, string>>;
}

function cleanUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^@+/, "");
  return trimmed.length === 0 ? null : trimmed;
}

function cleanExactId(raw: unknown, regex: RegExp): { value: string | null; invalid: boolean } {
  if (raw === undefined || raw === null) return { value: null, invalid: false };
  if (typeof raw !== "string") return { value: null, invalid: true };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null, invalid: false };
  return regex.test(trimmed) ? { value: trimmed, invalid: false } : { value: null, invalid: true };
}

/**
 * Normalise and validate a request body containing any subset of social
 * handle fields. Only keys that are *present* in the body get processed —
 * missing keys remain "unchanged" so PATCH semantics are preserved.
 *
 * For username-style fields an empty string (or "@") is treated as explicit
 * clear -> null. For exact-format IDs, an empty string also clears but a
 * non-matching value produces a validation error (so the caller returns 400).
 */
export function normaliseSocialHandles(body: Record<string, unknown>): NormaliseResult {
  const values: Partial<Record<SocialHandleKey, string | null>> = {};
  const errors: Partial<Record<SocialHandleKey, string>> = {};

  for (const key of ["xHandle", "instagramHandle", "tiktokHandle"] as const) {
    if (!(key in body)) continue;
    values[key] = cleanUsername(body[key]);
  }

  if ("youtubeId" in body) {
    const { value, invalid } = cleanExactId(body.youtubeId, YOUTUBE_CHANNEL_ID_REGEX);
    if (invalid) {
      errors.youtubeId = 'youtubeId must be a YouTube channel ID starting with "UC" (24 chars).';
    } else {
      values.youtubeId = value;
    }
  }

  if ("spotifyId" in body) {
    const { value, invalid } = cleanExactId(body.spotifyId, SPOTIFY_ID_REGEX);
    if (invalid) {
      errors.spotifyId = "spotifyId must be a 22-character alphanumeric Spotify artist ID.";
    } else {
      values.spotifyId = value;
    }
  }

  return { values, errors };
}
