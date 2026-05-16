/**
 * AMM bet placement post-tx hooks.
 *
 * Fires the four "side effects" that the deleted parimutuel
 * `placeMarketBet` helper used to run after a successful stake:
 *   1. `upsertEngagement`          — category-attributed signal for
 *                                    the Interest Picker / ranker.
 *   2. `gamificationService.awardXp('place_prediction', ...)` — XP +
 *                                    rank-ladder progression.
 *   3. `maybeFireReferralCredit`   — stamps `first_action_at` and pays
 *                                    out the referrer if applicable.
 *   4. `checkAndAwardPredictionBadges` — forecaster_1/2/3 ladder
 *                                    progression by total `market_bets`
 *                                    count.
 *
 * The fifth parimutuel-era side effect — bumping
 * `profiles.totalPredictions` — has moved into `executeBuy` itself so
 * it stays in lock-step with `market_bets` regardless of caller.
 *
 * The jackpot bet route fires a similar set inline. Non-jackpot AMM
 * bets (community / H2H / UpDown / Race) call this helper after
 * `executeBuy` returns successfully so all human placements stay in
 * lock-step regardless of market type.
 *
 * Contract:
 *   * Each hook is wrapped in its own try/catch so one failure can't
 *     mask another. None are awaited inside the trade transaction.
 *   * Designed to be called from HTTP route handlers only — the agent
 *     worker calls `executeBuy` directly and intentionally skips these
 *     hooks (agents don't progress badges, earn XP, or trigger
 *     engagement signals on their bets).
 *   * Returns the XP result so the route can echo it back to the
 *     client, matching the jackpot bet response shape.
 *   * Resolves successfully even when every hook fails. The one path
 *     where it *can* throw is if `captureBackgroundError` itself
 *     throws while reporting a primary failure — that's documented in
 *     `tests/amm-bet-hooks.test.ts` and considered out of scope to
 *     harden further (Sentry is fire-and-forget anyway).
 */

import { gamificationService } from "./gamification";
import { maybeFireReferralCredit } from "./credits-earn";
import { checkAndAwardPredictionBadges } from "./badges";
import { upsertEngagement } from "../lib/engagementWriter";
import { captureBackgroundError } from "../sentry";

export interface FireAmmPlacementHooksInput {
  userId: string;
  marketId: string;
  betId: string;
  stakeAmount: number;
  /** Canonical category id resolved from the market row. Pass `null`
   *  if the market has no category — the engagement upsert will no-op. */
  categoryId: string | null;
}

export interface FireAmmPlacementHooksResult {
  /** Awarded XP payload returned from `gamificationService.awardXp`,
   *  or `null` if the call failed. Mirrors the jackpot route's
   *  `{ xp: xpResult ?? null }` so client-side toast logic doesn't
   *  need to branch on market type. */
  xp: unknown | null;
}

/**
 * Injectable dependencies for `fireAmmPlacementHooks`. All optional —
 * production callers always use the defaults wired below. The interface
 * exists purely so the unit test in `tests/amm-bet-hooks.test.ts` can
 * substitute throwing stubs and confirm partial-failure resilience
 * without monkey-patching prod modules.
 */
export interface FireAmmPlacementHooksDeps {
  upsertEngagement: typeof upsertEngagement;
  awardXp: typeof gamificationService.awardXp;
  maybeFireReferralCredit: typeof maybeFireReferralCredit;
  checkAndAwardPredictionBadges: typeof checkAndAwardPredictionBadges;
  captureBackgroundError: typeof captureBackgroundError;
}

const defaultDeps: FireAmmPlacementHooksDeps = {
  upsertEngagement,
  awardXp: gamificationService.awardXp.bind(gamificationService),
  maybeFireReferralCredit,
  checkAndAwardPredictionBadges,
  captureBackgroundError,
};

export async function fireAmmPlacementHooks(
  input: FireAmmPlacementHooksInput,
  deps: Partial<FireAmmPlacementHooksDeps> = {},
): Promise<FireAmmPlacementHooksResult> {
  const d: FireAmmPlacementHooksDeps = { ...defaultDeps, ...deps };
  const { userId, marketId, betId, stakeAmount, categoryId } = input;

  try {
    await d.upsertEngagement({
      userId,
      categoryId,
      stakeCredits: stakeAmount,
      source: "amm-bet",
    });
  } catch (err) {
    console.warn("[amm-bet-hooks] engagement upsert failed:", err);
    d.captureBackgroundError(err, {
      surface: "amm-bet.engagement",
      userId,
      marketId,
    });
  }

  let xpResult: unknown | null = null;
  try {
    xpResult = await d.awardXp(
      userId,
      "place_prediction",
      `prediction_${marketId}_${betId}_${userId}`,
      { marketId, betId, stakeAmount },
    );
  } catch (err) {
    console.error("[amm-bet-hooks] XP award failed:", err);
    d.captureBackgroundError(err, {
      surface: "amm-bet.xp",
      userId,
      marketId,
      betId,
    });
  }

  try {
    await d.maybeFireReferralCredit(userId);
  } catch (err) {
    console.error("[amm-bet-hooks] referral credit failed:", err);
    d.captureBackgroundError(err, {
      surface: "amm-bet.referral",
      userId,
    });
  }

  try {
    await d.checkAndAwardPredictionBadges(userId);
  } catch (err) {
    console.error("[amm-bet-hooks] prediction badges failed:", err);
    d.captureBackgroundError(err, {
      surface: "amm-bet.badges",
      userId,
    });
  }

  return { xp: xpResult };
}
