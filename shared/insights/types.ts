import type { InsightsSource } from "./filters";

export type MomentumLevel = "none" | "low" | "medium" | "high";

export type InsightsPrimaryDriver =
  | "NEWS"
  | "WIKI"
  | "TRENDS"
  | "VELOCITY"
  | "MASS"
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
  trendsLevel: MomentumLevel;
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
  generatedAt: string;
  refreshesAt: string;
  mode: "deterministic" | "ai";
}

export interface InsightsFavouritesSignals {
  summary: string;
  highlights: Array<{
    personId: string;
    name: string;
    message: string;
  }>;
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
  movers: {
    climbers: InsightsMoverItem[];
    droppers: InsightsMoverItem[];
  };
  story: InsightsStoryPayload;
  favouritesSignals?: InsightsFavouritesSignals;
}

export type InsightsDivergenceType =
  | "rising_disliked"
  | "underrated_gaining"
  | "overrated_cooling"
  | "consensus";

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
}

export interface InsightsSingleSourceSurgeRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  surgeSource: "news" | "wiki" | "trends";
  levels: {
    news: MomentumLevel;
    wiki: MomentumLevel;
    trends: MomentumLevel;
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
