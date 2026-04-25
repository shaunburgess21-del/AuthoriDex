/**
 * Helpers for the "Sign in to vote" prompt that fires on 401s and on
 * unauthenticated vote attempts. Returns Sonner-shaped options for use as
 * the second argument to `toast(title, options)`.
 *
 * Usage: `toast("Sign in to vote", signInToVoteToastOptions(onSignIn))`.
 */

export function isUnauthorizedApiError(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message) return false;
  const m = error.message;
  if (/^401:/.test(m)) return true;
  if (m.includes("Unauthorized")) return true;
  return false;
}

export const signInToVoteTitle = "Sign in to vote";

export function signInToVoteToastOptions(onSignIn: () => void) {
  return {
    description: "Create a free account to record your vote on VoxDex.",
    action: {
      label: "Sign in",
      onClick: onSignIn,
    },
  };
}
