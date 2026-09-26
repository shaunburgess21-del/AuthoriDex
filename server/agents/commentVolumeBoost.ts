/**
 * Time-boxed comment-volume lift so empty and one-comment vote cards
 * can catch up. Production personas post ~3–7 comments/day across every
 * surface, which is too slow to cover ~80 empty vote cards.
 *
 * Vote cap is lifted in the same window so vote-first can still land on
 * empty matchups/polls — otherwise extra comments would deflect onto
 * world markets once the (unboosted) vote budget is spent.
 *
 * Arb agents keep chance/cap 0 (0 × multiplier).
 */

import type { AgentSimulationProfile } from "./simulationProfile";

export const COMMENT_VOLUME_BOOST_FROM_MS = Date.parse("2026-09-26T00:00:00.000Z");
/** Inclusive-until: boost is active while `now < this instant`. */
export const COMMENT_VOLUME_BOOST_UNTIL_MS = Date.parse("2026-10-03T23:59:59.000Z");

if (
  !Number.isFinite(COMMENT_VOLUME_BOOST_FROM_MS) ||
  !Number.isFinite(COMMENT_VOLUME_BOOST_UNTIL_MS)
) {
  throw new Error("COMMENT_VOLUME_BOOST window is not a valid date range");
}

export const COMMENT_VOLUME_CHANCE_MULT = 3;
export const COMMENT_VOLUME_CAP_MULT = 3;
/** During the boost, spend less budget on busy threads. */
export const COMMENT_VOLUME_BOOST_REPLY_PROBABILITY = 0.10;
/** During the boost, loosen specialty bias so orphan categories (food-drink, etc.) get filled. */
export const COMMENT_VOLUME_BOOST_CATEGORY_BIAS = 0.40;

export function isCommentVolumeBoostActive(now: Date): boolean {
  const t = now.getTime();
  return t >= COMMENT_VOLUME_BOOST_FROM_MS && t < COMMENT_VOLUME_BOOST_UNTIL_MS;
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
