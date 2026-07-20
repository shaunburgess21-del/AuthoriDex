import type { CommentItem, ParentVoteLabel, VoteType } from "@/components/comments/types";

/** Raw GET /api/comments row for community_insight (person-scoped). */
export interface InsightCommentResponse {
  id: string;
  parentCommentId: string | null;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  authorRank?: string | null;
  body: string;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  userVote?: VoteType | null;
  deletedAt: string | null;
  parentVoteLabel?: ParentVoteLabel | null;
  xp?: unknown;
  replyCount?: number;
}

/**
 * Map a unified comment onto the client tree for buildThreadedComments:
 * - Top-level profile post (parentCommentId null) → parentId null
 * - Reply → parentId = parentCommentId
 */
export function toPersonThreadCommentItem(comment: InsightCommentResponse): CommentItem {
  return {
    id: comment.id,
    userId: comment.userId,
    username: comment.username,
    avatarUrl: comment.avatarUrl,
    authorRank: comment.authorRank ?? null,
    body: comment.body,
    parentId: comment.parentCommentId,
    upvotes: comment.upvotes ?? 0,
    downvotes: comment.downvotes ?? 0,
    userVote: comment.userVote ?? null,
    deletedAt: comment.deletedAt,
    parentVoteLabel: comment.parentVoteLabel ?? null,
    createdAt: comment.createdAt,
  };
}

/**
 * Map reply-only thread rows (parentCommentId filter) for overlays where the
 * root post is rendered outside the comment list. Direct replies store
 * parentCommentId = insightId; normalize that to parentId null for threading.
 */
export function toInsightReplyCommentItem(
  comment: InsightCommentResponse,
  insightId: string,
): CommentItem {
  return {
    ...toPersonThreadCommentItem(comment),
    parentId:
      comment.parentCommentId === insightId ? null : comment.parentCommentId,
  };
}
