import { apiRequest } from "@/lib/queryClient";
import type { CommentItem, ParentVoteLabel, VoteType } from "@/components/comments/types";

/** Raw GET /api/community-insights/:personId row shape. */
export interface CommunityInsight {
  id: string;
  personId: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  authorRank?: string | null;
  content: string;
  sentimentVote?: number | null;
  deletedAt: string | null;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  /** Number of nested replies on this insight (replies live in the unified
   *  comments table with parentType='community_insight'). Used by InsightCard
   *  to show a "N replies" indicator without opening the modal. */
  replyCount?: number;
  parentVoteLabel?: ParentVoteLabel | null;
}

/** Raw GET /api/comments?parentType=community_insight row shape (a reply
 *  to a top-level insight). Mirrors the shape used by PostOverlayModal so
 *  the same query key stays in sync between the main view and the modal. */
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
}

/** Convert a unified-comment API response into the CommentItem shape used
 *  by the shared CommentList/CommentRow components. */
export function toInsightReplyCommentItem(comment: InsightCommentResponse): CommentItem {
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

/** Fetch the reply thread for a single insight (top-level replies + nested
 *  replies under them). Used by InsightReplies on the main profile view so
 *  nested replies are visible without opening PostOverlayModal. */
export async function fetchInsightReplies(insightId: string): Promise<CommentItem[]> {
  const res = await apiRequest(
    "GET",
    `/api/comments?parentType=community_insight&parentId=${encodeURIComponent(insightId)}&limit=100`,
  );
  const raw = (await res.json()) as InsightCommentResponse[];
  return raw.map(toInsightReplyCommentItem);
}

/** TanStack Query key for a single insight's reply thread. Shared between
 *  the main view's InsightReplies and PostOverlayModal so a reply posted in
 *  either surface invalidates the other. */
export function insightRepliesQueryKey(insightId: string): readonly [string, string, string] {
  return ["/api/comments", "community_insight", insightId] as const;
}

export function communityInsightsQueryKey(personId: string): readonly [`/api/community-insights/${string}`] {
  return [`/api/community-insights/${personId}`] as const;
}

function mapInsightToCommentItem(i: CommunityInsight): CommentItem {
  return {
    id: i.id,
    userId: i.userId,
    username: i.username,
    avatarUrl: i.avatarUrl,
    authorRank: i.authorRank ?? null,
    body: i.content,
    parentId: null,
    upvotes: i.upvotes ?? 0,
    downvotes: i.downvotes ?? 0,
    userVote: null,
    deletedAt: i.deletedAt,
    parentVoteLabel: i.parentVoteLabel ?? null,
    createdAt: i.createdAt,
  };
}

/** Fetches and normalizes community insights for TanStack Query cache (CommentItem[]). */
export async function fetchCommunityInsightComments(personId: string): Promise<CommentItem[]> {
  const { comments } = await fetchCommunityInsightThread(personId);
  return comments;
}

/** Fetches insights plus metadata map for sentimentVote / overlay surfaces. */
export async function fetchCommunityInsightThread(personId: string): Promise<{
  comments: CommentItem[];
  insightsById: Record<string, CommunityInsight>;
}> {
  const res = await apiRequest("GET", `/api/community-insights/${personId}`);
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    return { comments: [], insightsById: {} };
  }

  const insights = raw as CommunityInsight[];
  return {
    comments: insights.map(mapInsightToCommentItem),
    insightsById: Object.fromEntries(insights.map((i) => [i.id, i])),
  };
}

export async function fetchCommunityInsightUserVotes(
  personId: string,
): Promise<Record<string, VoteType>> {
  const res = await apiRequest("GET", `/api/community-insights/${personId}/votes`);
  return (await res.json()) as Record<string, VoteType>;
}
