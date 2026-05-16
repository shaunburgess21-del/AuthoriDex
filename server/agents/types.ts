// No imports from other agent files. No external dependencies.
// Adapted to AuthoriDex's actual schema (prediction_markets, market_entries, market_bets).

export interface AgentConfigData {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  bio: string;
  archetype: string;
  specialties: string[];
  boldness: number;
  contrarianism: number;
  recencyWeight: number;
  prestigeBias: number;
  confidenceCal: number;
  riskAppetite: number;
  consensusSensitivity: number;
  activityRate: number;
  simulationProfile?: unknown;
  isActive: boolean;
}

export interface MarketWithEntries {
  id: string;
  marketType: string;
  openMarketType?: string | null;
  status: string;
  title: string;
  category: string | null;
  personId: string | null;
  endAt: Date | null;
  teaser?: string | null;
  resolutionCriteria?: string[] | null;
  metadata?: unknown;
  entries: MarketEntryData[];
}

export interface MarketEntryData {
  id: string;
  label: string | null;
  totalStake: number;
  noStake?: number;
  personId?: string | null;
}

export interface TrendSignals {
  trendScore: number;
  fameIndex: number;
  scoreBaseline: number;
  scoreDelta7d: number;
  /**
   * Multi-window momentum — populated for sharp-band agents only (extra DB
   * query per market). Used to detect trend reversals (e.g. 7d falling but
   * 30d still rising = mean-reversion candidate) which the single-window
   * delta can't see.
   */
  scoreDelta14d?: number;
  scoreDelta30d?: number;
  /**
   * Signed fractional change vs. THIS market's opening score:
   *   pctChangeVsOpen = (fameIndex − openingScore) / openingScore
   *
   * Available only when the agent runner passes `openingScore` into
   * `getTrendSignals` — i.e. for binary up/down per-person markets that
   * carry `metadata.openingScore.score`. Jackpots, H2H per-entry signals,
   * and community markets leave this undefined.
   *
   * Why this exists separately from `scoreDelta7d`: the 7-day rolling
   * delta is a momentum signal, not a "vs. baseline" signal. A market
   * that opened on Monday and closes on Friday cares about the move
   * since Monday, which may differ materially from the trailing 7d.
   * This field is the primary input to `computeSignalBoost` when present
   * (saturates at ±0.20 with a stronger coefficient than the 7d fallback).
   */
  pctChangeVsOpen?: number;
  wikiPulse: "rising" | "falling" | "stable";
  newsLevel: "red" | "amber" | "green";
}

export interface CrowdSplit {
  [entryId: string]: number;
}

export interface PredictionDecision {
  abstain: boolean;
  abstainReason?: "domain" | "activity_gate" | "low_edge" | "random" | "world_abstain" | "api_error";
  entryId?: string;
  // Yes = agent thinks the outcome WILL happen (back the entry).
  // No  = agent thinks the outcome WILL NOT happen (short the entry).
  // Defaults to "yes" when omitted to preserve legacy behaviour.
  direction?: "yes" | "no";
  rawProbability?: number;
  confidence?: number;
  impliedProbability?: number;
  edge?: number;
  source?: "deterministic" | "gpt-5.4-world";
  reasoning?: string;
  predictedScore?: number;
}

export interface ScheduledActionData {
  agentId: string;
  marketId: string;
  entryId: string;
  actionType: "predict" | "jackpot_bet" | "conviction";
  decisionPayload: PredictionDecision;
  stakeAmount: number;
  executeAfter: Date;
}

export interface AgentMemoryData {
  memoryType: "strength" | "weakness" | "recent_outcome" | "self_note";
  content: string;
  category?: string;
}
