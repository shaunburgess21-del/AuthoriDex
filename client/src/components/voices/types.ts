import type { ParentVoteLabel } from "@/components/comments/types";

export type VoicesFeedMode = "for-you" | "latest" | "top";
export type VoicesFeedSource = "comment" | "insight";

export type VoicesSurface =
  | "matchup"
  | "sentiment_poll"
  | "opinion_poll"
  | "world_market"
  | "profile"
  | "timeline";

export type VoicesParentType =
  | "matchup"
  | "trending_poll"
  | "opinion_poll"
  | "open_market"
  | "community_insight"
  | "voices_post";

export interface VoicesEntity {
  surface: VoicesSurface;
  refType: "matchup" | "trending_poll" | "opinion_poll" | "open_market" | "person" | "timeline";
  refId: string;
  title: string;
  subtitle: string | null;
  href: string;
  slug: string | null;
  imageUrl: string | null;
  category: string | null;
  personIds: string[];
}

export interface VoicesAuthor {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  rank: string | null;
}

export interface VoicesFeedItem {
  id: string;
  source: VoicesFeedSource;
  parentType: VoicesParentType;
  body: string;
  author: VoicesAuthor;
  upvotes: number;
  downvotes: number;
  replyCount: number;
  createdAt: string;
  entity: VoicesEntity;
  badges: { topTake: boolean; rising: boolean };
  score: number;
  userVote?: "up" | null;
}

export interface VoicesFeedResponse {
  items: VoicesFeedItem[];
  nextCursor: string | null;
  total: number;
}

/** Maps the feed item's refType to the CardComments entityType for the focus overlay. */
export const CARD_ENTITY_TYPE: Record<string, "matchup" | "poll" | "opinion-poll" | "open-market"> = {
  matchup: "matchup",
  trending_poll: "poll",
  opinion_poll: "opinion-poll",
  open_market: "open-market",
};

export interface VoicesFilters {
  surfaces: VoicesSurface[];
  personIds: string[];
  categories: string[];
}

export const EMPTY_VOICES_FILTERS: VoicesFilters = {
  surfaces: [],
  personIds: [],
  categories: [],
};

export interface VoicesReply {
  id: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  authorRank: string | null;
  body: string;
  parentCommentId: string | null;
  upvotes: number;
  downvotes: number;
  userVote: "up" | null;
  deletedAt: string | null;
  createdAt: string;
  parentVoteLabel: ParentVoteLabel | null;
}
