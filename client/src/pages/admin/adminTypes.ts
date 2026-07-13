/**
 * Shared types, constants, and literal-types used by the Admin Dashboard.
 *
 * These were originally defined inline at the top of AdminDashboard.tsx.
 * Moving them here keeps the main component file leaner and lets extracted
 * sub-components (modals, section panels) import them without a circular
 * dependency.
 */

import { MARKET_CATEGORY_OPTIONS } from "@shared/constants";

export const MARKET_CATEGORIES = MARKET_CATEGORY_OPTIONS;
export const GAINER_MARKET_CATEGORIES = MARKET_CATEGORY_OPTIONS;

export type AdminSection =
  | "overview"
  | "celebrities"
  | "predictions"
  | "voting"
  | "moderation"
  | "settlement"
  | "amm"
  | "users"
  | "gamification"
  // @deprecated — aliased into Gamification CMS. Remove in
  // next admin cleanup pass.
  | "credits"
  // @deprecated — aliased into Gamification CMS. Remove in
  // next admin cleanup pass.
  | "badges"
  | "agents"
  | "categories"
  | "branding"
  | "tools";

export interface AdminStats {
  totalUsers: number;
  totalCelebrities: number;
  totalVotes: number;
  totalPredictions: number;
  lastDataRefresh: string | null;
}

export interface TrafficStats {
  total: number;
  today: number;
  last7Days: number;
  last30Days: number;
  humanLikeLast30Days?: number;
  botLikeLast30Days?: number;
  uniqueHumanLikeSessions30Days?: number;
  topPages: { path: string; views: number }[];
  topCountries?: { country: string; views: number }[];
  topReferrerDomains?: { domain: string; views: number }[];
}

export interface UserProfile {
  id: string;
  username: string | null;
  avatarUrl?: string | null;
  role: string;
  rank: string;
  xpPoints: number;
  predictCredits: number;
  totalVotes: number;
  totalPredictions: number;
  createdAt: string;
  /** Last request timestamp from profiles.last_active_at (nullable for dormant accounts). */
  lastActiveAt?: string | null;
  /** True for V2 simulation agents (`is_agent` on the profile row). */
  isSimAgent?: boolean;
  /** @deprecated Prefer `isSimAgent` — kept for older clients. */
  isAgent?: boolean;
  /** True for the singleton AMM house wallet (`__house__`). */
  isHouse?: boolean;
  /** True for platform infrastructure profiles (`role = system`). */
  isSystem?: boolean;
  isBanned?: boolean;
  /** Wallet vs ledger drift. Present only on rows returned by
   *  /api/admin/credit-drift-users; absent when the regular
   *  /api/admin/users endpoint serves the row. */
  drift?: number;
  /** SUM(credit_ledger.amount) for the user. Present only alongside
   *  `drift`. */
  ledgerSum?: number;
}

/** Default page size for admin user list endpoints. */
export const ADMIN_USERS_PAGE_SIZE = 50;

export function isInfrastructureUser(
  user: Pick<UserProfile, "role" | "isSystem">,
): boolean {
  return user.isSystem === true || user.role === "system";
}

/** Ban / delete / manual credit adjust — blocked for admins + infrastructure. */
export function canModerateUser(
  user: Pick<UserProfile, "role" | "isSystem">,
): boolean {
  return user.role !== "admin" && !isInfrastructureUser(user);
}

/** Paginated admin user list (`GET /api/admin/users`, drift list). */
export interface AdminUsersListResponse {
  users: UserProfile[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PredictionMarket {
  id: string;
  marketType: string;
  /** Settlement engine. Community + native non-jackpot markets are 'amm'. */
  engine?: "parimutuel" | "amm" | string | null;
  openMarketType: string | null;
  status: string;
  title: string;
  slug: string;
  teaser: string | null;
  summary: string | null;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  coverImageUrl: string | null;
  sourceUrl: string | null;
  featured: boolean | null;
  timezone: string | null;
  resolutionCriteria: string[] | null;
  resolutionSources: { label: string; url?: string }[] | null;
  resolutionNotes: string | null;
  resolveMethod: string | null;
  underlying: string | null;
  metric: string | null;
  strike: string | null;
  unit: string | null;
  closeAt: string | null;
  endAt: string;
  startAt: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  settledBy: string | null;
  resolvedAt: string | null;
  voidReason: string | null;
  rules: string | null;
  metadata: any;
  personId: string | null;
  visibility: string | null;
  isLive: boolean | null;
  inactiveMessage: string | null;
  weekNumber: number | null;
  /** Admin drag-order for World Markets (community); 0 for other market types. */
  cmsDisplayOrder?: number;
}

export interface MarketEntryForm {
  /** Stable key for drag-and-drop and per-entry UI state in admin forms. */
  clientId: string;
  label: string;
  description: string;
  imageUrl: string;
  entryPersonId: string;
  entryPersonName: string;
}

let marketEntryClientIdCounter = 0;

export function createMarketEntry(
  overrides: Partial<Omit<MarketEntryForm, "clientId">> & { clientId?: string } = {},
): MarketEntryForm {
  const { clientId, ...rest } = overrides;
  return {
    clientId:
      clientId ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `entry-${++marketEntryClientIdCounter}-${Date.now()}`),
    label: "",
    description: "",
    imageUrl: "",
    entryPersonId: "",
    entryPersonName: "",
    ...rest,
  };
}

export interface AuditLogEntry {
  id: string;
  adminId: string;
  adminEmail: string;
  actionType: string;
  targetTable: string;
  targetId: string | null;
  previousData: any;
  newData: any;
  metadata: any;
  createdAt: string;
}

export interface Celebrity {
  id: string;
  name: string;
  category: string;
  secondaryCategories?: string[] | null;
  status: string;
  avatar: string | null;
  imageSlug?: string | null;
  wikiSlug: string | null;
  xHandle: string | null;
  instagramHandle: string | null;
  tiktokHandle: string | null;
  youtubeId: string | null;
  spotifyId: string | null;
  searchQueryOverride: string | null;
  googleTrendsTopicId: string | null;
  displayOrder: number;
}

export const EMPTY_CELEBRITY_FORM = {
  name: "",
  category: "Tech",
  secondaryCategories: [] as string[],
  status: "main_leaderboard",
  wikiSlug: "",
  xHandle: "",
  instagramHandle: "",
  tiktokHandle: "",
  youtubeId: "",
  spotifyId: "",
  searchQueryOverride: "",
  googleTrendsTopicId: "",
};

export type SeedRatingKey = "1" | "2" | "3" | "4" | "5";
export type SeedApprovalCounts = Record<SeedRatingKey, number>;

export const DEFAULT_SEED_APPROVAL_COUNTS: SeedApprovalCounts = {
  "1": 0,
  "2": 0,
  "3": 0,
  "4": 0,
  "5": 0,
};

export interface Matchup {
  id: string;
  title: string;
  category: string;
  optionAText: string;
  optionAImage: string | null;
  optionBText: string;
  optionBImage: string | null;
  promptText: string | null;
  isActive: boolean;
  visibility: string;
  featured: boolean;
  slug: string | null;
  personAId: string | null;
  personBId: string | null;
  displayOrder: number;
  seedVotesA: number;
  seedVotesB: number;
  createdAt: string;
}

export interface CommunityInsight {
  id: string;
  personId: string;
  userId: string;
  content: string;
  createdAt: string;
  upvotes: number;
  downvotes: number;
}

/**
 * Comment shape served by /api/admin/moderation/comments. Renamed from
 * InsightComment because it now spans every parent surface (matchups,
 * polls, world markets, community insights), not just insights. The
 * `insightId` field is preserved for backwards compatibility.
 */
export interface InsightComment {
  id: string;
  /** Polymorphic parent type. */
  parentType: "matchup" | "trending_poll" | "opinion_poll" | "open_market" | "community_insight" | "voices_post";
  parentId: string;
  parentCommentId: string | null;
  /** Friendly title resolved from the parent table. */
  parentTitle: string | null;
  /** Frontend route to view the parent in context (or null if unresolvable). */
  parentLink: string | null;
  /** Parent category (sports, music, etc.) if applicable. */
  parentCategory: string | null;
  /**
   * Backwards-compat: set when parentType === 'community_insight'.
   * Equals this row's comment id (the profile post / reply id), not the
   * personId — personId is parentId after the insights→comments merge.
   */
  insightId: string | null;
  userId: string;
  /** Author username, or "[deleted user]" if profile is missing. */
  username: string | null;
  avatarUrl: string | null;
  /** Whether the author is a simulated agent. Surfaced as a badge. */
  isAgent: boolean;
  /** Link to the author's public profile, null when deleted. */
  authorLink: string | null;
  body: string;
  /** Backwards-compat alias for body. */
  content: string;
  createdAt: string;
}

export interface ScoreBreakdownData {
  celebrity: {
    id: string;
    name: string;
    category: string;
    avatar: string | null;
  };
  snapshotTimestamp: string;
  rawInputs: {
    wikiPageviews: number;
    newsCount: number;
    searchVolume: number;
  };
  baselines: {
    wiki: number;
    news: number;
    search: number;
  };
  normalizedPercentiles: {
    wiki: number;
    news: number;
    search: number;
  };
  spikeStatus: {
    wiki: boolean;
    news: boolean;
    search: boolean;
  };
  scoreBreakdown: {
    massScore: number;
    velocityScore: number;
    trendScore: number;
    fameIndex: number;
    momentum: string;
    drivers: string[];
  };
  weights: {
    mass: number;
    velocity: number;
    velocityBreakdown: {
      wiki: number;
      news: number;
      search: number;
      x: number;
    };
  };
  populationStats: {
    wiki: { min: number; max: number; p25: number; p50: number; p75: number; p90: number; mean: number; count: number };
    news: { min: number; max: number; p25: number; p50: number; p75: number; p90: number; mean: number; count: number };
    search: { min: number; max: number; p25: number; p50: number; p75: number; p90: number; mean: number; count: number };
  };
  historicalSnapshots: Array<{
    timestamp: string;
    fameIndex: number;
    trendScore: number;
    wikiPageviews: number;
    newsCount: number;
    searchVolume: number;
  }>;
  previousHourComparison: {
    previousFameIndex: number;
    rawFameIndexBeforeStabilization: number;
    currentFameIndex: number;
    rawChangePercent: number;
    finalChangePercent: number;
    wasRateLimited: boolean;
    previousRank: number;
    currentRank: number;
  } | null;
  sourceFreshness: {
    wiki: { lastUpdated: string; value: number; isStale: boolean };
    news: { lastUpdated: string; value: number; isStale: boolean };
    search: { lastUpdated: string; value: number; isStale: boolean };
  };
  currentRank: number;
}
