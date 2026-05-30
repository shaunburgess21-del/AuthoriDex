export type AvatarCustomizationSource = "onboarding" | "settings";

export interface AvatarCustomizationCheckOpts {
  source: AvatarCustomizationSource;
  /** Profile state before the avatar PATCH — onboarding must already be done. */
  onboardingCompletedAt: Date | null;
  previousAvatarSeed: string | null;
  previousAvatarUrl: string | null;
  newSeed: string | null;
  newAvatarUrl: string;
}

/**
 * Whether a Settings avatar PATCH should award Fresh Look (avatar_uploaded).
 * Onboarding shuffle/auto-save is never eligible.
 */
export function isAvatarCustomizationEligible(
  opts: AvatarCustomizationCheckOpts,
): boolean {
  if (opts.source !== "settings") return false;
  if (!opts.onboardingCompletedAt) return false;

  const isCustomUpload =
    opts.newSeed === null &&
    opts.newAvatarUrl.includes("avatar.webp") &&
    (!opts.previousAvatarUrl?.includes("avatar.webp") ||
      opts.newAvatarUrl !== opts.previousAvatarUrl);

  const isGenerativeRepick =
    opts.newSeed !== null &&
    (opts.newSeed !== opts.previousAvatarSeed ||
      Boolean(opts.previousAvatarUrl?.includes("avatar.webp")));

  return isCustomUpload || isGenerativeRepick;
}
