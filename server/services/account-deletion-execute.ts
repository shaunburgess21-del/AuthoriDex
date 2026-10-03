/**
 * Orders permanent deletion without importing the database or the
 * Supabase client. Production passes the real store and
 * `auth.admin.deleteUser`. Tests pass fakes so Auth is never called
 * for real.
 *
 * Order:
 *   1. Erase personal data (this is the moment erasure has started).
 *   2. Delete the Supabase Auth user. A missing user (404) is success.
 *   3. Only then stamp `deletedAt`.
 * If step 2 fails, `deletedAt` stays null so the sweeper retries.
 * Cancellation and sign-in are already closed by step 1.
 */

import {
  classifyAuthDeleteError,
  isErasureStarted,
  shouldStampDeletedAt,
  type AuthDeleteError,
} from "./account-deletion-utils";

export type PermanentDeletionCandidate = {
  id: string;
  role: string;
  username: string | null;
  deletedAt: Date | null;
  /** Platform accounts (house, scout, agents) and admins. */
  protectedAccount: boolean;
};

export type AuthDeleteResult = { error: AuthDeleteError };

export type PermanentDeletionOutcome =
  | { outcome: "skipped_missing" }
  | { outcome: "skipped_finalised" }
  | { outcome: "skipped_protected" }
  | { outcome: "auth_failed" }
  | { outcome: "finalised"; auth: "deleted" | "already_missing" };

export async function performPermanentDeletion(opts: {
  userId: string;
  now: Date;
  loadCandidate: () => Promise<PermanentDeletionCandidate | null>;
  erasePersonalData: (candidate: PermanentDeletionCandidate) => Promise<void>;
  deleteAuthUser: (userId: string) => Promise<AuthDeleteResult>;
  stampDeletedAt: (deletedAt: Date) => Promise<void>;
}): Promise<PermanentDeletionOutcome> {
  const candidate = await opts.loadCandidate();
  if (!candidate) return { outcome: "skipped_missing" };
  if (candidate.deletedAt) return { outcome: "skipped_finalised" };
  if (candidate.protectedAccount || candidate.role === "admin") {
    return { outcome: "skipped_protected" };
  }

  if (!isErasureStarted(candidate)) {
    await opts.erasePersonalData(candidate);
  }

  const authResult = await opts.deleteAuthUser(opts.userId);
  const classified = classifyAuthDeleteError(authResult.error);
  if (!shouldStampDeletedAt(classified)) {
    return { outcome: "auth_failed" };
  }

  await opts.stampDeletedAt(opts.now);
  return {
    outcome: "finalised",
    auth: classified === "already_missing" ? "already_missing" : "deleted",
  };
}
