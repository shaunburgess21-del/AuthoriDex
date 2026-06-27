import type { InsightsSource, InsightsWindow } from "./filters";

export type MomentumLevel = "none" | "low" | "medium" | "high";

export type InsightsPrimaryDriver =
  | "NEWS"
  | "WIKI"
  | "SEARCH"
  | "MIXED";

export interface InsightsMomentumLens {
  ratio: number | null;
  level: MomentumLevel;
}

export interface InsightsRankingRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  /** Board rank — the person's position on the main leaderboard (Trend Score). */
  rank: number;
  fameIndex: number;
  velocityScore: number;
  massScore: number;
  newsMomentum: InsightsMomentumLens;
  wikiMomentum: InsightsMomentumLens;
  primaryDriver: InsightsPrimaryDriver;
  breakdownPct: Record<string, number> | null;
  change24h: number | null;
  change7d: number | null;
  /** Value used for sort (window- and source-aware). */
  sortValue: number;
  /** Signed % delta shown in the trailing column (window-aware; MoM for search). */
  metricDelta: number | null;
  /**
   * Origin of `metricDelta` — UI uses this to render the column header
   * ("24H" / "7D" / "MoM").
   */
  metricDeltaKind: "change24h" | "change7d" | "mom";
  /**
   * Hint for the metric column: `"weekly_estimate"` when the value is
   * `dailyAvg × 7` (News only). UI shows a small "(est.)" suffix + tooltip.
   */
  metricKind?: "raw" | "weekly_estimate" | "weekly_sum" | "monthly";
}

export interface InsightsRankingsResponse {
  rows: InsightsRankingRow[];
  total: number;
  asOf: string | null;
  source: InsightsSource;
}

export interface InsightsQuadrantPoint {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  fameIndex: number;
  approvalPct: number;
  approvalAvgRating: number | null;
  approvalVotesCount: number;
  quadrant: "beloved_giants" | "hated_giants" | "cult_favourites" | "unknown_critics";
}

export interface InsightsDriverMixSegment {
  driver: InsightsPrimaryDriver;
  pct: number;
  sampleIds: string[];
}

export interface InsightsMoverItem {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  fameIndex: number | null;
  change24h: number | null;
  change7d: number | null;
  rankChange: number | null;
}

export interface InsightsStoryPayload {
  headline: string;
  body: string;
  /** Multi-paragraph editorial; preferred over `body` when present. */
  paragraphs?: string[];
  /** Names to linkify in the briefing copy. */
  people?: Array<{ id: string; name: string }>;
  generatedAt: string;
  refreshesAt: string;
  mode: "deterministic" | "ai";
}

export interface InsightsFavouriteHighlight {
  personId: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  change24h: number;
  primaryDriver: InsightsPrimaryDriver | null;
}

export interface InsightsFavouritesSignals {
  summary: string;
  favouriteCount: number;
  highlights: InsightsFavouriteHighlight[];
  newsDrivenCount: number;
  top50CrossedCount: number;
  /** Live native markets (h2h/updown) referencing at least one favourite. */
  pendingMarketsCount: number;
  /** Live opinion polls + matchups + trending polls referencing favourites. */
  pendingPollsCount: number;
}

export interface InsightsOverviewResponse {
  quadrantPoints: InsightsQuadrantPoint[];
  quadrantMeta: {
    includedCount: number;
    totalEligible: number;
    medianFame: number;
    medianApproval: number;
    minVotes: number;
  };
  driverMix: {
    topN: number;
    segments: InsightsDriverMixSegment[];
  };
  movers: Record<
    InsightsWindow,
    { climbers: InsightsMoverItem[]; droppers: InsightsMoverItem[] }
  >;
  /** Live #1 on the main leaderboard (for Today's Briefing board headline). */
  boardLeader: { id: string; name: string } | null;
  story: InsightsStoryPayload;
  favouritesSignals?: InsightsFavouritesSignals;
}

export type InsightsDivergenceType =
  | "rising_disliked"
  | "underrated_gaining"
  | "overrated_cooling"
  | "consensus"
  | "press_loved_crowd_cool"
  | "crowd_loved_press_critical"
  | "underrated"
  | "overrated";

export interface InsightsDiscoverRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  fameIndex: number;
  approvalPct: number | null;
  approvalPercentile: number | null;
  change7d: number | null;
  velocityScore: number;
  underratedPct: number | null;
  overratedPct: number | null;
  fairlyRatedPct: number | null;
  highlight: string;
  /** Press vs crowd divergence — optional; populated for sentiment types only. */
  webSentimentPositivePct?: number | null;
  webSentimentPositive?: number;
  webSentimentNegative?: number;
  webSentimentNeutral?: number;
  /** Signed: web positive % minus crowd approval %. */
  sentimentApprovalGap?: number | null;
}

export interface InsightsSingleSourceSurgeRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  surgeSource: "news" | "wiki" | "search";
  levels: {
    news: MomentumLevel;
    wiki: MomentumLevel;
    search: MomentumLevel;
  };
}

export interface InsightsEventPayload {
  surface: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface MarketsCalibrationBucket {
  label: string;
  predictedMid: number;
  count: number;
  actualWinRate: number;
  avgBrier: number;
}

export interface MarketsCalibrationBlock {
  buckets: MarketsCalibrationBucket[];
  totalSettled: number;
  excludedNoPrice: number;
}

export interface ContestedMarketPair {
  label: string;
  pct: number;
}

export interface ContestedMarket {
  marketId: string;
  slug: string;
  title: string;
  marketType: string;
  engine: "amm" | "parimutuel";
  score: number;
  topPair: ContestedMarketPair[];
  /** World Markets cover art — avoids relying on volume-ranked open-markets list. */
  coverImageUrl?: string | null;
}

export interface ContestedMarketsBlock {
  amm: ContestedMarket[];
  parimutuel: ContestedMarket[];
}

export interface OpenInterestRow {
  key: string;
  label: string;
  total: number;
  marketCount: number;
}

export interface OpenInterestBlock {
  total: number;
  byMarketType: OpenInterestRow[];
  byCategory: OpenInterestRow[];
}

export interface InsightsMarketsAnalytics {
  calibration: MarketsCalibrationBlock;
  contested: ContestedMarketsBlock;
  openInterest: OpenInterestBlock;
}

export interface MarketMover {
  marketId: string;
  slug: string;
  title: string;
  marketType: string;
  entryLabel: string;
  pctNow: number;
  pctPrev: number;
  deltaPts: number;
  direction: "up" | "down";
}

export interface PredictorDemographicRow {
  key: string;
  label: string;
  predictors: number;
  bets: number;
  totalStaked: number;
}

export interface PredictorDemographics {
  predictorCount: number;
  countryCount: number;
  totalBets: number;
  totalStaked: number;
  byCountry: PredictorDemographicRow[];
  byGender: PredictorDemographicRow[];
}

/** Thumbnail participant for vote insights tiles (polls, matchups). */
export interface PolarisationParticipant {
  name: string;
  avatar: string | null;
}

export interface PolarisationItem {
  id: string;
  slug: string | null;
  title: string;
  kind: "opinion_poll" | "face_off";
  maxPct: number;
  spreadStddev: number | null;
  totalVotes: number;
  label: string;
  imageUrl?: string | null;
  leaderLabel?: string | null;
  leaderPct?: number | null;
  leaderImageUrl?: string | null;
  optionCount?: number | null;
  participants?: PolarisationParticipant[];
  optionAPct?: number | null;
  optionBPct?: number | null;
  optionAVotes?: number | null;
  optionBVotes?: number | null;
  neutralVotes?: number | null;
  neutralPct?: number | null;
  runnerUpLabel?: string | null;
  runnerUpPct?: number | null;
}

export interface PolarisationKindLists {
  lopsided: PolarisationItem[];
  evenlySplit: PolarisationItem[];
}

export interface PolarisationResponse {
  lopsided: PolarisationItem[];
  evenlySplit: PolarisationItem[];
  polls: PolarisationKindLists;
  faceOffs: PolarisationKindLists;
}

export interface InsightsTrendingPollRow {
  id: string;
  headline: string;
  slug: string | null;
  category: string | null;
  totalVotes: number;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
  personName: string | null;
  personAvatar: string | null;
  /** Poll topic image when no linked person (same field as main Vote page). */
  imageUrl?: string | null;
}

export interface InsightsApprovalPersonRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  approvalAvgRating: number;
  approvalVotesCount: number;
}

export interface TopVotePoll {
  id: string;
  slug: string | null;
  title: string;
  totalVotes: number;
  optionCount: number;
  imageUrl: string | null;
  leaderLabel: string | null;
  leaderPct: number | null;
  leaderImageUrl: string | null;
  runnerUpLabel?: string | null;
  runnerUpPct?: number | null;
}

export interface TopVoteMatchup {
  id: string;
  slug: string | null;
  title: string;
  totalVotes: number;
  optionAPct: number;
  optionBPct: number;
  neutralPct?: number;
  optionAVotes?: number;
  optionBVotes?: number;
  neutralVotes?: number;
  participants: PolarisationParticipant[];
}

export interface TopVotedResponse {
  polls: TopVotePoll[];
  matchups: TopVoteMatchup[];
}
