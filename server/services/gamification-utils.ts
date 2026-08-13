import { CAPABILITY_MIN_TIER, type Capability } from "@shared/rank-config";

export type { Capability };

/**
 * Tier-gated capability check. Reads the canonical
 * (capability → minTier) map from shared/rank-config.ts so the
 * server, the client UI, and the Ranks tab cannot drift apart.
 *
 * Capabilities not listed in CAPABILITY_MIN_TIER are treated as
 * Tier 1 (open to every authenticated user) — that's the
 * ungated-baseline tier where can_vote_sentiment / can_vote_matchup
 * / can_predict live.
 */
export function canAccessCapability(tier: number, capability: Capability): boolean {
  const required = CAPABILITY_MIN_TIER[capability];
  if (required === undefined) return true;
  return tier >= required;
}

/**
 * Returns the minimum tier required for a capability. Used by the
 * requireMinTier middleware to surface the threshold in 403 error
 * payloads. Defaults to 1 (open) for unknown capabilities so a
 * forgotten gate doesn't accidentally lock everyone out.
 */
export function minTierForCapability(capability: Capability): number {
  return CAPABILITY_MIN_TIER[capability] ?? 1;
}

export function computeCreditBalance(currentBalance: number, amount: number): number | null {
  const nextBalance = currentBalance + amount;
  return nextBalance < 0 ? null : nextBalance;
}

/**
 * Apply a per-tier earn multiplier to a base XP / credit value and round
 * to an integer. XP and credits are always whole numbers in our ledgers,
 * so we round half-up (`Math.round`) consistently across both paths.
 * Pulled out as a pure helper so the multiplier rounding is unit-testable
 * without a DB transaction. Callers decide WHETHER to scale (exempt
 * bookkeeping actions pass `multiplier = 1.0`).
 */
export function scaleEarnedValue(baseValue: number, multiplier: number): number {
  return Math.round(baseValue * multiplier);
}

/**
 * Bookkeeping XP actions — never earn-multiplied, and still written for
 * simulation agents (ops parks / legacy seed). Participation actions
 * (`place_prediction`, `prediction_win`, votes, comments, …) are skipped
 * for `is_agent` profiles so the fleet cannot reconverge onto one rank.
 */
export const XP_BOOKKEEPING_ACTIONS = ["legacy_migration", "admin_adjustment"] as const;

export function isXpBookkeepingAction(actionType: string): boolean {
  return (XP_BOOKKEEPING_ACTIONS as readonly string[]).includes(actionType);
}

/**
 * Simulation agents share the human XP ladder (rank = f(xp_points)) but
 * they must not keep accruing participation XP — identical market flow
 * otherwise piles them onto a single rank. Bookkeeping rows still land
 * so a one-time park can write `admin_adjustment`.
 */
export function shouldSkipXpAward(isAgent: boolean, actionType: string): boolean {
  return isAgent && !isXpBookkeepingAction(actionType);
}

/**
 * Canonical idempotency key for `prediction_win` XP: one award per
 * user per market. Resolvers MUST use this (via
 * `gamificationService.awardPredictionWinXp`) rather than embedding
 * bet ids — historical per-bet keys let DCA / multi-buy winners
 * multiply the uncapped win XP bonus.
 */
export function predictionWinIdempotencyKey(
  marketId: string,
  userId: string,
): string {
  return `prediction_win_${marketId}_${userId}`;
}
