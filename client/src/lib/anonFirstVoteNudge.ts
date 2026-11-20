export const ANON_FIRST_VOTE_NUDGE_DISMISS_KEY = "voxdex_anon_first_vote_nudge_dismissed";

export const ANON_FIRST_VOTE_NUDGE_COPY = "Sign up to keep your votes and earn XP.";

/**
 * Gentle prompt after the first anonymous vote. It must not appear before
 * any vote, and dismissal sticks so later votes (including the remaining
 * free ones) are never blocked.
 */
export function shouldShowAnonFirstVoteNudge(input: {
  isAnonymous: boolean;
  used: number;
  dismissed: boolean;
}): boolean {
  if (!input.isAnonymous) return false;
  if (input.dismissed) return false;
  return input.used >= 1;
}
