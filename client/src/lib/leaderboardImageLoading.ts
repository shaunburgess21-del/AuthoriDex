/** How a leaderboard row photo should compete with first paint. */
export type LeaderboardAvatarPriority = "high" | "low" | "lazy";

/**
 * Rows 1–5 are the first screen (high). Rows 6–20 are the ones that used to
 * sit on initials until lazy-load noticed them — start them immediately, but
 * at low priority so they don't steal bandwidth from the first paint.
 * Everything past 20 stays lazy.
 */
export function leaderboardAvatarPriority(zeroBasedIndex: number): LeaderboardAvatarPriority {
  if (zeroBasedIndex < 5) return "high";
  if (zeroBasedIndex < 20) return "low";
  return "lazy";
}

/** ~58px row avatar at 2x. Small enough that eager rows 6–20 stay cheap. */
export const LEADERBOARD_AVATAR_IMAGE_WIDTH = 128;

/** Hero on a profile page (the xl avatar, ~192–384 CSS px). */
export const PROFILE_HERO_IMAGE_WIDTH = 700;
