/**
 * Pure helpers for the account-deletion lifecycle. Lives in its own
 * module with NO side-effect imports (no `../db`, no schema, no
 * sentry) so unit tests can pin the math without dragging in a DB
 * connection at module load.
 *
 * See `account-deletion.ts` for the live DB-reading shell.
 */

/** 7-day soft-delete window in milliseconds. Exported so the route
 *  handler can include it in the user-facing response. */
export const DELETION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pure helper: given `now` and the two profile timestamps, returns
 * whether the sweeper would consider the row overdue. Mirrors the
 * SQL predicate used by `processOverdueAccountDeletions`.
 *
 * Rules:
 *   - `deletedAt` set → never overdue (already finalised, idempotent skip).
 *   - `scheduledFor` null → never overdue (no deletion pending).
 *   - `scheduledFor` in the past or equal to now → overdue.
 *   - `scheduledFor` in the future → not overdue (still in window).
 */
export function isOverdue(input: {
  now: Date;
  scheduledFor: Date | null;
  deletedAt: Date | null;
}): boolean {
  const { now, scheduledFor, deletedAt } = input;
  if (deletedAt) return false;
  if (!scheduledFor) return false;
  return scheduledFor.getTime() <= now.getTime();
}
