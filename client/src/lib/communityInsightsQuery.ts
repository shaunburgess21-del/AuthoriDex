import { apiRequest } from "@/lib/queryClient";
import type { CommentItem, ParentVoteLabel, VoteType } from "@/components/comments/types";

/** Raw GET /api/comments?parentType=community_insight&parentId=<personId>&topLevelOnly=true
 *  row shape (a top-level profile post after the community_insights → comments merge).
 *  Maps onto the legacy CommunityInsight shape so the CommunityInsights component
 *  doesn't need to change its rendering logic. */
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
  /** Number of nested replies on this post (replies live in the unified
   *  comments table with parent_comment_id = <this post's id>). Used by InsightCard
   *  to show a "N replies" indicator without opening the modal. */
  replyCount?: number;
  parentVoteLabel?: ParentVoteLabel | null;
}

/** Raw GET /api/comments?parentType=community_insight&parentCommentId=<insightId>
 *  row shape (a reply to a top-level profile post). Mirrors the shape used by
 *  PostOverlayModal so the same query key stays in sync between the main view
 *  and the modal. */
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

/** Fetch the reply thread for a single top-level profile post. After the merge,
 *  replies have parent_comment_id = <topLevelCommentId> and parent_id = <personId>,
 *  so we query by parentCommentId. The personId is required for the route to
 *  resolve the parent. Used by InsightReplies on the main profile view so
 *  nested replies are visible without opening PostOverlayModal. */
export async function fetchInsightReplies(personId: string, insightId: string): Promise<CommentItem[]> {
  const res = await apiRequest(
    "GET",
    `/api/comments?parentType=community_insight&parentId=${encodeURIComponent(personId)}&parentCommentId=${encodeURIComponent(insightId)}&limit=100`,
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
  // Key kept as /api/community-insights/${personId} for cache continuity —
  // the underlying fetch now hits /api/comments with topLevelOnly=true, but
  // existing cache entries (and invalidations) keep working without client
  // code changes.
  return [`/api/community-insights/${personId}`] as const;
}

function mapCommentRowToInsight(row: InsightCommentResponse, personId: string): CommunityInsight {
  return {
    id: row.id,
    personId,
    userId: row.userId,
    username: row.username,
    avatarUrl: row.avatarUrl,
    authorRank: row.authorRank ?? null,
    content: row.body,
    sentimentVote: null, // dropped during the merge (0 rows had it set)
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    upvotes: row.upvotes ?? 0,
    downvotes: row.downvotes ?? 0,
    replyCount: row.replyCount ?? 0,
    parentVoteLabel: row.parentVoteLabel ?? null,
  };
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

/** Fetches and normalizes community insights for TanStack Query cache (CommentItem[]).
 *  After the merge, hits GET /api/comments with topLevelOnly=true. */
export async function fetchCommunityInsightComments(personId: string): Promise<CommentItem[]> {
  const { comments } = await fetchCommunityInsightThread(personId);
  return comments;
}

/** Fetches insights plus metadata map for sentimentVote / overlay surfaces.
 *  After the merge, the underlying call is GET /api/comments?parentType=
 *  community_insight&parentId=<personId>&topLevelOnly=true. */
export async function fetchCommunityInsightThread(personId: string): Promise<{
  comments: CommentItem[];
  insightsById: Record<string, CommunityInsight>;
}> {
  const res = await apiRequest(
    "GET",
    `/api/comments?parentType=community_insight&parentId=${encodeURIComponent(personId)}&topLevelOnly=true&limit=100`,
  );
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    return { comments: [], insightsById: {} };
  }

  const rows = raw as InsightCommentResponse[];
  const insights = rows.map((r) => mapCommentRowToInsight(r, personId));
  return {
    comments: insights.map(mapInsightToCommentItem),
    insightsById: Object.fromEntries(insights.map((i) => [i.id, i])),
  };
}

/** Fetch the user's vote state for top-level profile posts on a person.
 *  After the merge, votes live in comment_votes, so we derive the map from
 *  the /api/comments response (which includes userVote per comment when
 *  authenticated). */
export async function fetchCommunityInsightUserVotes(
  personId: string,
): Promise<Record<string, VoteType>> {
  const res = await apiRequest(
    "GET",
    `/api/comments?parentType=community_insight&parentId=${encodeURIComponent(personId)}&topLevelOnly=true&limit=100`,
  );
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    return {};
  }

  const rows = raw as InsightCommentResponse[];
  const voteMap: Record<string, VoteType> = {};
  for (const row of rows) {
    if (row.userVote) {
      voteMap[row.id] = row.userVote;
    }
  }
  return voteMap;
}
