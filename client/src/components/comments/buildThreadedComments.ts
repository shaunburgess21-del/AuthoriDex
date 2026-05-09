import type { CommentItem, CommentTreeNode, ThreadedComment } from "./types";
import type { CommentSort } from "./CommentSortHeader";

function buildChildNodes(items: CommentItem[], replyMap: Map<string, CommentItem[]>): CommentTreeNode[] {
  return items.map((comment) => ({
    comment,
    children: buildChildNodes(replyMap.get(comment.id) ?? [], replyMap),
  }));
}

/** Shared tree builder for embedded and infinite comment lists. */
export function buildThreadedComments(comments: CommentItem[], sort: CommentSort): ThreadedComment[] {
  if (!comments.length) return [];
  const live = comments.filter((c) => !c.deletedAt);
  const topLevel = live.filter((c) => !c.parentId);
  const replies = live.filter((c) => !!c.parentId);

  if (sort === "top") {
    topLevel.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
  } else {
    topLevel.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
