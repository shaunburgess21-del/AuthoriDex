import { pathnameOnly } from "@/lib/primaryNav";

export const ANON_FIRST_VOTE_NUDGE_DISMISS_KEY = "voxdex_anon_first_vote_nudge_dismissed";

/**
 * Set on the document while the vote-hub bar is on screen. Vote scroll
 * padding and the corner pills add it so the bar does not cover cards
 * or sit under Quick Vote / Ask VoxDex. `0px` everywhere else.
 */
export const ANON_NUDGE_HEIGHT_VAR = "--anon-nudge-height";

/**
 * Home-indicator inset while the vote-hub bar is open, else `0px`.
 * Desktop footer padding adds it under the bar. It stays 0 when the bar
 * is hidden so the footer does not grow a second time.
 */
export const ANON_NUDGE_SAFE_VAR = "--anon-nudge-safe";

/**
 * Corner-pill stack (Quick Vote height plus the Ask VoxDex button)
 * while the vote-hub bar is open, else `0px`. Phone footer padding adds
 * it so the disclaimer can scroll above those pills. Desktop does not.
 */
export const ANON_NUDGE_PILLS_VAR = "--anon-nudge-pills";

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
 * Sign-in, sign-up, verify, onboarding, and any auth callback or password
 * reset. The checklist's Predict and Favorite steps land on
 * `/login?mode=signup&reason=predict_signup` and
 * `/login?mode=signup&reason=favorite_signup` (query string ignored).
 * Those screens already ask the visitor to create an account, and they
 * have no shared header, so the strip would cover the logo and title.
 */
const AUTH_SURFACE_ROOTS = [
  "/login",
  "/auth",
  "/signup",
  "/sign-up",
  "/reset-password",
  "/forgot-password",
] as const;

export function isAuthSurfaceRoute(pathname: string): boolean {
  const path = pathnameOnly(pathname);
  return AUTH_SURFACE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

/**
 * Pages that do not render the shared h-16 SiteHeader. A strip fixed at
 * `top: 4rem` lands on their own logo or title. The strip takes normal
 * flow on these routes so that chrome starts underneath it.
 *
 * `/` and `/vote` are handled earlier (checklist / above the bottom nav).
 * `/me` and `/me/settings` use SiteHeader; other `/me/*` pages do not.
 * `/predict` uses SiteHeader; `/predict/*` detail and activity pages do not.
 */
export function anonNudgeReservesSpace(pathname: string): boolean {
  const path = pathnameOnly(pathname);
  if (
    path === "/account-deletion" ||
    path === "/takedown" ||
    path === "/contact" ||
    path === "/unsubscribe"
  ) {
    return true;
  }
  if (path === "/vote/all-ratings" || path === "/vote/induction") return true;
  if (path.startsWith("/vote/opinion-polls") || path.startsWith("/vote/matchups")) return true;
  if (path.startsWith("/polls/")) return true;
  if (path.startsWith("/me/") && path !== "/me/settings") return true;
  if (path.startsWith("/predict/")) return true;
  if (path === "/admin" || path.startsWith("/admin/")) return true;
  return false;
}

/**
 * Where a visible strip sits.
 * - `above-nav`: vote hub after the checklist was dismissed. The header
 *   and the sticky section chips already own the top, so the strip floats
 *   above the bottom nav. It stays fixed, and its measured height is
 *   published as `--anon-nudge-height` so the site footer (below the
 *   page) and the corner pills clear it. The vote page itself does not
 *   add that height — that would leave the footer behind the bar.
 * - `under-header`: pages with the shared h-16 header. Fixed just under
 *   that bar. Out of document flow, same as before.
 * - `in-flow`: pages without that header (`anonNudgeReservesSpace`).
 *   The strip is in normal flow at the top of the page and reserves its
 *   height, so it cannot cover a logo or a title.
 */
export type AnonNudgePlacement = "hidden" | "above-nav" | "under-header" | "in-flow";

export function anonNudgePlacement(input: {
  show: boolean;
  pathname: string;
  deviceDismissed: boolean;
}): AnonNudgePlacement {
  if (!input.show) return "hidden";
  if (isAuthSurfaceRoute(input.pathname)) return "hidden";
  if (welcomeChecklistSuppressesAnonNudge(input)) return "hidden";
  if (isVoteChecklistRoute(input.pathname)) return "above-nav";
  if (anonNudgeReservesSpace(input.pathname)) return "in-flow";
  return "under-header";
}
