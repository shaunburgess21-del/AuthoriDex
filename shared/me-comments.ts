// Shared types for the /me/comments history page (GET /api/me/comments).
// A single timeline merges authored unified comments (timeline posts, card
// comments, replies) and community insights, sorted newest-first.

export type MeCommentSource = "comment" | "insight";

export type MeCommentFilter = "all" | "timeline" | "replies" | "insights";

/** Lightweight context for the source card / profile / timeline a message is attached to. */
export interface MeCommentEntity {
  refType: "matchup" | "trending_poll" | "opinion_poll" | "open_market" | "person" | "timeline";
  title: string;
  /** Short type label, e.g. "Matchup", "Sentiment Poll". Null for timeline posts. */
  subtitle: string | null;
  href: string;
  imageUrl: string | null;
}

export interface MeCommentItem {
  id: string;
  source: MeCommentSource;
  body: string;
  /** Stored parent type (voices_post, matchup, community_insight, etc.). */
  parentType: string;
  parentCommentId: string | null;
  isReply: boolean;
  upvotes: number;
  createdAt: string;
  entity: MeCommentEntity;
  /** Deep link that lands on the source surface and locates the thread via hash. */
  threadHref: string;
}

export interface MeCommentStats {
  /** All authored comments + replies (excludes soft-deleted). */
  totalComments: number;
  totalInsights: number;
  /** Standalone Voices timeline posts (parent_type = voices_post, top-level). */
  totalTimelinePosts: number;
  /** Replies (parent_comment_id is not null). */
  totalReplies: number;
}

export interface MeCommentsResponse {
  items: MeCommentItem[];
  stats: MeCommentStats;
  nextCursor: string | null;
}
