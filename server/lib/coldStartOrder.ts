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
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";
import type { AuthRequest } from "../auth-middleware";
import { expandStatedInterests } from "@shared/interest-groups";

// ── Tunable constants ────────────────────────────────────────────────
//
// Defaults and env overrides now live in server/lib/rankingConfig.ts
// (Phase 3). These re-exports preserve the Phase 1/2 import surface so
// nothing in the wider codebase had to change when the config module
// was introduced.
export {
  PERSONALISED_FRESHNESS_BOOST_DAYS,
  PERSONALISED_INDUCTION_VOTE_BOOST,
} from "./rankingConfig";
import {
  PERSONALISED_FRESHNESS_BOOST_DAYS,
  PERSONALISED_INDUCTION_VOTE_BOOST,
} from "./rankingConfig";

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

    const rawInterests = Array.isArray(row?.statedInterests)
      ? (row!.statedInterests as string[])
      : [];
    const interests = expandStatedInterests(rawInterests);
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
 * SQL ORDER BY expression for recency-ranked feeds with a personalised
 * thumb. Returns "effective age in days minus boost" — sort ASC for the
 * standard "freshest first" reading.
 *
 * Worked example with default 14-day boost:
 *   * 1-day-old   non-interest card -> 1.0  days
 *   * 50-day-old  interest     card -> 50 - 14 = 36 days
 *   * 50-day-old  non-interest card -> 50 days
 *   * 64-day-old  interest     card -> 50 days  (tied with above)
 * → Sort ASC produces: fresh non-interest first, then interest cluster,
 *   then stale non-interest. Newer non-interest can outrank older
 *   interest, but only when the age gap is bigger than the boost — that's
 *   the "thumb on scale, not a wall" interleaving.
 */
export function personalisedRecencyOrder(
  createdAtCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
  interests: string[],
  boostDays: number = PERSONALISED_FRESHNESS_BOOST_DAYS,
): SQL {
  const lcInterests = interests.map((i) => i.toLowerCase());
  // Cast boostDays to float8 so Postgres unifies the CASE branches as
  // float, not integer. Without the cast, the ELSE 0 (integer literal)
  // forces $boostDays to be inferred as integer, and a fractional value
  // (e.g. 1.5) fails with "invalid input syntax for type integer".
  return sql`EXTRACT(EPOCH FROM (NOW() - ${createdAtCol})) / 86400.0
             - CASE WHEN ${inArray(sql`LOWER(${categoryCol})`, lcInterests)} THEN ${boostDays}::float8 ELSE 0 END`;
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

/**
 * Whether this request should use the cold-start ordering (no blend
 * signal: anonymous, or signed-in with no stated interests and no
 * meaningful behavioural engagement). Mirrors the branch inside the
 * orderer wrappers so routes can gate post-query JS re-sorts (e.g. the
 * World Markets volume sort) and keep the admin-curated order intact for
 * cold-start users. Reuses the per-request memoised blend state.
 */
export async function isColdStartUser(req: AuthRequest): Promise<boolean> {
  const state = await resolveBlendState(req);
  return !hasBlendSignal(state);
}

// ── Higher-level "build the right ORDER BY for this user" wrappers ──
//
// These return an array of ORDER BY terms ready to splat into Drizzle's
// `.orderBy(...)`. Each route picks the wrapper matching its existing
// sort shape and passes the relevant columns. This keeps route code
// untouched apart from one helper call instead of an inline ternary.
//
// Phase 3 layering (no breaking changes to call sites):
//   1. resolveBlendState → unified stated + behavioural state.
//   2. hasBlendSignal() → if true, use the blended SQL helpers (per-
//      category CASE bias that combines stated + decayed behaviour).
//   3. otherwise → cold-start (politics soft-deprioritised, recency).
//
// Phase 2's personalised* helpers are kept only as an implementation
// detail of blendedRecencyOrder etc.; no wrapper routes through them
// directly anymore. Call sites in routes.ts are unchanged.

import {
  resolveBlendState,
  hasBlendSignal,
  blendedRecencyOrder,
  blendedSeedVotesScore,
  blendedInterestBucket,
  preferredCategorySet,
} from "./blendedRank";
import { getCategoryBucketId } from "@shared/constants";

/**
 * The user's preferred category buckets (stated ∪ decayed behavioural),
 * normalised through `getCategoryBucketId` — or null when this request
 * should keep the cold-start admin-curated order.
 *
 * The Vote list routes pair this with `sortByInterestThenVotes` to
 * bucket interests above everything else and rank by vote count inside
 * each bucket. Needed as a JS pass because vote totals only exist after
 * the query. Reuses the per-request memoised blend state, so calling it
 * next to one of the order helpers below costs nothing extra.
 */
export async function resolvePreferredCategoriesForUser(
  req: AuthRequest,
): Promise<Set<string> | null> {
  const state = await resolveBlendState(req);
  if (!hasBlendSignal(state)) return null;
  const preferred = preferredCategorySet(state);
  if (preferred.size === 0) return null;
  return new Set(Array.from(preferred, (id) => getCategoryBucketId(id)));
}

/**
 * Recency-ranked "All" feed (createdAt DESC).
 * Used by trending-polls, matchups, opinion-polls.
 *
 * For signed-in users with a blend signal those three Vote routes then
 * re-sort in JS via `sortByInterestThenVotes` (interest bucket → votes).
 * The SQL order here is kept as the equal-vote tiebreak.
 */
export async function orderRecencyForUser(
  req: AuthRequest,
  createdAtCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
  displayOrderCol?: AnyColumn | SQL,
): Promise<SQL[]> {
  const state = await resolveBlendState(req);
  if (hasBlendSignal(state)) {
    return [blendedRecencyOrder(createdAtCol, categoryCol, state)];
  }
  // Cold-start: admin-curated manual order wins. Cards with an explicit
  // display_order (> 0) lead in that exact order; un-placed cards fall
  // below, politics-soft-deprioritised then newest-first.
  if (displayOrderCol) {
    return [
      sql`CASE WHEN COALESCE(${displayOrderCol}, 0) > 0 THEN 0 ELSE 1 END`,
      asc(displayOrderCol),
      coldStartCategoryRank(categoryCol),
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
  displayOrderCol?: AnyColumn | SQL,
): Promise<SQL[]> {
  const state = await resolveBlendState(req);
  if (hasBlendSignal(state)) {
    // Featured items still float to the top (editorial signal trumps
    // personalisation); within each featured group, the blended
    // recency expression interleaves preferred (stated + behavioural)
    // categories with the rest.
    return [
      desc(featuredCol),
      blendedRecencyOrder(createdAtCol, categoryCol, state),
    ];
  }
  // Cold-start: admin-curated manual order wins. Markets with an explicit
  // cms_display_order (> 0) lead in that exact order; un-placed markets
  // fall below by featured, politics-soft-deprioritised, then newest-first.
  if (displayOrderCol) {
    return [
      sql`CASE WHEN COALESCE(${displayOrderCol}, 0) > 0 THEN 0 ELSE 1 END`,
      asc(displayOrderCol),
      desc(featuredCol),
      coldStartCategoryRank(categoryCol),
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
  const state = await resolveBlendState(req);
  if (hasBlendSignal(state)) {
    return [desc(blendedSeedVotesScore(seedVotesCol, categoryCol, state))];
  }
  return [coldStartCategoryRank(categoryCol), desc(seedVotesCol)];
}

/**
 * Featured-then-category feed (featured DESC, category alphabetical).
 * Used by native-markets/updown — there's no per-row recency to thumb
 * since weekly markets are all created at week start, so we bucket
 * preferred categories (stated ∪ decayed-behavioural) above the rest
 * within each featured tier.
 */
export async function orderFeaturedCategoryForUser(
  req: AuthRequest,
  featuredCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
): Promise<SQL[]> {
  const state = await resolveBlendState(req);
  if (hasBlendSignal(state)) {
    return [
      desc(featuredCol),
      blendedInterestBucket(categoryCol, state),
      categoryCol as SQL,
    ];
  }
  return [
    coldStartCategoryRank(categoryCol),
    desc(featuredCol),
    categoryCol as SQL,
  ];
}
