import { useRef } from "react";
import type { CommentItem } from "./types";
import type { CommentSort } from "./CommentSortHeader";
import { compareTopLevel } from "./buildThreadedComments";

interface OrderState {
  sort: CommentSort;
  order: Map<string, number>;
}

/**
 * Returns a frozen `id -> rank` map for top-level comments that only changes
 * when the sort changes or the set of top-level comment ids changes.
 *
 * Optimistic votes mutate vote counts but never the id set (or `createdAt`), so
 * the returned order stays stable across a vote — the tapped comment updates
 * its count/highlight in place instead of jumping position. Already-visible
 * comments keep their relative order; newly arrived (or own-posted) comments are
 * inserted at their natural position. Re-sorting happens on sort-toggle or when
 * the view is remounted/reopened (fresh ref).
 */
export function useStableCommentOrder(
  comments: CommentItem[],
  sort: CommentSort,
): Map<string, number> {
  const ref = useRef<OrderState | null>(null);

  const topLevel = comments.filter((c) => !c.parentId && !c.deletedAt);
  const prev = ref.current;

  let needsRecompute = false;
  if (!prev || prev.sort !== sort) {
    needsRecompute = true;
  } else if (prev.order.size !== topLevel.length) {
    needsRecompute = true;
  } else {
    for (const c of topLevel) {
      if (!prev.order.has(c.id)) {
        needsRecompute = true;
        break;
      }
    }
  }

  if (needsRecompute) {
    const sorted = [...topLevel].sort((a, b) => {
      const ra = prev?.order.get(a.id);
      const rb = prev?.order.get(b.id);
      // Both already ranked: preserve their prior relative order (no jumping).
      if (ra !== undefined && rb !== undefined) return ra - rb;
      // New comment(s): place by the deterministic natural comparator.
      return compareTopLevel(a, b, sort);
    });
    const order = new Map<string, number>();
    sorted.forEach((c, i) => order.set(c.id, i));
    ref.current = { sort, order };
  }

  return ref.current!.order;
}
