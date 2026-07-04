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
  parentVoteLabel?: ParentVoteLabel | null;
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
