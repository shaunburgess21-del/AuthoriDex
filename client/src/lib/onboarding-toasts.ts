/** Onboarding route — celebration toasts stay off until the user leaves. */
export const ONBOARDING_WELCOME_PATH = "/login/welcome";

function isOnboardingWelcomePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === ONBOARDING_WELCOME_PATH ||
    pathname.startsWith(`${ONBOARDING_WELCOME_PATH}/`)
  );
}

/**
 * Whether celebration toasts (streak, signup credits, badges) should show.
 * During /login/welcome the completion screen and bell carry the payoff;
 * suppressing toasts avoids the streak card covering the welcome-credits ping.
 * Stays false on the welcome route even after onboardingCompletedAt is stamped
 * so the day-1 streak toast fires after the user taps through to home.
 */
export function shouldShowCelebrationToasts(
  profile: { onboardingCompletedAt?: string | null } | null | undefined,
  pathname?: string | null,
): boolean {
  if (isOnboardingWelcomePath(pathname)) return false;
  return Boolean(profile?.onboardingCompletedAt);
}
/** Notification kinds we skip auto-toasting until onboarding is complete. */
export const ONBOARDING_SUPPRESSED_TOAST_KINDS = new Set([
  "credits_granted",
  "badge_awarded",
]);
