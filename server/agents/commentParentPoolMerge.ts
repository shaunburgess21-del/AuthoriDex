/** Pure merge/dedupe helpers — no DB import (safe for unit tests). */

export const COMMENT_PARENT_POOL_SIZE = 200;
export const COMMENT_PARENT_RECENT_SLOTS = 70;
export const COMMENT_PARENT_EXPLORE_SLOTS =
  COMMENT_PARENT_POOL_SIZE - COMMENT_PARENT_RECENT_SLOTS;

/** Over-fetch explore rows so post-dedupe merged pools stay near POOL_SIZE. */
export const COMMENT_PARENT_EXPLORE_FETCH_LIMIT =
  COMMENT_PARENT_EXPLORE_SLOTS + COMMENT_PARENT_RECENT_SLOTS;

export type CommentParentPoolRow = {
  parentId: string;
  title: string;
  category: string | null;
};

export type CommentParentPoolStats = {
  recent: number;
  explore: number;
  merged: number;
};

export type CommentParentPoolResult = {
  rows: CommentParentPoolRow[];
  stats: CommentParentPoolStats;
};

/** Merge recent + explore slices, dedupe by parentId, cap at maxSize. */
export function mergeParentPoolRows(
  recent: CommentParentPoolRow[],
  explore: CommentParentPoolRow[],
  maxSize: number = COMMENT_PARENT_POOL_SIZE,
): CommentParentPoolResult {
  const seen = new Set<string>();
  const rows: CommentParentPoolRow[] = [];
  for (const row of [...recent, ...explore]) {
    if (seen.has(row.parentId)) continue;
    seen.add(row.parentId);
    rows.push(row);
    if (rows.length >= maxSize) break;
  }
  return {
    rows,
    stats: {
      recent: recent.length,
      explore: explore.length,
      merged: rows.length,
    },
  };
}
