/**
 * True when avatarUrl points at this user's slot in our Supabase avatars
 * bucket (generative PNG or uploaded WebP). External URLs (e.g. Google
 * OAuth picture) return false so onboarding can persist a generative avatar.
 */
export function isVoxDexHostedAvatarUrl(
  avatarUrl: string | null | undefined,
  userId?: string | null,
): boolean {
  if (!avatarUrl || typeof avatarUrl !== "string") return false;
  const lower = avatarUrl.toLowerCase();
  // Require our avatars bucket segment so arbitrary URLs with "avatar.png"
  // in the path do not count as hosted.
  if (!lower.includes("/avatars/")) return false;
  if (!lower.includes("/avatar.png") && !lower.includes("/avatar.webp")) {
    return false;
  }
  if (userId && !lower.includes(`/${userId.toLowerCase()}/`)) {
    return false;
  }
  return true;
}
