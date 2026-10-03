/**
 * User-initiated account deletion with a 7-day window.
 *
 * Lifecycle (profiles.deletionRequestedAt / deletionScheduledFor /
 * deletedAt — migration 0065, no further migration):
 *
 *   1. POST /api/me/account/delete → `requestAccountDeletion()` stamps
 *      `deletionRequestedAt` and `deletionScheduledFor = requestedAt + 7d`.
 *      The account stays active. The user can still sign in and cancel.
 *      This is scheduled deletion, not permanent deletion.
 *
 *   2. POST /api/me/account/cancel-deletion → `cancelAccountDeletion()`
 *      clears both timestamps. Only valid while erasure has not started
 *      and `deletedAt` is null.
 *
 *   3. After the window, the hourly sweeper calls
 *      `finaliseAccountDeletion()`:
 *        a. Erase or anonymise personal data. The tombstone username
 *           (`deleted_` + 32 hex chars) marks erasure as started, which
 *           closes cancellation and rejects sign-in.
 *        b. Delete the Supabase Auth user with the server-side
 *           service-role client (`auth.admin.deleteUser`), the same
 *           mechanism as admin hard-delete. A missing user (404) is
 *           success. The service-role key stays on the server.
 *        c. Only then stamp `deletedAt`. If Auth deletion fails,
 *           `deletedAt` stays null and the sweeper retries. A failed
 *           Auth delete cannot restore the profile, because sign-in
 *           and cancellation are already closed.
 *
 * The profile row stays. `credit_ledger.user_id` is ON DELETE RESTRICT
 * because the virtual credit ledger is an engineering audit log. Ledger
 * rows are kept and identifying fields are cleared. They are not tax
 * records. Votes, poll responses, matchup votes, and predictions stay
 * so historical results remain intact, disassociated from an
 * identifiable person. Comment bodies become `[deleted]`; the thread
 * remains.
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "../db";
import {
  adminAuditLog,
  comments,
  creditLedger,
  emailUnsubscribeState,
  funnelEvents,
  insightsEvents,
  marketBets,
  moderationEvents,
  notificationMarketMutes,
  notificationPreferences,
  notifications,
  opinionPollOptionSuggestions,
  pageViews,
  profileItemPrivacy,
  profiles,
  shareClicks,
  userBadges,
  userCategoryEngagement,
  userFavourites,
  userRankSnapshots,
  xpLedger,
} from "@shared/schema";
import { log } from "../log";
import { captureBackgroundError } from "../sentry";
import { supabaseServer } from "../supabase";
import { getSupabaseAuthEmail } from "./supabase-auth-email";
import { isInfrastructureProfile } from "../utils/infrastructure-profiles";
import {
  ACCOUNT_STATE_TABLES,
  buildAnonymisedProfilePatch,
  collectProfileIdentifiers,
  DELETED_COMMENT_BODY,
  formatAnonymisedUsername,
  isErasureStarted,
  planDeletionCancel,
  planDeletionRequest,
  redactIdentifyingText,
  scrubBetMetadata,
  scrubIdentifyingJson,
  suggestionNameAfterErasure,
  type AccountStateTable,
  type DeletionProfileSnapshot,
} from "./account-deletion-utils";
import { performPermanentDeletion, type AuthDeleteResult } from "./account-deletion-execute";

export {
  DELETION_WINDOW_MS,
  isOverdue,
  isErasureStarted,
  shouldRejectSignIn,
  isPublicProfileUnavailable,
} from "./account-deletion-utils";

export interface DeletionStatus {
  /** True once deletion is scheduled, erasure has not started, and
   *  `deletedAt` is still null. The account is active. */
  pending: boolean;
  /** True once the sweeper has stamped `deletedAt`. */
  finalised: boolean;
  /** True after personal data has been erased and before `deletedAt`
   *  is stamped (usually an Auth-delete retry). Cancellation is closed. */
  erasureStarted: boolean;
  requestedAt: Date | null;
  scheduledFor: Date | null;
  deletedAt: Date | null;
}

type ProfileDeletionRow = {
  id: string;
  role: string;
  username: string | null;
  fullName: string | null;
  bio: string | null;
  recoveryEmail: string | null;
  phoneNumber: string | null;
  referralCode: string | null;
  socialXHandle: string | null;
  socialInstagramHandle: string | null;
  requestedAt: Date | null;
  scheduledFor: Date | null;
  deletedAt: Date | null;
  isAgent: boolean;
  isHouse: boolean;
};

function toSnapshot(row: ProfileDeletionRow): DeletionProfileSnapshot {
  return {
    role: row.role,
    username: row.username,
    requestedAt: row.requestedAt,
    scheduledFor: row.scheduledFor,
    deletedAt: row.deletedAt,
    isAgent: row.isAgent,
    isHouse: row.isHouse || isInfrastructureProfile(row),
  };
}

async function loadProfile(userId: string): Promise<ProfileDeletionRow | null> {
  const [row] = await db
    .select({
      id: profiles.id,
      role: profiles.role,
      username: profiles.username,
      fullName: profiles.fullName,
      bio: profiles.bio,
      recoveryEmail: profiles.recoveryEmail,
      phoneNumber: profiles.phoneNumber,
      referralCode: profiles.referralCode,
      socialXHandle: profiles.socialXHandle,
      socialInstagramHandle: profiles.socialInstagramHandle,
      requestedAt: profiles.deletionRequestedAt,
      scheduledFor: profiles.deletionScheduledFor,
      deletedAt: profiles.deletedAt,
      isAgent: profiles.isAgent,
      isHouse: profiles.isHouse,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return row ?? null;
}

function statusFromRow(row: {
  requestedAt: Date | null;
  scheduledFor: Date | null;
  deletedAt: Date | null;
  username: string | null;
}): DeletionStatus {
  const erasureStarted = isErasureStarted({ username: row.username, deletedAt: row.deletedAt });
  return {
    pending: !!row.requestedAt && !row.deletedAt && !erasureStarted,
    finalised: !!row.deletedAt,
    erasureStarted,
    requestedAt: row.requestedAt,
    scheduledFor: row.scheduledFor,
    deletedAt: row.deletedAt,
  };
}

/** Reads the current deletion lifecycle state for one user. */
export async function getDeletionStatus(userId: string): Promise<DeletionStatus | null> {
  const row = await loadProfile(userId);
  if (!row) return null;
  return statusFromRow(row);
}

export type RequestDeletionResult =
  | { ok: true; status: DeletionStatus; alreadyPending: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string; message: string };

/**
 * Marks an account for deletion with the standard 7-day window.
 * Idempotent while the request is pending — the clock is not reset.
 * Refuses once erasure has started or the account is finalised.
 */
export async function requestAccountDeletion(opts: {
  userId: string;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<RequestDeletionResult> {
  const { userId, reason, ipAddress, userAgent } = opts;
  const existing = await loadProfile(userId);
  if (!existing) {
    return { ok: false, status: 404, error: "profile_not_found", message: "Profile not found." };
  }

  const plan = planDeletionRequest(toSnapshot(existing), new Date());
  if (plan.kind === "reject") {
    return { ok: false, status: plan.status, error: plan.error, message: plan.message };
  }
  if (plan.kind === "already_pending") {
    return {
      ok: true,
      alreadyPending: true,
      status: statusFromRow({
        requestedAt: plan.requestedAt,
        scheduledFor: plan.scheduledFor,
        deletedAt: null,
        username: existing.username,
      }),
    };
  }

  await db
    .update(profiles)
    .set({
      deletionRequestedAt: plan.requestedAt,
      deletionScheduledFor: plan.scheduledFor,
    })
    .where(eq(profiles.id, userId));

  try {
    await db.insert(adminAuditLog).values({
      adminId: userId,
      actionType: "user_account_deletion_request",
      targetTable: "profiles",
      targetId: userId,
      previousData: { deletionRequestedAt: null, deletionScheduledFor: null },
      newData: {
        deletionRequestedAt: plan.requestedAt,
        deletionScheduledFor: plan.scheduledFor,
      },
      metadata: { reason, ipAddress, userAgent },
    });
  } catch (auditErr) {
    log(
      `[AccountDeletion] Audit-log insert failed (deletion still scheduled): ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
    );
  }

  return {
    ok: true,
    alreadyPending: false,
    status: statusFromRow({
      requestedAt: plan.requestedAt,
      scheduledFor: plan.scheduledFor,
      deletedAt: null,
      username: existing.username,
    }),
  };
}

export type CancelDeletionResult =
  | { ok: true; status: DeletionStatus }
  | { ok: false; status: 404 | 409; error: string; message: string };

/**
 * Cancels a pending deletion inside the 7-day window. Refuses once
 * erasure has started or `deletedAt` is set, so a failed Auth delete
 * cannot restore the profile.
 */
export async function cancelAccountDeletion(opts: {
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<CancelDeletionResult> {
  const { userId, ipAddress, userAgent } = opts;
  const existing = await loadProfile(userId);
  if (!existing) {
    return { ok: false, status: 404, error: "profile_not_found", message: "Profile not found." };
  }

  const plan = planDeletionCancel(toSnapshot(existing));
  if (plan.kind === "reject") {
    return { ok: false, status: plan.status, error: plan.error, message: plan.message };
  }
  if (plan.kind === "noop") {
    return {
      ok: true,
      status: statusFromRow({
        requestedAt: null,
        scheduledFor: null,
        deletedAt: null,
        username: existing.username,
      }),
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
    log(
      `[AccountDeletion] Cancel audit-log insert failed (cancel still committed): ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
    );
  }

  return {
    ok: true,
    status: statusFromRow({
      requestedAt: null,
      scheduledFor: null,
      deletedAt: null,
      username: existing.username,
    }),
  };
}

export interface SweeperResult {
  processed: number;
  failed: number;
  candidates: number;
}

/**
 * Hourly sweeper. Finalises pending deletions whose 7-day window has
 * elapsed. Auth failures leave `deletedAt` null so the next run retries.
 */
export async function processOverdueAccountDeletions(): Promise<SweeperResult> {
  const now = new Date();
  const overdue = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        isNotNull(profiles.deletionScheduledFor),
        isNull(profiles.deletedAt),
        lte(profiles.deletionScheduledFor, now),
      ),
    )
    .limit(100);

  let processed = 0;
  let failed = 0;

  for (const candidate of overdue) {
    try {
      const result = await finaliseAccountDeletion(candidate.id);
      if (result.outcome === "auth_failed") {
        failed += 1;
        captureBackgroundError(new Error("auth_delete_failed"), {
          scope: "account_deletion_sweeper",
          profileId: candidate.id,
        });
        continue;
      }
      processed += 1;
    } catch (err) {
      failed += 1;
      log(
        `[AccountDeletion] Failed to finalise profile ${candidate.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      captureBackgroundError(err, {
        scope: "account_deletion_sweeper",
        profileId: candidate.id,
      });
    }
  }

  return { processed, failed, candidates: overdue.length };
}

type AuthDeleteClient = (userId: string) => Promise<AuthDeleteResult>;

async function deleteAuthUserWithServiceRole(userId: string): Promise<AuthDeleteResult> {
  const { error } = await supabaseServer.auth.admin.deleteUser(userId);
  if (!error) return { error: null };
  const status = (error as { status?: number }).status;
  return { error: { status, message: error.message } };
}

/**
 * Finalises one overdue account: erase personal data, delete the Auth
 * user, then stamp `deletedAt`. Injectable `deleteAuthUser` is for tests
 * only; production uses the server-side service-role admin client.
 */
export async function finaliseAccountDeletion(
  userId: string,
  deps?: { deleteAuthUser?: AuthDeleteClient },
): Promise<{ outcome: "auth_failed" | "finalised" | "skipped" }> {
  const deleteAuthUser = deps?.deleteAuthUser ?? deleteAuthUserWithServiceRole;
  const result = await performPermanentDeletion({
    userId,
    now: new Date(),
    loadCandidate: async () => {
      const row = await loadProfile(userId);
      if (!row) return null;
      const snapshot = toSnapshot(row);
      return {
        id: row.id,
        role: row.role,
        username: row.username,
        deletedAt: row.deletedAt,
        protectedAccount:
          snapshot.role === "admin" ||
          snapshot.role === "system" ||
          !!snapshot.isAgent ||
          !!snapshot.isHouse,
      };
    },
    erasePersonalData: async () => {
      await erasePersonalData(userId);
    },
    deleteAuthUser,
    stampDeletedAt: async (deletedAt) => {
      await stampDeletedAt(userId, deletedAt);
    },
  });

  if (result.outcome === "auth_failed") {
    log(`[AccountDeletion] Auth delete failed for profile ${userId}; deletedAt left unset so the sweeper can retry.`);
    return { outcome: "auth_failed" };
  }
  if (result.outcome === "finalised") {
    return { outcome: "finalised" };
  }
  if (result.outcome === "skipped_protected") {
    log(
      `[AccountDeletion] Refusing to finalise protected profile ${userId}. Operator must clear the deletion request.`,
    );
  }
  return { outcome: "skipped" };
}

async function purgeAccountState(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  table: AccountStateTable,
): Promise<void> {
  switch (table) {
    case "xp_ledger":
      await tx.delete(xpLedger).where(eq(xpLedger.userId, userId));
      return;
    case "user_badges":
      await tx.delete(userBadges).where(eq(userBadges.userId, userId));
      return;
    case "user_category_engagement":
      await tx.delete(userCategoryEngagement).where(eq(userCategoryEngagement.userId, userId));
      return;
    case "profile_item_privacy":
      await tx.delete(profileItemPrivacy).where(eq(profileItemPrivacy.userId, userId));
      return;
    case "notification_preferences":
      await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
      return;
    case "notification_market_mutes":
      await tx.delete(notificationMarketMutes).where(eq(notificationMarketMutes.userId, userId));
      return;
    case "notifications":
      await tx
        .delete(notifications)
        .where(or(eq(notifications.userId, userId), eq(notifications.actorUserId, userId)));
      return;
    case "email_unsubscribe_state":
      await tx.delete(emailUnsubscribeState).where(eq(emailUnsubscribeState.userId, userId));
      return;
    case "user_rank_snapshots":
      await tx.delete(userRankSnapshots).where(eq(userRankSnapshots.userId, userId));
      return;
    case "user_favourites":
      await tx.delete(userFavourites).where(eq(userFavourites.userId, userId));
      return;
    default: {
      const exhaustive: never = table;
      throw new Error(`Unhandled account-state table: ${String(exhaustive)}`);
    }
  }
}

async function erasePersonalData(userId: string): Promise<void> {
  const existing = await loadProfile(userId);
  if (!existing || existing.deletedAt || isErasureStarted(existing)) return;

  // Read the sign-in email before the transaction so a slow Auth call
  // does not hold a database transaction open. The address is used only
  // to redact copies of it. It is not logged.
  const authEmail = await getSupabaseAuthEmail(userId);
  const identifiers = collectProfileIdentifiers(existing, authEmail);
  const anonymousUsername = formatAnonymisedUsername(randomUUID().replace(/-/g, ""));
  const patch = buildAnonymisedProfilePatch(anonymousUsername);

  await db.transaction(async (tx) => {
    for (const table of ACCOUNT_STATE_TABLES) {
      await purgeAccountState(tx, userId, table);
    }

    await tx
      .update(comments)
      .set({ body: DELETED_COMMENT_BODY, updatedAt: new Date() })
      .where(eq(comments.userId, userId));

    const ledgerRows = await tx
      .select({ id: creditLedger.id, metadata: creditLedger.metadata })
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId));
    for (const row of ledgerRows) {
      await tx
        .update(creditLedger)
        .set({ metadata: scrubIdentifyingJson(row.metadata, identifiers) })
        .where(eq(creditLedger.id, row.id));
    }

    const betRows = await tx
      .select({ id: marketBets.id, betMetadata: marketBets.betMetadata })
      .from(marketBets)
      .where(eq(marketBets.userId, userId));
    for (const row of betRows) {
      await tx
        .update(marketBets)
        .set({ betMetadata: scrubBetMetadata(row.betMetadata, identifiers) })
        .where(eq(marketBets.id, row.id));
    }

    const suggestionRows = await tx
      .select({
        id: opinionPollOptionSuggestions.id,
        name: opinionPollOptionSuggestions.name,
      })
      .from(opinionPollOptionSuggestions)
      .where(eq(opinionPollOptionSuggestions.suggestedBy, userId));
    for (const row of suggestionRows) {
      const name = suggestionNameAfterErasure(row.name, identifiers);
      if (name !== row.name) {
        await tx
          .update(opinionPollOptionSuggestions)
          .set({ name, updatedAt: new Date() })
          .where(eq(opinionPollOptionSuggestions.id, row.id));
      }
    }

    const auditRows = await tx
      .select({
        id: adminAuditLog.id,
        adminId: adminAuditLog.adminId,
        targetId: adminAuditLog.targetId,
        previousData: adminAuditLog.previousData,
        newData: adminAuditLog.newData,
        metadata: adminAuditLog.metadata,
      })
      .from(adminAuditLog)
      .where(or(eq(adminAuditLog.targetId, userId), eq(adminAuditLog.adminId, userId)));
    for (const row of auditRows) {
      await tx
        .update(adminAuditLog)
        .set({
          ...(row.adminId === userId ? { adminEmail: null } : {}),
          previousData:
            row.targetId === userId
              ? scrubIdentifyingJson(row.previousData, identifiers)
              : row.previousData,
          newData:
            row.targetId === userId
              ? scrubIdentifyingJson(row.newData, identifiers)
              : row.newData,
          metadata: scrubIdentifyingJson(row.metadata, identifiers),
        })
        .where(eq(adminAuditLog.id, row.id));
    }

    const viewRows = await tx
      .select({ id: pageViews.id, path: pageViews.path })
      .from(pageViews)
      .where(eq(pageViews.userId, userId));
    for (const row of viewRows) {
      const redactedPath = redactIdentifyingText(row.path, identifiers) ?? "/";
      await tx
        .update(pageViews)
        .set({
          userId: null,
          userAgent: null,
          sessionId: null,
          path: redactedPath,
        })
        .where(eq(pageViews.id, row.id));
    }

    const funnelRows = await tx
      .select({ id: funnelEvents.id, metadata: funnelEvents.metadata })
      .from(funnelEvents)
      .where(eq(funnelEvents.userId, userId));
    for (const row of funnelRows) {
      await tx
        .update(funnelEvents)
        .set({
          userId: null,
          fdxSid: null,
          metadata: scrubIdentifyingJson(row.metadata, identifiers),
        })
        .where(eq(funnelEvents.id, row.id));
    }

    const insightRows = await tx
      .select({ id: insightsEvents.id, params: insightsEvents.params })
      .from(insightsEvents)
      .where(eq(insightsEvents.userId, userId));
    for (const row of insightRows) {
      await tx
        .update(insightsEvents)
        .set({
          userId: null,
          params: scrubIdentifyingJson(row.params, identifiers),
        })
        .where(eq(insightsEvents.id, row.id));
    }

    const moderationRows = await tx
      .select({ id: moderationEvents.id, metadata: moderationEvents.metadata })
      .from(moderationEvents)
      .where(eq(moderationEvents.authorId, userId));
    for (const row of moderationRows) {
      await tx
        .update(moderationEvents)
        .set({
          sampleText: null,
          metadata: scrubIdentifyingJson(row.metadata, identifiers),
        })
        .where(eq(moderationEvents.id, row.id));
    }

    const clickRows = await tx
      .select({ id: shareClicks.id, shareUrl: shareClicks.shareUrl })
      .from(shareClicks)
      .where(eq(shareClicks.sharerUserId, userId));
    for (const row of clickRows) {
      await tx
        .update(shareClicks)
        .set({
          shareUrl: redactIdentifyingText(row.shareUrl, identifiers) ?? "[deleted]",
          externalReferrer: null,
        })
        .where(eq(shareClicks.id, row.id));
    }

    await tx
      .update(profiles)
      .set(patch as typeof profiles.$inferInsert)
      .where(and(eq(profiles.id, userId), isNull(profiles.deletedAt)));
  });
}

async function stampDeletedAt(userId: string, deletedAt: Date): Promise<void> {
  await db
    .update(profiles)
    .set({ deletedAt })
    .where(and(eq(profiles.id, userId), isNull(profiles.deletedAt)));

  try {
    await db.insert(adminAuditLog).values({
      adminId: userId,
      actionType: "user_account_deletion_finalised",
      targetTable: "profiles",
      targetId: userId,
      previousData: null,
      newData: { deletedAt },
      metadata: { source: "account_deletion_sweeper" },
    });
  } catch (auditErr) {
    log(
      `[AccountDeletion] Finalisation audit-log insert failed (deletedAt still committed): ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
    );
  }
}
