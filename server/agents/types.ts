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
  isActive: boolean;
}

export interface MarketWithEntries {
  id: string;
  marketType: string;
  status: string;
  title: string;
  category: string | null;
  personId: string | null;
  endAt: Date | null;
  entries: MarketEntryData[];
}

export interface MarketEntryData {
  id: string;
  label: string | null;
  totalStake: number;
  personId?: string | null;
}

export interface TrendSignals {
  trendScore: number;
  fameIndex: number;
  scoreBaseline: number;
  scoreDelta7d: number;
  wikiPulse: "rising" | "falling" | "stable";
  newsLevel: "red" | "amber" | "green";
}

export interface CrowdSplit {
  [entryId: string]: number;
}

export interface PredictionDecision {
  abstain: boolean;
  abstainReason?: "domain" | "activity_gate" | "low_edge" | "random";
  entryId?: string;
  rawProbability?: number;
  confidence?: number;
}

export interface ScheduledActionData {
  agentId: string;
  marketId: string;
  entryId: string;
  actionType: "predict";
  decisionPayload: PredictionDecision;
  stakeAmount: number;
  executeAfter: Date;
}

export interface AgentMemoryData {
  memoryType: "strength" | "weakness" | "recent_outcome" | "self_note";
  content: string;
  category?: string;
}
