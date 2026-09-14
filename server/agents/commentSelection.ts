/**
 * Pure selection helpers for the agent comment sweep.
 *
 * Lives in its own module with NO side-effect imports (no `../db`, no schema)
 * so unit tests can exercise weighting / reply gating without dragging in a
 * DB connection at module-load time. Same split as `voteSelection.ts`.
 *
 * See `commentWorker.ts` for the DB-reading shell that consumes these.
 *
 * Three behaviours, matching the Sep 2026 vote-card fill brief:
 *   A. Least-commented-first — `1 / (count + 1)` inside a surface, same
 *      decay as votes. Empty cards rise without changing total volume.
 *   B. Replies only on cards that already look like a thread (≥2 comments).
 *   D. Thin stale threads (count < 3 and last comment older than 7 days)
 *      are treated as empty so they compete with never-commented cards
 *      instead of freezing once the 7-day reply window closes.
 */

import { selectionWeight } from "./voteSelection";

/** Same 7-day window `findReplyTarget` uses. A comment older than this
 *  cannot receive an agent reply, so a thin card with only stale comments
 *  is as dead as an empty one until a fresh top-level lands. */
export const COMMENT_ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Below this count, a stale last-comment is treated as empty (D). */
export const UNSTICK_COMMENT_FLOOR = 3;

/** Replies are reserved for cards that already have a conversation (B).
 *  Empty cards and single comments stay on the top-level path so they
 *  can reach this floor. */
export const MIN_COMMENTS_FOR_REPLY = 2;

export type CommentCountRow = {
  parentType: string | null;
  parentId: string | null;
  c: number | string;
  lastAt: Date | string | number | null;
};

export function commentParentKey(parentType: unknown, parentId: unknown): string {
  return `${String(parentType)}:${String(parentId)}`;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Attach visible-comment totals onto parent rows. Cards with no comments
 * have no GROUP BY row — they must read as 0, not drop out of the pool.
 */
export function attachCommentStats<T extends { parentType: string; parentId: string }>(
  parents: T[],
  rows: CommentCountRow[],
): Array<T & { commentCount: number; lastCommentAt: Date | null }> {
  const byKey = new Map<string, { commentCount: number; lastCommentAt: Date | null }>();
  for (const row of rows) {
    if (row.parentType == null || row.parentId == null) continue;
    byKey.set(commentParentKey(row.parentType, row.parentId), {
      commentCount: Number(row.c || 0),
      lastCommentAt: toDate(row.lastAt),
    });
  }
  return parents.map((parent) => {
    const stats = byKey.get(commentParentKey(parent.parentType, parent.parentId));
    return {
      ...parent,
      commentCount: stats?.commentCount ?? 0,
      lastCommentAt: stats?.lastCommentAt ?? null,
    };
  });
}

/**
 * Count used for weighting. Thin cards whose latest comment is outside
 * the activity window collapse to 0 so they get the same priority as
 * never-commented cards (D). Cards at/above the floor keep their real
 * count — a 13-comment thread that went quiet for a week is not empty.
 */
export function effectiveCommentCount(
  commentCount: number,
  lastCommentAt: Date | null,
  now: Date,
): number {
  const n = Math.max(0, commentCount);
  if (n < UNSTICK_COMMENT_FLOOR) {
    if (lastCommentAt == null) return 0;
    if (now.getTime() - lastCommentAt.getTime() >= COMMENT_ACTIVITY_WINDOW_MS) return 0;
  }
  return n;
}

/** True when the reply path is allowed to probe this card (B + D). */
export function canReplyOnCard(
  commentCount: number,
  lastCommentAt: Date | null,
  now: Date,
): boolean {
  return effectiveCommentCount(commentCount, lastCommentAt, now) >= MIN_COMMENTS_FOR_REPLY;
}

export function filterReplyEligibleParents<
  T extends { commentCount: number; lastCommentAt: Date | null },
>(parents: T[], now: Date): T[] {
  return parents.filter((parent) => canReplyOnCard(parent.commentCount, parent.lastCommentAt, now));
}

/**
 * Pick a card, weighted toward the fewest (effective) comments.
 * Same formula as `pickLeastVotedFirst` — empty is ~10x likelier than a
 * card with nine comments, and the bias decays as the inventory fills.
 */
export function pickLeastCommentedFirst<T extends { commentCount: number }>(
  candidates: T[],
): T {
  if (!candidates.length) {
    throw new Error("pickLeastCommentedFirst called with no candidates");
  }
  const weights = candidates.map((c) => selectionWeight(c.commentCount));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** Apply D's stale-thin collapse, then A. */
export function pickLeastCommentedParent<T extends { commentCount: number; lastCommentAt: Date | null }>(
  candidates: T[],
  now: Date,
): T {
  const scored = candidates.map((parent) => ({
    parent,
    commentCount: effectiveCommentCount(parent.commentCount, parent.lastCommentAt, now),
  }));
  return pickLeastCommentedFirst(scored).parent;
}
