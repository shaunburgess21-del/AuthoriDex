import { pathnameOnly } from "@/lib/primaryNav";

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

/** `/` and `/vote` are the only routes that mount the welcome checklist. */
export function isVoteChecklistRoute(pathname: string): boolean {
  const path = pathnameOnly(pathname);
  return path === "/" || path === "/vote";
}

/**
 * The open checklist is the signup nudge on the vote hub. The top strip
 * stays down so the two prompts do not stack, and so the strip cannot
 * push the page after the first vote.
 */
export function welcomeChecklistSuppressesAnonNudge(input: {
  pathname: string;
  deviceDismissed: boolean;
}): boolean {
  if (input.deviceDismissed) return false;
  return isVoteChecklistRoute(input.pathname);
}

/**
 * Where a visible strip sits. It is never in document flow.
 * - `above-nav`: vote hub after the checklist was dismissed. The header
 *   and the sticky section chips already own the top, so the strip floats
 *   above the bottom nav instead of covering them.
 * - `under-header`: every other page. It overlays the first sliver of
 *   content under the header and does not pad the document.
 */
export type AnonNudgePlacement = "hidden" | "above-nav" | "under-header";

export function anonNudgePlacement(input: {
  show: boolean;
  pathname: string;
  deviceDismissed: boolean;
}): AnonNudgePlacement {
  if (!input.show) return "hidden";
  if (welcomeChecklistSuppressesAnonNudge(input)) return "hidden";
  return isVoteChecklistRoute(input.pathname) ? "above-nav" : "under-header";
}
