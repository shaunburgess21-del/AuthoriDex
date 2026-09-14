/**
 * Time-boxed comment-volume lift for the Sep 2026 empty-card fill.
 *
 * Production personas post ~3–7 comments/day across every surface, which
 * is too slow to cover ~80 empty vote cards. This multiplies chance and
 * caps for a few days, then falls away with no second deploy.
 *
 * Vote cap is lifted in the same window so vote-first can still land on
 * empty matchups/polls — otherwise extra comments would deflect onto
 * world markets once the (unboosted) vote budget is spent.
 *
 * Arb agents keep chance/cap 0 (0 × multiplier).
 */

import type { AgentSimulationProfile } from "./simulationProfile";

/** Inclusive-until: boost is active while `now < this instant`. */
export const COMMENT_VOLUME_BOOST_UNTIL_MS = Date.parse("2026-09-19T23:59:59.000Z");

if (!Number.isFinite(COMMENT_VOLUME_BOOST_UNTIL_MS)) {
  throw new Error("COMMENT_VOLUME_BOOST_UNTIL_MS is not a valid date");
}

export const COMMENT_VOLUME_CHANCE_MULT = 3;
export const COMMENT_VOLUME_CAP_MULT = 3;

export function isCommentVolumeBoostActive(now: Date): boolean {
  return now.getTime() < COMMENT_VOLUME_BOOST_UNTIL_MS;
}

export function applyCommentVolumeBoost(
  profile: AgentSimulationProfile,
  now: Date,
): AgentSimulationProfile {
  if (!isCommentVolumeBoostActive(now)) return profile;
  return {
    ...profile,
    dailyCommentChance: Math.min(1, profile.dailyCommentChance * COMMENT_VOLUME_CHANCE_MULT),
    weeklyCommentCap: Math.round(profile.weeklyCommentCap * COMMENT_VOLUME_CAP_MULT),
    weeklyVoteCap: Math.round(profile.weeklyVoteCap * COMMENT_VOLUME_CAP_MULT),
  };
}
