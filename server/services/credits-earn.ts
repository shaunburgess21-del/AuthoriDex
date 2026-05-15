/**
 * Engagement credit-earn helpers. Thin wrappers around
 * `gamificationService.adjustCredits()` that:
 *
 *   1. Standardise idempotency keys per surface so the same
 *      vote / comment / insight cannot be paid twice (and so
 *      reset+reclimb scenarios for streak milestones cannot
 *      double-pay across resets).
 *   2. Swallow errors with a structured log line — credit awards
 *      are a side-effect of the primary action and must never
 *      abort the request that triggered them.
 *   3. Keep the per-action key + key shape in ONE place so a
 *      future schema rename only touches this file.
 *
 * Production paths (prediction stake / payout / refund / jackpot
 * settlement / AMM trades / signup grant / admin adjustments)
 * deliberately do NOT route through here — they continue to
 * inline their own ledger writes against the original idempotency
 * key conventions. New earn-loop call sites consolidate here.
 */

import { gamificationService } from "./gamification";

interface EarnResultLog {
  userId: string;
  surface: string;
  awarded: boolean;
  amount?: number;
  reason?: string;
}

/**
 * Common error swallow + structured log. Credit failures must never
 * propagate to the request handler — the primary action (vote /
 * comment / insight / approval) has already succeeded by the time
 * we land here.
 */
function logResult(result: EarnResultLog): void {
  if (result.awarded) {
    // Successful awards are intentionally silent in production —
    // the user-visible signal is the balance change. Add a debug
    // log here only when chasing a specific incident.
    return;
  }
  if (result.reason && result.reason !== "daily_cap" && result.reason !== "duplicate") {
    // daily_cap and duplicate are expected steady-state outcomes;
    // everything else is worth a console line.
    console.warn(
      `[credits-earn] no-award userId=${result.userId} surface=${result.surface} reason=${result.reason}`,
    );
  }
}

/**
 * Award `vote_any` credits for sentiment / matchup / curation /
 * induction / opinion votes. Daily-capped (default 10/day) so
 * we don't pay out for vote spam. The voteType + entityId pair
 * must uniquely identify the cast vote across surfaces.
 */
export async function awardVoteCredits(
  userId: string,
  voteType: string,
  entityId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await gamificationService.adjustCredits(
      userId,
      "vote_any",
      `credit_vote_${voteType}_${entityId}_${userId}`,
      {
        metadata: { voteType, entityId, ...(metadata ?? {}) },
      },
    );
    logResult({
      userId,
      surface: `vote:${voteType}`,
      awarded: result.awarded,
      amount: result.amount,
      reason: result.reason,
    });
  } catch (err) {
    console.error(
      `[credits-earn] vote_any threw userId=${userId} voteType=${voteType} entityId=${entityId}`,
      err,
    );
  }
}

/**
 * Award `comment_insight` credits when a user posts a top-level
 * comment / insight reply. Daily-capped (default 5/day).
 *
 * Caller is responsible for the "min 20 chars" + "not on own
 * insight" gates — the credit helper only enforces the per-day
 * cap and idempotency.
 */
export async function awardCommentCredits(
  userId: string,
  commentId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await gamificationService.adjustCredits(
      userId,
      "comment_insight",
      `credit_comment_${commentId}_${userId}`,
      { metadata: { commentId, ...(metadata ?? {}) } },
    );
    logResult({
      userId,
      surface: "comment",
      awarded: result.awarded,
      amount: result.amount,
      reason: result.reason,
    });
  } catch (err) {
    console.error(
      `[credits-earn] comment_insight threw userId=${userId} commentId=${commentId}`,
      err,
    );
  }
}

/** Award `post_insight` credits for a top-level community insight. */
export async function awardInsightCredits(
  userId: string,
  insightId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await gamificationService.adjustCredits(
      userId,
      "post_insight",
      `credit_insight_${insightId}_${userId}`,
      { metadata: { insightId, ...(metadata ?? {}) } },
    );
    logResult({
      userId,
      surface: "insight",
      awarded: result.awarded,
      amount: result.amount,
      reason: result.reason,
    });
  } catch (err) {
    console.error(
      `[credits-earn] post_insight threw userId=${userId} insightId=${insightId}`,
      err,
    );
  }
}

/**
 * Award `suggestion_approved` credits when a content suggestion
 * goes live. Idempotency key is keyed on suggestion id only (no
 * userId) so re-approval after a reject/restore cannot double-pay.
 */
export async function awardSuggestionApprovedCredits(
  userId: string,
  suggestionId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await gamificationService.adjustCredits(
      userId,
      "suggestion_approved",
      `credit_suggestion_approved_${suggestionId}`,
      { metadata: { suggestionId, ...(metadata ?? {}) } },
    );
    logResult({
      userId,
      surface: "suggestion_approved",
      awarded: result.awarded,
      amount: result.amount,
      reason: result.reason,
    });
  } catch (err) {
    console.error(
      `[credits-earn] suggestion_approved threw userId=${userId} suggestionId=${suggestionId}`,
      err,
    );
  }
}

/** Award `market_suggestion_approved` credits when a world-market suggestion is published. */
export async function awardMarketSuggestionApprovedCredits(
  userId: string,
  marketId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await gamificationService.adjustCredits(
      userId,
      "market_suggestion_approved",
      `credit_market_suggestion_${marketId}`,
      { metadata: { marketId, ...(metadata ?? {}) } },
    );
    logResult({
      userId,
      surface: "market_suggestion_approved",
      awarded: result.awarded,
      amount: result.amount,
      reason: result.reason,
    });
  } catch (err) {
    console.error(
      `[credits-earn] market_suggestion_approved threw userId=${userId} marketId=${marketId}`,
      err,
    );
  }
}

/**
 * Award streak-milestone credits. Idempotency key encodes
 * (milestoneDay, userId) so reset+reclimb cannot double-pay.
 * Mirrors the XP milestone idempotency pattern in
 * gamification-routes.ts.
 */
export async function awardStreakMilestoneCredits(
  userId: string,
  milestoneDay: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const actionKey = `streak_milestone_${milestoneDay}_credits`;
  try {
    const result = await gamificationService.adjustCredits(
      userId,
      actionKey,
      `credit_streak_${milestoneDay}_${userId}`,
      { metadata: { milestoneDay, ...(metadata ?? {}) } },
    );
    logResult({
      userId,
      surface: `streak:${milestoneDay}`,
      awarded: result.awarded,
      amount: result.amount,
      reason: result.reason,
    });
    return;
  } catch (err) {
    console.error(
      `[credits-earn] ${actionKey} threw userId=${userId}`,
      err,
    );
  }
}
