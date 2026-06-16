import type { CommentItem, CommentTreeNode, ThreadedComment } from "./types";
import type { CommentSort } from "./CommentSortHeader";

function buildChildNodes(items: CommentItem[], replyMap: Map<string, CommentItem[]>): CommentTreeNode[] {
  return items.map((comment) => ({
    comment,
    children: buildChildNodes(replyMap.get(comment.id) ?? [], replyMap),
  }));
}

/** Deterministic ordering for top-level comments. Mirrors the server tie-break
 * (`net desc, createdAt desc, id desc`) so the client and server agree. */
export function compareTopLevel(a: CommentItem, b: CommentItem, sort: CommentSort): number {
  if (sort === "top") {
    const net = (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes);
    if (net !== 0) return net;
  }
  const t = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (t !== 0) return t;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * Shared tree builder for embedded and infinite comment lists.
 *
 * When `topOrder` is supplied, top-level comments are ordered by that frozen
 * `id -> rank` map instead of being re-sorted by live vote counts. This keeps
 * rows from jumping when a user optimistically votes (the vote still updates
 * counts/highlight in place). Any ids missing from the map (e.g. brand new
 * comments) fall back to the deterministic comparator and sort after ranked rows.
 */
export function buildThreadedComments(
  comments: CommentItem[],
  sort: CommentSort,
  topOrder?: Map<string, number>,
): ThreadedComment[] {
  if (!comments.length) return [];
  const live = comments.filter((c) => !c.deletedAt);
  const topLevel = live.filter((c) => !c.parentId);
  const replies = live.filter((c) => !!c.parentId);

  if (topOrder) {
    topLevel.sort((a, b) => {
      const ra = topOrder.get(a.id);
      const rb = topOrder.get(b.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return compareTopLevel(a, b, sort);
    });
  } else {
    topLevel.sort((a, b) => compareTopLevel(a, b, sort));
  }

  const replyMap = new Map<string, CommentItem[]>();
  for (const r of replies) {
    const pid = r.parentId!;
    if (!replyMap.has(pid)) replyMap.set(pid, []);
    replyMap.get(pid)!.push(r);
  }
  Array.from(replyMap.values()).forEach((arr) => {
    arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  });

  return topLevel.map((root) => ({
    root,
    children: buildChildNodes(replyMap.get(root.id) ?? [], replyMap),
  }));
}
