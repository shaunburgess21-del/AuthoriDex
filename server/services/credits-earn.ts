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

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";
import { createNotification } from "./notifications";
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
 * Fire the `referral_completed` credit award for the referrer of
 * `userId` if and only if this is the very first meaningful action
 * the referee has ever taken.
 *
 * The referral funnel has three distinct events:
 *
 *   1. Signup with ?ref= → server stamps profiles.referred_by and
 *      awards referral_signup_bonus to the new user.
 *   2. First meaningful action by the referee (vote / prediction /
 *      comment / overall rating) → THIS function. Awards
 *      referral_completed to the referrer. Stamps both
 *      profiles.first_action_at on the referee and
 *      profiles.referral_credit_fired_at on the referrer.
 *   3. All subsequent actions → no-op (first_action_at is set, so
 *      step 1 of the guard-chain returns early).
 *
 * Designed to be idempotent at three layers:
 *
 *   - first_action_at on the referee blocks re-entry
 *   - referral_credit_fired_at on the referrer blocks double-fire
 *     even if first_action_at somehow gets cleared
 *   - credit_ledger idempotency key (`referral_${userId}`) blocks
 *     a duplicate ledger row even if both timestamps get cleared
 *
 * Non-blocking: every error is caught + logged. The primary action
 * (vote / comment / etc.) has already succeeded by the time we
 * land here.
 */
export async function maybeFireReferralCredit(userId: string): Promise<void> {
  try {
    const [profile] = await db
      .select({
        id: profiles.id,
        referredBy: profiles.referredBy,
        firstActionAt: profiles.firstActionAt,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) return;
    if (profile.firstActionAt) return; // Already fired (or no-op for organic users).

    // Stamp first_action_at unconditionally — every meaningful
    // action graduates the user out of the "new" bucket, even when
    // there's no referrer to credit. This stops the helper from
    // re-running its referrer lookup on every subsequent action.
    const now = new Date();
    await db
      .update(profiles)
      .set({ firstActionAt: now })
      .where(and(eq(profiles.id, userId), isNull(profiles.firstActionAt)));

    if (!profile.referredBy) return;

    // Defence-in-depth: confirm the referrer hasn't already been
    // credited for this user (shouldn't be possible given the
    // first_action_at check above, but the credit_ledger idempotency
    // key is the actual source of truth).
    const [referrer] = await db
      .select({
        id: profiles.id,
        referralCreditFiredAt: profiles.referralCreditFiredAt,
      })
      .from(profiles)
      .where(eq(profiles.id, profile.referredBy))
      .limit(1);
    if (!referrer) return;

    const result = await gamificationService.adjustCredits(
      profile.referredBy,
      "referral_completed",
      `referral_${userId}`,
      { metadata: { referredUserId: userId } },
    );
    if (!result.awarded) {
      // Most likely 'duplicate' — ledger already has the row,
      // probably from a previous run that crashed between the
      // award and the timestamp update. Stamp the timestamp now
      // so the helper can stop re-evaluating.
      await db
        .update(profiles)
        .set({ referralCreditFiredAt: now })
        .where(
          and(
            eq(profiles.id, profile.referredBy),
            isNull(profiles.referralCreditFiredAt),
          ),
        );
      return;
    }

    await db
      .update(profiles)
      .set({ referralCreditFiredAt: now })
      .where(eq(profiles.id, profile.referredBy));

    // Best-effort notification so the referrer sees the payout in
    // their bell + balance pill (which already invalidates on
    // credits_granted via useNotificationsRealtime).
    try {
      await createNotification({
        userId: profile.referredBy,
        kind: "credits_granted",
        title: "Referral paid out",
        body: `Your friend made their first move. ${result.amount.toLocaleString("en-US")} credits added to your balance.`,
        href: "/me/credits",
        idempotencyKey: `referral_completed_notify:${userId}`,
        metadata: {
          source: "referral_completed",
          referredUserId: userId,
          creditsGranted: result.amount,
        },
      });
    } catch (notifyErr) {
      console.warn("[credits-earn] referral_completed notify failed", notifyErr);
    }
  } catch (err) {
    console.error("[credits-earn] maybeFireReferralCredit failed", { userId, err });
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
