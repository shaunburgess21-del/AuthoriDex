import { apiRequest } from "@/lib/queryClient";
import type { CommentItem, ParentVoteLabel, VoteType } from "@/components/comments/types";

/** Legacy shape kept for Voices PostOverlayModal / metadata consumers. */
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
  replyCount?: number;
  parentVoteLabel?: ParentVoteLabel | null;
}

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

/** @deprecated Prefer toPersonThreadCommentItem — kept for PostOverlayModal reply mapping. */
export function toInsightReplyCommentItem(comment: InsightCommentResponse): CommentItem {
  return toPersonThreadCommentItem(comment);
}

/** Fetch the reply thread for a single top-level profile post (Voices modal). */
export async function fetchInsightReplies(personId: string, insightId: string): Promise<CommentItem[]> {
  const res = await apiRequest(
    "GET",
    `/api/comments?parentType=community_insight&parentId=${encodeURIComponent(personId)}&parentCommentId=${encodeURIComponent(insightId)}&limit=100`,
  );
  const raw = (await res.json()) as InsightCommentResponse[];
  return raw.map(toPersonThreadCommentItem);
}

/** TanStack Query key for a single insight's reply thread (PostOverlayModal). */
export function insightRepliesQueryKey(insightId: string): readonly [string, string, string] {
  return ["/api/comments", "community_insight", insightId] as const;
}

/** TanStack Query key for a person's full profile discussion thread (roots + replies). */
export function communityInsightsQueryKey(
  personId: string,
): readonly ["/api/comments", "community_insight", string, "thread"] {
  return ["/api/comments", "community_insight", personId, "thread"] as const;
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
    sentimentVote: null,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    upvotes: row.upvotes ?? 0,
    downvotes: row.downvotes ?? 0,
    replyCount: row.replyCount ?? 0,
    parentVoteLabel: row.parentVoteLabel ?? null,
  };
}

/** Fetches the flat person discussion thread for TanStack Query cache. */
export async function fetchCommunityInsightComments(personId: string): Promise<CommentItem[]> {
  const { comments } = await fetchCommunityInsightThread(personId);
  return comments;
}

/**
 * Fetches all community_insight comments for a person (top-level + nested replies)
 * as a flat CommentItem[] ready for buildThreadedComments.
 */
export async function fetchCommunityInsightThread(personId: string): Promise<{
  comments: CommentItem[];
  insightsById: Record<string, CommunityInsight>;
}> {
  const res = await apiRequest(
    "GET",
    `/api/comments?parentType=community_insight&parentId=${encodeURIComponent(personId)}&limit=100`,
  );
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    return { comments: [], insightsById: {} };
  }

  const rows = raw as InsightCommentResponse[];
  const comments = rows.map(toPersonThreadCommentItem);
  const topLevel = rows.filter((r) => !r.parentCommentId);
  const insights = topLevel.map((r) => mapCommentRowToInsight(r, personId));

  return {
    comments,
    insightsById: Object.fromEntries(insights.map((i) => [i.id, i])),
  };
}

/** Derive userVote map from the full person thread (authenticated responses include userVote). */
export async function fetchCommunityInsightUserVotes(
  personId: string,
): Promise<Record<string, VoteType>> {
  const res = await apiRequest(
    "GET",
    `/api/comments?parentType=community_insight&parentId=${encodeURIComponent(personId)}&limit=100`,
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
