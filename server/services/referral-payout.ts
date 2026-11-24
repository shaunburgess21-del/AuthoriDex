/**
 * Referral payout queue.
 *
 * `referral_completed` pays the referrer once per friend. The ledger
 * key stays `referral_${refereeId}` so a friend cannot pay twice.
 * `credit_actions.daily_cap` (seeded at 3) limits how many of those
 * payouts a referrer can receive per UTC day.
 *
 * A friend past that cap is not dropped. Their first action is already
 * stamped on `profiles.first_action_at`, and the missing ledger row is
 * the pending record. The next drain — another friend's first action,
 * or the referrer's daily check-in — pays the oldest pending friend
 * while the referrer is still under that day's cap.
 *
 * The referee's own signup grant and referral_signup_bonus are not
 * touched here. Callers omit an amount override so the rank earn
 * multiplier in adjustCredits still applies.
 */

export function referralPayoutIdempotencyKey(refereeId: string): string {
  return `referral_${refereeId}`;
}

/** How many pending rows one uncapped sweep will pay. Bounds a check-in. */
export const UNCAPPED_REFERRAL_SWEEP_BATCH = 25;

export interface PendingReferral {
  refereeId: string;
  firstActionAt: Date;
}

export interface ReferralPayInput {
  referrerId: string;
  refereeId: string;
  idempotencyKey: string;
}

export interface ReferralPayResult {
  awarded: boolean;
  amount: number;
  reason?: string;
}

export interface ReferralPaidInput {
  referrerId: string;
  refereeId: string;
  amount: number;
  now: Date;
}

export interface ReferralPayoutDeps {
  /** Resolved credit_actions.daily_cap. null means an admin cleared it. */
  dailyCap: number | null;
  countPaidToday(referrerId: string, utcStart: Date): Promise<number>;
  /**
   * Oldest unpaid first. A row is unpaid when the referee's first
   * action is stamped and no `referral_${refereeId}` ledger row exists.
   */
  listUnpaid(referrerId: string, limit: number): Promise<PendingReferral[]>;
  referrerExists(referrerId: string): Promise<boolean>;
  pay(input: ReferralPayInput): Promise<ReferralPayResult>;
  onPaid(input: ReferralPaidInput): Promise<void>;
  /** Ledger row already existed. Stamp the referrer's fired-at if empty. */
  onAlreadyRecorded?(referrerId: string, now: Date): Promise<void>;
}

export interface DrainReferralResult {
  paidRefereeIds: string[];
  hitCap: boolean;
}

export interface FireReferralDeps extends ReferralPayoutDeps {
  loadReferee(userId: string): Promise<{
    id: string;
    referredBy: string | null;
    firstActionAt: Date | null;
  } | null>;
  /** True when this call won the one-time first_action_at stamp. */
  stampFirstAction(userId: string, now: Date): Promise<boolean>;
}

export type FireReferralOutcome =
  | "missing_user"
  | "already_acted"
  | "stamped_only"
  | "self"
  | "missing_referrer"
  | "drained";

export interface FireReferralResult {
  outcome: FireReferralOutcome;
  paidRefereeIds: string[];
}

export function utcDayStart(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * Pay the oldest pending referrals for `referrerId` until today's cap
 * is full. Safe to call again: the ledger key makes each friend pay
 * exactly once, and a `daily_cap` result leaves that friend pending.
 */
export async function drainReferralPayouts(
  referrerId: string,
  deps: ReferralPayoutDeps,
  now: Date = new Date(),
): Promise<DrainReferralResult> {
  if (!referrerId || !(await deps.referrerExists(referrerId))) {
    return { paidRefereeIds: [], hitCap: false };
  }

  const paidToday = await deps.countPaidToday(referrerId, utcDayStart(now));
  const cap = deps.dailyCap;
  if (cap !== null && paidToday >= cap) {
    return { paidRefereeIds: [], hitCap: true };
  }

  const room = cap === null ? UNCAPPED_REFERRAL_SWEEP_BATCH : cap - paidToday;
  const pending = await deps.listUnpaid(referrerId, room);
  const paidRefereeIds: string[] = [];

  for (const referee of pending) {
    if (referee.refereeId === referrerId) continue;

    const result = await deps.pay({
      referrerId,
      refereeId: referee.refereeId,
      idempotencyKey: referralPayoutIdempotencyKey(referee.refereeId),
    });

    if (result.awarded) {
      paidRefereeIds.push(referee.refereeId);
      try {
        await deps.onPaid({
          referrerId,
          refereeId: referee.refereeId,
          amount: result.amount,
          now,
        });
      } catch {
        // The ledger row is the payout. A notification failure must
        // not stop the rest of the queue or look like a non-payment.
      }
      continue;
    }

    if (result.reason === "duplicate") {
      try {
        await deps.onAlreadyRecorded?.(referrerId, now);
      } catch {
        // The ledger row already records the payout.
      }
      continue;
    }

    if (result.reason === "daily_cap") {
      return { paidRefereeIds, hitCap: true };
    }

    return { paidRefereeIds, hitCap: false };
  }

  return { paidRefereeIds, hitCap: false };
}

/**
 * Stamp the referee's first meaningful action, then drain the
 * referrer's pending payouts (including this friend) if the referrer
 * is a different, existing profile.
 *
 * A later call for the same referee returns without draining. Pending
 * payouts are picked up by `drainReferralPayouts` from the referrer's
 * check-in or from another friend's first action.
 */
export async function fireReferralCredit(
  userId: string,
  deps: FireReferralDeps,
  now: Date = new Date(),
): Promise<FireReferralResult> {
  const profile = await deps.loadReferee(userId);
  if (!profile) return { outcome: "missing_user", paidRefereeIds: [] };
  if (profile.firstActionAt) return { outcome: "already_acted", paidRefereeIds: [] };

  const stamped = await deps.stampFirstAction(userId, now);
  if (!stamped) return { outcome: "already_acted", paidRefereeIds: [] };

  const referrerId = profile.referredBy;
  if (!referrerId) return { outcome: "stamped_only", paidRefereeIds: [] };
  if (referrerId === userId) return { outcome: "self", paidRefereeIds: [] };
  if (!(await deps.referrerExists(referrerId))) {
    return { outcome: "missing_referrer", paidRefereeIds: [] };
  }

  const drained = await drainReferralPayouts(referrerId, deps, now);
  return { outcome: "drained", paidRefereeIds: drained.paidRefereeIds };
}
