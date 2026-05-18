/**
 * User-initiated account deletion with a 7-day soft-delete window.
 *
 * Lifecycle (see profiles.deletionRequestedAt / .deletionScheduledFor
 * / .deletedAt — migration 0065):
 *
 *   1. User clicks "Delete my account" → POST /api/me/account/delete
 *      → `requestAccountDeletion()` stamps `deletionRequestedAt` and
 *      `deletionScheduledFor = requestedAt + 7d`. Returns the
 *      schedule. User can still log in and cancel.
 *
 *   2. (Optional) User changes their mind → POST /api/me/account/
 *      cancel-deletion → `cancelAccountDeletion()` clears both
 *      timestamps. Only valid while `deletedAt IS NULL`.
 *
 *   3. After the 7-day window elapses, the hourly sweeper
 *      (`server/jobs/account-deletion-sweeper.ts`) finalises the
 *      row by calling `finaliseAccountDeletion()`. PII fields are
 *      cleared, username randomised, isPublic forced false,
 *      predictCredits zeroed. The row STAYS in the table so that
 *      credit_ledger / market_bets / comments / votes FKs continue
 *      to resolve and the audit trail survives.
 *
 * Why anonymise instead of hard-delete? credit_ledger explicitly
 * declares `onDelete: "restrict"` on the userId FK (see
 * shared/schema.ts:789) with the comment "NO cascade — credit
 * history is an audit log and must survive profile deletion." A
 * hard delete would either fail (FK violation) or require cascading
 * through ~10 tables and losing the audit trail in the process.
 * Anonymisation gives the user the GDPR-style "forget me" outcome
 * (no PII, no public surface) while preserving the operational
 * audit log.
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "../db";
import { profiles, adminAuditLog } from "@shared/schema";
import { log } from "../log";
import { captureBackgroundError } from "../sentry";
import { DELETION_WINDOW_MS } from "./account-deletion-utils";

export { DELETION_WINDOW_MS, isOverdue } from "./account-deletion-utils";

export interface DeletionStatus {
  /** True once `requestAccountDeletion` has been called and not
   *  cancelled. */
  pending: boolean;
  /** True once the sweeper has anonymised the row. */
  finalised: boolean;
  requestedAt: Date | null;
  scheduledFor: Date | null;
  deletedAt: Date | null;
}

/** Reads the current deletion lifecycle state for one user. */
export async function getDeletionStatus(userId: string): Promise<DeletionStatus | null> {
  const [row] = await db
    .select({
      requestedAt: profiles.deletionRequestedAt,
      scheduledFor: profiles.deletionScheduledFor,
      deletedAt: profiles.deletedAt,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    pending: !!row.requestedAt && !row.deletedAt,
    finalised: !!row.deletedAt,
    requestedAt: row.requestedAt,
    scheduledFor: row.scheduledFor,
    deletedAt: row.deletedAt,
  };
}

export type RequestDeletionResult =
  | { ok: true; status: DeletionStatus; alreadyPending: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string; message: string };

/**
 * Marks an account for deletion with the standard 7-day cooling-off
 * window. Idempotent for the "already pending" case — returns the
 * existing schedule without resetting the clock.
 *
 * Refuses when:
 *   - Profile not found (404)
 *   - Account is already finalised / anonymised (409)
 *   - Caller is an admin (409) — admins must be demoted before
 *     deleting so we never lose the only admin on the system by
 *     accident
 */
export async function requestAccountDeletion(opts: {
  userId: string;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<RequestDeletionResult> {
  const { userId, reason, ipAddress, userAgent } = opts;

  const [existing] = await db
    .select({
      id: profiles.id,
      role: profiles.role,
      requestedAt: profiles.deletionRequestedAt,
      scheduledFor: profiles.deletionScheduledFor,
      deletedAt: profiles.deletedAt,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  if (!existing) {
    return { ok: false, status: 404, error: "profile_not_found", message: "Profile not found." };
  }

  if (existing.deletedAt) {
    return {
      ok: false,
      status: 409,
      error: "already_finalised",
      message: "This account has already been deleted.",
    };
  }

  // Admin self-deletion guard. Prevents losing the only admin and
  // forces a deliberate demotion handshake. Operators can still ask
  // another admin to demote them first, then run delete normally.
  if (existing.role === "admin") {
    return {
      ok: false,
      status: 409,
      error: "admin_self_deletion_blocked",
      message:
        "Admins cannot self-delete. Ask another admin to demote your role first, then retry the deletion.",
    };
  }

  if (existing.requestedAt && existing.scheduledFor) {
    // Idempotent path: deletion already pending. Return the existing
    // schedule unchanged so the client UI stays stable.
    return {
      ok: true,
      alreadyPending: true,
      status: {
        pending: true,
        finalised: false,
        requestedAt: existing.requestedAt,
        scheduledFor: existing.scheduledFor,
        deletedAt: null,
      },
    };
  }

  const now = new Date();
  const scheduledFor = new Date(now.getTime() + DELETION_WINDOW_MS);

  await db
    .update(profiles)
    .set({
      deletionRequestedAt: now,
      deletionScheduledFor: scheduledFor,
    })
    .where(eq(profiles.id, userId));

  try {
    await db.insert(adminAuditLog).values({
      adminId: userId, // Self-action; adminId here is the actor (the user themselves).
      actionType: "user_account_deletion_request",
      targetTable: "profiles",
      targetId: userId,
      previousData: { deletionRequestedAt: null, deletionScheduledFor: null },
      newData: { deletionRequestedAt: now, deletionScheduledFor: scheduledFor },
      metadata: { reason, ipAddress, userAgent },
    });
  } catch (auditErr) {
    log(`[AccountDeletion] Audit-log insert failed (deletion still scheduled): ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`);
  }

  return {
    ok: true,
    alreadyPending: false,
    status: {
      pending: true,
      finalised: false,
      requestedAt: now,
      scheduledFor,
      deletedAt: null,
    },
  };
}

export type CancelDeletionResult =
  | { ok: true; status: DeletionStatus }
  | { ok: false; status: 404 | 409; error: string; message: string };

/**
 * Cancels a pending deletion within the 7-day window. No-op if no
 * deletion is pending. Refuses if the deletion has already been
 * finalised (at that point the row's already anonymised and the
 * user has no way to recover it).
 */
export async function cancelAccountDeletion(opts: {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<CancelDeletionResult> {
  const { userId, ipAddress, userAgent } = opts;

  const [existing] = await db
    .select({
      requestedAt: profiles.deletionRequestedAt,
      scheduledFor: profiles.deletionScheduledFor,
      deletedAt: profiles.deletedAt,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  if (!existing) {
    return { ok: false, status: 404, error: "profile_not_found", message: "Profile not found." };
  }
  if (existing.deletedAt) {
    return {
      ok: false,
      status: 409,
      error: "already_finalised",
      message: "This account has already been deleted; the window to cancel has passed.",
    };
  }
  if (!existing.requestedAt) {
    // No-op: nothing pending. Treat as success for idempotency.
    return {
      ok: true,
      status: {
        pending: false,
        finalised: false,
        requestedAt: null,
        scheduledFor: null,
        deletedAt: null,
      },
    };
  }

  await db
    .update(profiles)
    .set({
      deletionRequestedAt: null,
      deletionScheduledFor: null,
    })
    .where(eq(profiles.id, userId));

  try {
    await db.insert(adminAuditLog).values({
      adminId: userId,
      actionType: "user_account_deletion_cancel",
      targetTable: "profiles",
      targetId: userId,
      previousData: {
        deletionRequestedAt: existing.requestedAt,
        deletionScheduledFor: existing.scheduledFor,
      },
      newData: { deletionRequestedAt: null, deletionScheduledFor: null },
      metadata: { ipAddress, userAgent },
    });
  } catch (auditErr) {
    log(`[AccountDeletion] Cancel audit-log insert failed (cancel still committed): ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`);
  }

  return {
    ok: true,
    status: {
      pending: false,
      finalised: false,
      requestedAt: null,
      scheduledFor: null,
      deletedAt: null,
    },
  };
}

export interface SweeperResult {
  /** Profiles whose `deletionScheduledFor` has passed and were
   *  successfully anonymised on this run. */
  processed: number;
  /** Profiles attempted but that failed (e.g. transient DB error).
   *  These remain pending and will be retried on the next sweep. */
  failed: number;
  /** Total candidate profiles inspected (processed + failed). */
  candidates: number;
}

/**
 * Hourly sweeper that finalises pending deletions whose 7-day
 * window has elapsed. Idempotent: re-running the sweep after a
 * partial failure picks up the unfinalised rows. Each profile is
 * processed in its own transaction so a single bad row doesn't
 * block the rest of the batch.
 */
export async function processOverdueAccountDeletions(): Promise<SweeperResult> {
  const now = new Date();

  const overdue = await db
    .select({
      id: profiles.id,
      username: profiles.username,
      role: profiles.role,
      scheduledFor: profiles.deletionScheduledFor,
    })
    .from(profiles)
    .where(
      and(
        isNotNull(profiles.deletionScheduledFor),
        isNull(profiles.deletedAt),
        lte(profiles.deletionScheduledFor, now),
      ),
    )
    .limit(100); // Conservative batch size so a backlog doesn't lock
                 // out the rest of the request cycle. Sweeper runs
                 // hourly so up to 2400/day clear naturally.

  let processed = 0;
  let failed = 0;

  for (const candidate of overdue) {
    try {
      await finaliseAccountDeletion(candidate.id);
      processed += 1;
    } catch (err) {
      failed += 1;
      log(`[AccountDeletion] Failed to finalise profile ${candidate.id}: ${err instanceof Error ? err.message : String(err)}`);
      captureBackgroundError(err, {
        scope: "account_deletion_sweeper",
        profileId: candidate.id,
      });
    }
  }

  return { processed, failed, candidates: overdue.length };
}

/**
 * Finalises a single overdue account by anonymising the profile
 * row. Idempotent — if `deletedAt` is already set, returns silently.
 *
 * What gets cleared:
 *   - username  → randomised "deleted_<uuid>" (kept unique-able)
 *   - avatarUrl, avatarSeed, bio  → null
 *   - dateOfBirth, country, gender, etc. → null (PII)
 *   - isPublic → false (hides from public profile / leaderboard)
 *   - positionsPublic → false
 *   - predictCredits → 0 (final balance wipe so the deleted row
 *     can't accumulate phantom credits from future grants or
 *     idempotent retries)
 *   - role → "user" (defence-in-depth; admins are blocked from
 *     scheduling deletion anyway)
 *   - deletedAt → now
 *
 * What survives:
 *   - id, createdAt (FK targets; can't change without breaking
 *     credit_ledger / market_bets / comments / votes / etc.)
 *   - xpPoints, currentStreak, longestStreak (historical
 *     aggregates; no PII)
 *   - referralCode, referredBy (referral attribution lives on)
 *
 * What WE DON'T touch in this commit:
 *   - Supabase Auth user row. Best-effort deletion via the Admin
 *     API is a follow-up; for now the user remains authable but
 *     their profile has no PII or actionable balance. Following
 *     re-auth, they'll find their content unchanged but their
 *     identity blanked. (The /api/profile/sync flow will see
 *     deletedAt and can lock them out.)
 */
export async function finaliseAccountDeletion(userId: string): Promise<void> {
  const [existing] = await db
    .select({
      deletedAt: profiles.deletedAt,
      username: profiles.username,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  if (!existing) {
    log(`[AccountDeletion] Profile ${userId} disappeared before finalisation; skipping.`);
    return;
  }
  if (existing.deletedAt) {
    return; // Already finalised — idempotent no-op.
  }

  const anonymousUsername = `deleted_${randomUUID().slice(0, 8)}`;
  const now = new Date();

  await db
    .update(profiles)
    .set({
      username: anonymousUsername,
      fullName: null,
      avatarUrl: null,
      avatarSeed: null,
      bio: null,
      // Demographic PII (migrations 0060, 0061, 0062).
      dateOfBirth: null,
      gender: null,
      countryOfOrigin: null,
      countryOfResidence: null,
      ethnicity: null,
      // Account-tab extras (migration 0061).
      recoveryEmail: null,
      recoveryEmailVerified: false,
      phoneNumber: null,
      // Social handles + occupation (migration 0061).
      socialXHandle: null,
      socialInstagramHandle: null,
      occupationIndustry: null,
      // Force private + zero balance so no public surface or
      // future credit activity leaks past the wipe.
      isPublic: false,
      positionsPublic: false,
      predictCredits: 0,
      role: "user",
      deletedAt: now,
    })
    .where(eq(profiles.id, userId));

  try {
    await db.insert(adminAuditLog).values({
      adminId: userId,
      actionType: "user_account_deletion_finalised",
      targetTable: "profiles",
      targetId: userId,
      previousData: { username: existing.username },
      newData: { username: anonymousUsername, deletedAt: now },
      metadata: { sweepedAt: now, source: "account_deletion_sweeper" },
    });
  } catch (auditErr) {
    log(`[AccountDeletion] Finalisation audit-log insert failed (finalisation still committed): ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`);
  }
}

