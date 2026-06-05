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
  sortValue: number;
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
  story: InsightsStoryPayload;
  favouritesSignals?: InsightsFavouritesSignals;
}

export type InsightsDivergenceType =
  | "rising_disliked"
  | "underrated_gaining"
  | "overrated_cooling"
  | "consensus"
  | "press_loved_crowd_cool"
  | "crowd_loved_press_critical";

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
