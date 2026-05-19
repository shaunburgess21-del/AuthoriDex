// Phase 3 Interest Picker — behavioural blending ranking.
//
// Extends the Phase 2 ranking pipeline with a behavioural thumb that
// activates once a user has real engagement spread across multiple
// categories. See the Phase 3 plan for the full decision log; the
// short version:
//
//   * Cold-start + stated-only users: unchanged Phase 2 behaviour.
//   * Users with stated interests AND behavioural signal (≥ the ramp
//     floor of distinct categories engaged): blended score = stated
//     thumb (Phase 2) + behavioural thumb (decayed aggregate of past
//     votes/bets in each category), weighted by the blend curve that
//     anchors on first engagement.
//   * Behavioural-only users (skipped the picker but engaged): the
//     blend still applies; stated contribution is zero.
//
// Casing contract (identical to coldStartOrder.ts): content category
// columns are compared via SQL LOWER(...), behavioural category ids
// come from the DB already lowercase (CHECK constraint), stated
// interests are lowercased on the JS side. See the Phase 2 root-cause
// note for why this is structural, not discipline.

import type { AnyColumn, SQL } from "drizzle-orm";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { profiles, userCategoryEngagement } from "@shared/schema";
import type { AuthRequest } from "../auth-middleware";
import {
  PERSONALISED_FRESHNESS_BOOST_DAYS,
  PERSONALISED_INDUCTION_VOTE_BOOST,
  behaviourRampProgress,
  decayFactor,
  statedWeightAtDays,
} from "./rankingConfig";
import { expandStatedInterests } from "@shared/interest-groups";

// ── Blend state (per-request memoisation) ───────────────────────────

/**
 * Decayed behavioural score for one category. `raw` is vote_count +
 * betWeight (no decay applied); `decayed` is the value we actually
 * blend with. Kept separate so the admin debug endpoint can show
 * both without recomputing.
 */
export type CategoryBehaviouralScore = {
  categoryId: string;
  raw: number;
  decayed: number;
  lastEngagedDaysAgo: number;
};

export type BlendState = {
  authenticated: boolean;
  /** Stated interests, lowercase. Empty = user skipped / not yet picked. */
  stated: string[];
  /**
   * Map of categoryId -> decayed behavioural score. Only includes
   * categories with non-zero decayed score; empty when the user has
   * no engagement rows.
   */
  behavioural: Map<string, CategoryBehaviouralScore>;
  /**
   * Distinct categories with ≥1 engagement event. Drives the ramp.
   */
  distinctCategoryCount: number;
  /**
   * 0..1. 0 = below ramp floor (behavioural signal ignored); 1 = full
   * ramp; linear in between. See rankingConfig.behaviourRampProgress.
   */
  rampProgress: number;
  /**
   * Days since the user's FIRST category-attributed engagement (min
   * first_engaged_at across all engagement rows). null if no rows.
   */
  daysSinceFirstEngagement: number | null;
  /**
   * Final blend weights (stated + behaviour = 1 after ramp attenuation
   * has been folded in). statedEffective is the share of ranking
   * influence currently assigned to stated interests for this user.
   */
  statedEffectiveWeight: number;
  behaviourEffectiveWeight: number;
};

type BlendCacheBag = AuthRequest & { __blendState?: BlendState };

/**
 * Empty blend state — used for anonymous users, users who skipped the
 * picker and have no behaviour yet, or DB-error fallbacks.
 */
function emptyBlendState(authenticated: boolean): BlendState {
  return {
    authenticated,
    stated: [],
    behavioural: new Map(),
    distinctCategoryCount: 0,
    rampProgress: 0,
    daysSinceFirstEngagement: null,
    statedEffectiveWeight: 1,
    behaviourEffectiveWeight: 0,
  };
}

/**
 * Pure helper that computes a {@link BlendState} from a userId. Used
 * directly by `resolveBlendState` (the per-request entry point) and by
 * the admin debug endpoint which needs the same state for an arbitrary
 * target user, not the requester.
 *
 * Returns `emptyBlendState(true)` on DB error so downstream ORDER BY
 * helpers fall back to cold-start rather than leaking unranked content.
 */
export async function computeBlendStateForUser(userId: string): Promise<BlendState> {
  try {
    const [profileRow, engagementRows] = await Promise.all([
      db
        .select({ statedInterests: profiles.statedInterests })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1),
      db
        .select({
          categoryId: userCategoryEngagement.categoryId,
          voteCount: userCategoryEngagement.voteCount,
          betWeight: userCategoryEngagement.betWeight,
          firstEngagedAt: userCategoryEngagement.firstEngagedAt,
          lastEngagedAt: userCategoryEngagement.lastEngagedAt,
        })
        .from(userCategoryEngagement)
        .where(eq(userCategoryEngagement.userId, userId)),
    ]);

    const rawStated = Array.isArray(profileRow[0]?.statedInterests)
      ? (profileRow[0]!.statedInterests as string[])
      : [];
    const stated = expandStatedInterests(rawStated);

    const now = Date.now();
    const behavioural = new Map<string, CategoryBehaviouralScore>();
    let earliestFirstEngagement = Number.POSITIVE_INFINITY;
    let distinctCount = 0;

    for (const row of engagementRows) {
      const raw =
        (row.voteCount ?? 0) + parseFloat((row.betWeight as unknown as string) ?? "0");
      if (raw <= 0) continue;

      distinctCount += 1;

      const lastEngagedMs = row.lastEngagedAt ? new Date(row.lastEngagedAt).getTime() : now;
      const daysSinceLast = Math.max(0, (now - lastEngagedMs) / 86_400_000);
      const decay = decayFactor(daysSinceLast);
      const decayed = raw * decay;

      if (decayed <= 0) continue;

      behavioural.set(row.categoryId, {
        categoryId: row.categoryId,
        raw,
        decayed,
        lastEngagedDaysAgo: daysSinceLast,
      });

      const firstEngagedMs = row.firstEngagedAt
        ? new Date(row.firstEngagedAt).getTime()
        : now;
      if (firstEngagedMs < earliestFirstEngagement) {
        earliestFirstEngagement = firstEngagedMs;
      }
    }

    const daysSinceFirstEngagement = Number.isFinite(earliestFirstEngagement)
      ? Math.max(0, (now - earliestFirstEngagement) / 86_400_000)
      : null;

    const ramp = behaviourRampProgress(distinctCount);

    // Blend weights: statedRaw comes from the anchor curve, then we
    // scale behaviour by the ramp so early-engagement users don't jump
    // to full behavioural trust. The residual from scaling goes back to
    // stated so the weights always sum to 1.
    let statedEffective = 1;
    let behaviourEffective = 0;
    if (stated.length > 0 && daysSinceFirstEngagement !== null && ramp > 0) {
      const statedAnchor = statedWeightAtDays(daysSinceFirstEngagement);
      const behaviourAnchor = 1 - statedAnchor;
      behaviourEffective = behaviourAnchor * ramp;
      statedEffective = 1 - behaviourEffective;
    } else if (stated.length === 0 && ramp > 0 && daysSinceFirstEngagement !== null) {
      // Behavioural-only (skipped picker but engaged): behaviour takes
      // over completely, scaled by ramp. No stated anchor to lean on.
      behaviourEffective = ramp;
      statedEffective = 1 - ramp;
    }

    return {
      authenticated: true,
      stated,
      behavioural,
      distinctCategoryCount: distinctCount,
      rampProgress: ramp,
      daysSinceFirstEngagement,
      statedEffectiveWeight: statedEffective,
      behaviourEffectiveWeight: behaviourEffective,
    };
  } catch (err) {
    console.error("[blendedRank] computeBlendStateForUser failed:", err);
    return emptyBlendState(true);
  }
}

/**
 * Resolve the combined stated + behavioural state for the current
 * request. Memoised on the request object so routes that compose
 * multiple ordered queries (e.g. open-markets with two pagination
 * pages) pay for the DB reads once.
 */
export async function resolveBlendState(req: AuthRequest): Promise<BlendState> {
  const bag = req as BlendCacheBag;
  if (bag.__blendState) return bag.__blendState;

  const userId = req.userId;
  if (!userId) {
    const state = emptyBlendState(false);
    bag.__blendState = state;
    return state;
  }

  const state = await computeBlendStateForUser(userId);
  bag.__blendState = state;
  return state;
}

// ── SQL helpers ─────────────────────────────────────────────────────
//
// Each helper returns an ORDER BY expression or array of expressions
// that can be splatted directly into Drizzle's `.orderBy(...)`. The
// behavioural contribution is encoded as a large `CASE WHEN LOWER(cat)
// IN (...) THEN bias ELSE 0 END` — one branch per category with a live
// blended bias. Postgres plans this fine at 12 categories max; no
// temp table or join on the hot path.

/**
 * Build a SQL CASE expression that maps LOWER(categoryCol) → a bias
 * value per category. Empty map → literal 0 (SQL constant).
 */
function categoryBiasCase(
  categoryCol: AnyColumn | SQL,
  biasPerCategory: Map<string, number>,
): SQL {
  if (biasPerCategory.size === 0) {
    return sql`0::float8`;
  }
  // Build the CASE expression incrementally so we can interpolate the
  // category ids (bound params) rather than concatenating strings.
  const branches: SQL[] = [];
  for (const [categoryId, bias] of biasPerCategory) {
    if (!Number.isFinite(bias) || bias === 0) continue;
    branches.push(
      sql`WHEN LOWER(${categoryCol}) = ${categoryId} THEN ${bias.toFixed(6)}::float8`,
    );
  }
  if (branches.length === 0) {
    return sql`0::float8`;
  }
  return sql`CASE ${sql.join(branches, sql` `)} ELSE 0::float8 END`;
}

/**
 * Aggregate per-category bias for a recency-based feed. Combines:
 *   * stated thumb: +PERSONALISED_FRESHNESS_BOOST_DAYS days for any
 *     category in the user's stated list, weighted by statedEffective.
 *   * behavioural thumb: +PERSONALISED_FRESHNESS_BOOST_DAYS days scaled
 *     by the normalised decayed score, weighted by behaviourEffective.
 */
function recencyBiasMap(
  state: BlendState,
  boostDays: number = PERSONALISED_FRESHNESS_BOOST_DAYS,
): Map<string, number> {
  const biases = new Map<string, number>();

  const maxDecayed = state.behavioural.size > 0
    ? Math.max(...Array.from(state.behavioural.values()).map((b) => b.decayed))
    : 0;

  for (const id of state.stated) {
    biases.set(id, (biases.get(id) ?? 0) + boostDays * state.statedEffectiveWeight);
  }

  if (state.behaviourEffectiveWeight > 0 && maxDecayed > 0) {
    for (const score of state.behavioural.values()) {
      const normalised = score.decayed / maxDecayed; // 0..1
      const extra = boostDays * state.behaviourEffectiveWeight * normalised;
      biases.set(score.categoryId, (biases.get(score.categoryId) ?? 0) + extra);
    }
  }
  return biases;
}

/**
 * Same idea as recencyBiasMap but scaled by the induction vote boost
 * instead of a freshness day budget.
 */
function seedVotesBiasMap(
  state: BlendState,
  voteBoost: number = PERSONALISED_INDUCTION_VOTE_BOOST,
): Map<string, number> {
  const biases = new Map<string, number>();
  const maxDecayed = state.behavioural.size > 0
    ? Math.max(...Array.from(state.behavioural.values()).map((b) => b.decayed))
    : 0;

  for (const id of state.stated) {
    biases.set(id, (biases.get(id) ?? 0) + voteBoost * state.statedEffectiveWeight);
  }

  if (state.behaviourEffectiveWeight > 0 && maxDecayed > 0) {
    for (const score of state.behavioural.values()) {
      const normalised = score.decayed / maxDecayed;
      const extra = voteBoost * state.behaviourEffectiveWeight * normalised;
      biases.set(score.categoryId, (biases.get(score.categoryId) ?? 0) + extra);
    }
  }
  return biases;
}

/**
 * Recency ORDER BY for the blended path. Mirrors
 * `personalisedRecencyOrder` from coldStartOrder.ts but the per-category
 * boost is a CASE, not a single WHEN IN (...).
 */
export function blendedRecencyOrder(
  createdAtCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
  state: BlendState,
): SQL {
  const bias = categoryBiasCase(categoryCol, recencyBiasMap(state));
  return sql`EXTRACT(EPOCH FROM (NOW() - ${createdAtCol})) / 86400.0 - (${bias})`;
}

/**
 * SeedVotes ORDER BY for the blended path (induction feed).
 */
export function blendedSeedVotesScore(
  seedVotesCol: AnyColumn | SQL,
  categoryCol: AnyColumn | SQL,
  state: BlendState,
): SQL {
  const bias = categoryBiasCase(categoryCol, seedVotesBiasMap(state));
  return sql`${seedVotesCol} + (${bias})`;
}

/**
 * Bucket expression (0 = in interest/behaviour, 1 = not) for feeds
 * without a recency dimension (native-markets/updown). Uses the union
 * of stated interests and categories with decayed behavioural score
 * above a small epsilon — this is the thumb on a tier-less feed.
 */
export function blendedInterestBucket(
  categoryCol: AnyColumn | SQL,
  state: BlendState,
): SQL {
  const preferredIds = new Set<string>();
  for (const id of state.stated) preferredIds.add(id);
  if (state.behaviourEffectiveWeight > 0) {
    for (const score of state.behavioural.values()) {
      if (score.decayed > 0.01) preferredIds.add(score.categoryId);
    }
  }
  if (preferredIds.size === 0) {
    return sql`1`;
  }
  const branches: SQL[] = [];
  for (const id of preferredIds) {
    branches.push(sql`WHEN LOWER(${categoryCol}) = ${id} THEN 0`);
  }
  return sql`CASE ${sql.join(branches, sql` `)} ELSE 1 END`;
}

/**
 * True when the blended path should be used for this request. The
 * calling wrappers in coldStartOrder.ts only fall through to Phase 2
 * ordering when this returns false — this is the single switch point
 * between Phase 2 and Phase 3 behaviour.
 */
export function hasBlendSignal(state: BlendState): boolean {
  return (
    state.stated.length > 0 ||
    (state.behaviourEffectiveWeight > 0 && state.behavioural.size > 0)
  );
}

// Re-export desc for any call sites that want the same helpers as Phase 2.
export { desc };
