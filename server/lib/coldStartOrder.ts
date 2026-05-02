// Interest-aware ORDER BY helpers shared by the Vote and Predict list
// endpoints.
//
// Two complementary modes live here:
//
//   * Cold-start (Phase 1) — for users with no preference signal yet:
//     anonymous visitors, and signed-in users who haven't picked any
//     interests (incl. "skipped" until they opt back in). We soft-
//     deprioritise contentious categories so default "All" feeds don't
//     lead with politics. Soft = bucket, not filter; nothing is hidden.
//
//   * Personalised (Phase 2) — for signed-in users with at least one
//     stated interest. We boost their interests as a "thumb on the
//     scale", deliberately small (~1.5 days of recency, or ~5 induction
//     votes) so a clearly hot non-interest card still surfaces ahead of
//     a stale interest card. This preserves the trending-override the
//     user explicitly asked for: stated interests must reorder the feed,
//     never become a hard filter on it.
//
// Scope (Phase 2): Vote and Predict card feeds only. The Value
// leaderboard, Fame leaderboard, and induction queue rankings live
// outside this scope — leaderboards are governed by their own canonical
// scoring and shouldn't be personalised. The Phase 1 cold-start hook on
// `/api/leaderboard?tab=value` is intentionally left as-is for that
// surface (politics-deprioritised default for cold users); Phase 2
// reranking does NOT touch it.
//
// Design constraints (from product owner):
//   * Interleave, never wall. Boost is small enough to not bury hot
//     non-interest cards.
//   * Trending override. A high-momentum recent card outside stated
//     interests must still surface in "All".
//   * Politics picked explicitly = boosted normally (overrides the
//     cold-start politics rule for that specific user).

import type { AnyColumn, SQL } from "drizzle-orm";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";
import type { AuthRequest } from "../auth-middleware";

// ── Tunable constants ────────────────────────────────────────────────
//
// PERSONALISED_TRENDING_OVERRIDE_HOURS: a "very fresh" non-interest card
// younger than this still earns the top tier alongside interest cards,
// so genuinely hot/breaking content surfaces even when it's outside the
// user's stated interests. Beyond this window, non-interest cards drop
// to the second tier.
//
// PERSONALISED_INDUCTION_VOTE_BOOST: thumb on the scale for the induction
// feed which is ranked by seedVotes (not recency). ~5 votes lifts a
// candidate inside the user's interests above an evenly-matched one
// outside, but the genuine vote leader still wins.
export const PERSONALISED_TRENDING_OVERRIDE_HOURS = 24;
export const PERSONALISED_INDUCTION_VOTE_BOOST = 5;

// ── Per-request memoisation ─────────────────────────────────────────
//
// Both helpers (cold-start and personalised) need the same thing: the
// signed-in user's stated interests. We resolve once per request and
// stash on the request object so a route that composes multiple ordered
// queries doesn't pay for the lookup twice.
type InterestsState = {
  authenticated: boolean;
  /** Stated interests, possibly empty. Always an array. */
  interests: string[];
};

type InterestsCacheBag = AuthRequest & { __interestsState?: InterestsState };

async function resolveInterestsState(req: AuthRequest): Promise<InterestsState> {
  const bag = req as InterestsCacheBag;
  if (bag.__interestsState) {
    return bag.__interestsState;
  }

  const userId = req.userId;
  if (!userId) {
    const state: InterestsState = { authenticated: false, interests: [] };
    bag.__interestsState = state;
    return state;
  }

  try {
    const [row] = await db
      .select({ statedInterests: profiles.statedInterests })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    const interests = Array.isArray(row?.statedInterests)
      ? (row!.statedInterests as string[])
      : [];
    const state: InterestsState = { authenticated: true, interests };
    bag.__interestsState = state;
    return state;
  } catch (err) {
    // Transient DB blip — fall back to "anonymous-equivalent" so we use
    // the cold-start ordering. Safer default than leaking unranked
    // politics-heavy content on errors.
    console.error("[interestOrder] resolveInterestsState failed:", err);
    const state: InterestsState = { authenticated: false, interests: [] };
    bag.__interestsState = state;
    return state;
  }
}

// ── Casing contract ─────────────────────────────────────────────────
//
// `profiles.stated_interests` is stored lowercase (the Interests Picker
// emits canonical ids: 'politics', 'tech', 'music', ...). The category
// column on content tables (`trending_polls`, `opinion_polls`,
// `matchups`, `prediction_markets`, `induction_candidates`) is mixed
// Title Case / lowercase depending on when and how it was inserted
// (e.g. 'Politics', 'Tech', but 'misc'). Until we structurally normalise
// categories (canonical id + UI lookup; tracked separately), all
// category comparisons in this file MUST lowercase BOTH SIDES — column
// via SQL `LOWER()`, interests array via `.map(i => i.toLowerCase())`.
// Add a new helper? Follow the same pattern.

// ── Cold-start helpers (unchanged from Phase 1) ─────────────────────

/**
 * SQL fragment producing 1 for deprioritised categories and 0 for everything
 * else. Use as the **first** ORDER BY term so the existing ordering becomes
 * the tiebreaker within each bucket.
 */
export function coldStartCategoryRank(col: AnyColumn | SQL): SQL {
  return sql`CASE WHEN LOWER(${col}) = 'politics' THEN 1 ELSE 0 END`;
}

/**
 * Whether the cold-start ORDER BY should apply for this request.
 * True for anonymous users and signed-in users with no stated interests.
 * False once a user picks at least one interest (those use personalised).
 */
export async function shouldUseColdStart(req: AuthRequest): Promise<boolean> {
  const state = await resolveInterestsState(req);
  return state.interests.length === 0;
}

// ── Personalised helpers (Phase 2) ──────────────────────────────────

/**
 * SQL tier-rank fragment for recency-ranked feeds. Returns 0 for the
 * "top" tier (interest matches OR genuinely fresh content) and 1 for
 * everything else. Use as the **first** ORDER BY term, then desc(created_at)
 * as the within-tier tiebreaker.
 *
 * Worked example with default 24-hour trending window:
 *   * 1-hour-old non-interest card  -> tier 0 (trending override)
 *   * 5-day-old  interest     card  -> tier 0 (interest match)
 *   * 5-day-old  non-interest card  -> tier 1
 * → Top tier sorted by recency wins; bottom tier sorted by recency
 *   trails. Interest cards always lead, hot cards still surface.
 */
export function personalisedRecencyTier(
  createdAtCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
  interests: string[],
  trendingHours: number = PERSONALISED_TRENDING_OVERRIDE_HOURS,
): SQL {
  const lcInterests = interests.map((i) => i.toLowerCase());
  return sql`CASE
    WHEN ${inArray(sql`LOWER(${categoryCol})`, lcInterests)} THEN 0
    WHEN ${createdAtCol} > NOW() - (${trendingHours} || ' hours')::interval THEN 0
    ELSE 1
  END`;
}

/**
 * SQL expression for seedVotes-ranked feeds (induction). Adds a small
 * vote-equivalent boost when a candidate's category is in the user's
 * interests — sort DESC so the boosted score wins ties.
 */
export function personalisedSeedVotesScore(
  seedVotesCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
  interests: string[],
  voteBoost: number = PERSONALISED_INDUCTION_VOTE_BOOST,
): SQL {
  const lcInterests = interests.map((i) => i.toLowerCase());
  return sql`${seedVotesCol}
             + CASE WHEN ${inArray(sql`LOWER(${categoryCol})`, lcInterests)} THEN ${voteBoost} ELSE 0 END`;
}

/**
 * SQL fragment "is this row's category in my interests?" as 0 (yes,
 * sorts first ASC) / 1 (no). Used by feeds that don't have a recency
 * dimension (e.g. native-markets/updown which is featured + alphabetical
 * by category) so we can bucket interests above non-interests within an
 * existing tier.
 */
export function personalisedInterestBucket(
  categoryCol: AnyColumn | SQL,
  interests: string[],
): SQL {
  const lcInterests = interests.map((i) => i.toLowerCase());
  return sql`CASE WHEN ${inArray(sql`LOWER(${categoryCol})`, lcInterests)} THEN 0 ELSE 1 END`;
}

// ── Higher-level "build the right ORDER BY for this user" wrappers ──
//
// These return an array of ORDER BY terms ready to splat into Drizzle's
// `.orderBy(...)`. Each route picks the wrapper matching its existing
// sort shape and passes the relevant columns. This keeps route code
// untouched apart from one helper call instead of an inline ternary.

/**
 * Recency-ranked "All" feed (createdAt DESC).
 * Used by trending-polls, matchups, opinion-polls.
 */
export async function orderRecencyForUser(
  req: AuthRequest,
  createdAtCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
): Promise<SQL[]> {
  const state = await resolveInterestsState(req);
  if (state.interests.length > 0) {
    return [
      personalisedRecencyTier(createdAtCol, categoryCol, state.interests),
      desc(createdAtCol),
    ];
  }
  // Cold-start: politics-soft-deprioritised, then recency.
  return [coldStartCategoryRank(categoryCol), desc(createdAtCol)];
}

/**
 * Featured-then-recency feed (featured DESC, createdAt DESC).
 * Used by open-markets.
 */
export async function orderFeaturedRecencyForUser(
  req: AuthRequest,
  featuredCol: AnyColumn | SQL,
  createdAtCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
): Promise<SQL[]> {
  const state = await resolveInterestsState(req);
  if (state.interests.length > 0) {
    // Featured items still float to the top (editorial signal trumps
    // personalisation); within each featured group, the tier expression
    // interleaves interests + trending overrides above stale others.
    return [
      desc(featuredCol),
      personalisedRecencyTier(createdAtCol, categoryCol, state.interests),
      desc(createdAtCol),
    ];
  }
  return [
    coldStartCategoryRank(categoryCol),
    desc(featuredCol),
    desc(createdAtCol),
  ];
}

/**
 * SeedVotes-ranked feed (seedVotes DESC).
 * Used by vote/induction.
 */
export async function orderSeedVotesForUser(
  req: AuthRequest,
  seedVotesCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
): Promise<SQL[]> {
  const state = await resolveInterestsState(req);
  if (state.interests.length > 0) {
    return [
      desc(personalisedSeedVotesScore(seedVotesCol, categoryCol, state.interests)),
    ];
  }
  return [coldStartCategoryRank(categoryCol), desc(seedVotesCol)];
}

/**
 * Featured-then-category feed (featured DESC, category alphabetical).
 * Used by native-markets/updown — there's no per-row recency to thumb
 * since weekly markets are all created at week start, so we bucket
 * interests above non-interests within each featured tier.
 */
export async function orderFeaturedCategoryForUser(
  req: AuthRequest,
  featuredCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
): Promise<SQL[]> {
  const state = await resolveInterestsState(req);
  if (state.interests.length > 0) {
    return [
      desc(featuredCol),
      personalisedInterestBucket(categoryCol, state.interests),
      categoryCol as SQL,
    ];
  }
  return [
    coldStartCategoryRank(categoryCol),
    desc(featuredCol),
    categoryCol as SQL,
  ];
}
