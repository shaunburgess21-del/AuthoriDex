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

export type VoicesProfileStats = {
  categoryRank: number | null;
  fameIndex: number | null;
  change24h: number | null;
  change7d: number | null;
  approvalAvgRating: number | null;
};

export const EMPTY_PROFILE_STATS: VoicesProfileStats = {
  categoryRank: null,
  fameIndex: null,
  change24h: null,
  change7d: null,
  approvalAvgRating: null,
};

export interface VoicesEntity {
  surface: VoicesSurface;
  refType: "matchup" | "trending_poll" | "opinion_poll" | "open_market" | "person" | "timeline";
  refId: string;
  title: string;
  subtitle: string | null;
  /** Optional card body snippet shown under the title (sentiment polls). */
  excerpt?: string | null;
  href: string;
  slug: string | null;
  imageUrl: string | null;
  /** Secondary image when the primary hero fails to load (e.g. first opinion option). */
  fallbackImageUrl: string | null;
  category: string | null;
  personIds: string[];
  /** Leaderboard stats for profile link cards (person entities only). */
  profileStats?: VoicesProfileStats | null;
  /** Induction-queue CTA preview for profile link cards (person entities only). */
  inductionPreview?: {
    inductionCandidateId: string | null;
    seedVotes: number;
  } | null;
  /** Vote distribution for sentiment poll link cards (trending_poll only). */
  sentimentResults?: {
    agreePercent: number;
    neutralPercent: number;
    disagreePercent: number;
  } | null;
  /** Top leading options for opinion poll link cards (opinion_poll only). */
  opinionPreview?: {
    totalOptions: number;
    totalVotes: number;
    topOptions: Array<{ name: string; percent: number; votes: number }>;
  } | null;
  /** Live LMSR outcome split for world market link cards (open_market only). */
  worldMarketPreview?:
    | {
        layout: "binary";
        left: { label: string; percent: number };
        right: { label: string; percent: number };
        isClassicYesNo: boolean;
      }
    | {
        layout: "multi";
        totalOutcomes: number;
        topOutcomes: Array<{ label: string; percent: number }>;
      }
    | null;
  /** Present for matchups only — drives the A/B split preview banner. */
  media?: {
    optionAImage: string | null;
    optionAText: string;
    optionBImage: string | null;
    optionBText: string;
  } | null;
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
  /** Raw parent id (card/poll/market/person id; timeline sentinel for voices_post). */
  parentId: string;
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
  /** Author's own vote on the parent card (null for timeline posts). */
  parentVoteLabel?: ParentVoteLabel | null;
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
