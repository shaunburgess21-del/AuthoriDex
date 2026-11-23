/**
 * Invite card under the returning-user strip. It opens only when today's
 * goal flips from not-done to done in this mount, at most once per 7 days,
 * and a dismiss hides it for that user until the key is cleared.
 */

export const GOAL_INVITE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function goalInviteShownKey(userId: string): string {
  return `voxdex_goal_invite_shown:${userId}`;
}

export function goalInviteDismissedKey(userId: string): string {
  return `voxdex_goal_invite_dismissed:${userId}`;
}

export interface GoalInviteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readGoalInviteShownAt(storage: GoalInviteStorage, userId: string): number | null {
  try {
    const raw = storage.getItem(goalInviteShownKey(userId));
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeGoalInviteShownAt(storage: GoalInviteStorage, userId: string, now: number): void {
  try {
    storage.setItem(goalInviteShownKey(userId), String(now));
  } catch {
    // Private mode can reject the write. The in-memory latch still holds this mount.
  }
}

export function readGoalInviteDismissed(storage: GoalInviteStorage, userId: string): boolean {
  try {
    return storage.getItem(goalInviteDismissedKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeGoalInviteDismissed(storage: GoalInviteStorage, userId: string): void {
  try {
    storage.setItem(goalInviteDismissedKey(userId), "1");
  } catch {
    // The in-memory flag still hides it for this mount.
  }
}

export interface GoalInviteDecisionInput {
  signedIn: boolean;
  userId: string | null;
  /** This mount has seen the goal not-done, then done. A load that is already done is false. */
  flippedThisSession: boolean;
  goalDone: boolean;
  dismissed: boolean;
  lastShownAt: number | null;
  now: number;
  /** This mount already opened the card, so the fresh stamp does not close it. */
  alreadyOpen: boolean;
}

/**
 * Whether the invite card is open. `alreadyOpen` keeps the current showing
 * up after the 7-day stamp is written. A later flip in the same week does
 * not open it again, because the caller clears `alreadyOpen` when the goal
 * is no longer done.
 */
export function goalInviteOpen(input: GoalInviteDecisionInput): boolean {
  if (!input.signedIn || !input.userId) return false;
  if (input.dismissed) return false;
  if (!input.goalDone) return false;
  if (input.alreadyOpen) return true;
  if (!input.flippedThisSession) return false;
  if (
    input.lastShownAt != null &&
    input.now - input.lastShownAt < GOAL_INVITE_INTERVAL_MS
  ) {
    return false;
  }
  return true;
}
