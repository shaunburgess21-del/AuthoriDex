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

import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { creditLedger, profiles } from "@shared/schema";
import { createNotification } from "./notifications";
import { formatVox } from "@shared/currency";
import { gamificationService } from "./gamification";
import { checkAndAwardReferralBadges } from "./badges";
import {
  drainReferralPayouts,
  fireReferralCredit,
  type FireReferralDeps,
  type ReferralPayoutDeps,
} from "./referral-payout";

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
 * Award `comment_insight` credits when a user posts a comment or
 * reply on any discussion thread — insight threads plus matchup /
 * sentiment poll / opinion poll / world market cards. Daily-capped
 * (default 5/day, shared across all surfaces).
 *
 * Caller is responsible for the "min 20 chars" gate (and "not on
 * own insight" for insight threads) — the credit helper only
 * enforces the per-day cap and idempotency.
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
 *      comment / overall rating) → THIS function. Stamps
 *      profiles.first_action_at, then pays referral_completed if the
 *      referrer is under today's cap. A friend past the cap stays
 *      queued (no ledger row) for a later drain. The referrer's
 *      referral_credit_fired_at updates when a payout actually lands.
 *   3. All subsequent actions by that referee → no-op here
 *      (first_action_at is set). A queued payout is collected by the
 *      referrer's next daily check-in, or when another friend acts.
 *
 * Idempotency:
 *
 *   - first_action_at on the referee blocks re-entry into this helper.
 *     It means "they acted", not "the referrer was paid".
 *   - credit_ledger idempotency key (`referral_${refereeId}`) pays each
 *     friend exactly once. A friend past the referrer's UTC-day cap
 *     stays unpaid (no ledger row) and is paid by a later drain.
 *   - referral_credit_fired_at on the referrer records that a payout
 *     landed. It is not a per-friend lock.
 *
 * The cap is credit_actions.daily_cap for referral_completed (seed 3).
 * adjustCredits enforces it inside the referrer's profile lock, so two
 * concurrent drains cannot both slip past the count. This helper does
 * not pass an amount override, so the rank earn multiplier is unchanged.
 *
 * Non-blocking: every error is caught + logged. The primary action
 * (vote / comment / etc.) has already succeeded by the time we
 * land here.
 */
async function referralPayoutDeps(): Promise<ReferralPayoutDeps> {
  return {
    dailyCap: await gamificationService.resolvedCreditDailyCap("referral_completed"),
    countPaidToday: countReferralPayoutsSince,
    listUnpaid: listUnpaidReferralPayouts,
    referrerExists: profileExists,
    pay: payReferral,
    onPaid: recordReferralPayout,
    onAlreadyRecorded: stampReferralFiredAtIfEmpty,
  };
}

async function profileExists(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return Boolean(row);
}

async function countReferralPayoutsSince(referrerId: string, utcStart: Date): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, referrerId),
        eq(creditLedger.txnType, "referral_completed"),
        gte(creditLedger.createdAt, utcStart),
      ),
    );
  return Number(count) || 0;
}

/**
 * Oldest first action first. The unpaid marker is "first action
 * stamped, and no ledger row with key referral_${refereeId}".
 * The key prefix must match `referralPayoutIdempotencyKey`.
 */
async function listUnpaidReferralPayouts(
  referrerId: string,
  limit: number,
): Promise<Array<{ refereeId: string; firstActionAt: Date }>> {
  if (limit <= 0) return [];
  const result = await db.execute<{ id: string; first_action_at: Date | string }>(sql`
    SELECT p.id, p.first_action_at
    FROM profiles p
    WHERE p.referred_by = ${referrerId}
      AND p.id <> ${referrerId}
      AND p.first_action_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM credit_ledger cl
        WHERE cl.user_id = ${referrerId}
          AND cl.txn_type = 'referral_completed'
          AND cl.idempotency_key = 'referral_' || p.id
      )
    ORDER BY p.first_action_at ASC
    LIMIT ${limit}
  `);
  const rows = ((result as { rows?: unknown }).rows ?? result ?? []) as Array<{
    id: string;
    first_action_at: Date | string;
  }>;
  return rows.map((row) => ({
    refereeId: row.id,
    firstActionAt: new Date(row.first_action_at),
  }));
}

async function payReferral(input: {
  referrerId: string;
  refereeId: string;
  idempotencyKey: string;
}): Promise<{ awarded: boolean; amount: number; reason?: string }> {
  // No `amount` override: proposed_credits and the rank multiplier
  // stay inside adjustCredits. The daily cap there is the race-safe
  // stop; a daily_cap result does not consume the idempotency key.
  const result = await gamificationService.adjustCredits(
    input.referrerId,
    "referral_completed",
    input.idempotencyKey,
    { metadata: { referredUserId: input.refereeId } },
  );
  return { awarded: result.awarded, amount: result.amount, reason: result.reason };
}

async function stampReferralFiredAt(referrerId: string, now: Date, onlyIfEmpty: boolean): Promise<void> {
  await db
    .update(profiles)
    .set({ referralCreditFiredAt: now })
    .where(
      onlyIfEmpty
        ? and(eq(profiles.id, referrerId), isNull(profiles.referralCreditFiredAt))
        : eq(profiles.id, referrerId),
    );
}

async function stampReferralFiredAtIfEmpty(referrerId: string, now: Date): Promise<void> {
  await stampReferralFiredAt(referrerId, now, true);
}

async function recordReferralPayout(input: {
  referrerId: string;
  refereeId: string;
  amount: number;
  now: Date;
}): Promise<void> {
  await stampReferralFiredAt(input.referrerId, input.now, false);

  try {
    await createNotification({
      userId: input.referrerId,
      kind: "credits_granted",
      title: "Referral paid out",
      body: `Your friend made their first move. ${formatVox(input.amount)} added to your balance.`,
      href: "/me/credits",
      idempotencyKey: `referral_completed_notify:${input.refereeId}`,
      metadata: {
        source: "referral_completed",
        referredUserId: input.refereeId,
        creditsGranted: input.amount,
      },
    });
  } catch (notifyErr) {
    console.warn("[credits-earn] referral_completed notify failed", notifyErr);
  }

  try {
    await checkAndAwardReferralBadges(input.referrerId);
  } catch (badgeErr) {
    console.warn("[credits-earn] referral badge check failed", badgeErr);
  }
}

async function fireDeps(): Promise<FireReferralDeps> {
  return {
    ...(await referralPayoutDeps()),
    loadReferee: async (userId) => {
      const [profile] = await db
        .select({
          id: profiles.id,
          referredBy: profiles.referredBy,
          firstActionAt: profiles.firstActionAt,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      return profile ?? null;
    },
    stampFirstAction: async (userId, now) => {
      const updated = await db
        .update(profiles)
        .set({ firstActionAt: now })
        .where(and(eq(profiles.id, userId), isNull(profiles.firstActionAt)))
        .returning({ id: profiles.id });
      return updated.length > 0;
    },
  };
}

export async function maybeFireReferralCredit(userId: string): Promise<void> {
  try {
    await fireReferralCredit(userId, await fireDeps(), new Date());
  } catch (err) {
    console.error("[credits-earn] maybeFireReferralCredit failed", { userId, err });
  }
}

/**
 * Pay the oldest referrals still waiting on this referrer's daily cap.
 * Called from daily check-in. Also runs at the end of a new friend's
 * first action via maybeFireReferralCredit. No-op when nothing is queued
 * or today's cap is already full.
 */
export async function sweepReferrerReferralPayouts(
  referrerId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    await drainReferralPayouts(referrerId, await referralPayoutDeps(), now);
  } catch (err) {
    console.error("[credits-earn] referral payout sweep failed", { referrerId, err });
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
