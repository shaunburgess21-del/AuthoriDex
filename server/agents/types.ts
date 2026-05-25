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
  createdAt?: Date | null;
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

/**
 * Trend direction for a tracked person — derived signal, NOT a column in the
 * DB. `getTrendSignals` collapses several noisier inputs (pctChangeVsOpen,
 * change24h, change7d, snapshot momentum label) into one of three buckets so
 * the deterministic decision engine can apply an explicit tilt without
 * having to re-derive direction from scratch on every call.
 *
 * Conservative on purpose: we only emit UP / DOWN when the underlying
 * signals agree. Otherwise FLAT, and the existing fame / crowd / persona
 * logic decides — same as before this field existed.
 */
export type TrendDirection = "UP" | "DOWN" | "FLAT";

/**
 * Stored momentum label from the latest `trend_snapshots` row. Free-text in
 * the schema (`text("momentum").default("Stable")`); we narrow it to the
 * five possibilities the scoring job actually emits, with `"Unknown"` as
 * the fallback when no snapshot is present.
 */
export type TrendMomentum = "Breakout" | "Sustained" | "Cooling" | "Stable" | "Unknown";

export interface TrendSignals {
  trendScore: number;
  fameIndex: number;
  scoreBaseline: number;
  scoreDelta7d: number;
  /**
   * Short-window delta from `trending_people.change_24h` (the same column
   * the leaderboard "24h change" arrows render off). Surfaced separately
   * from the 7d delta so direction-derivation can require BOTH windows
   * to agree before tilting — single-window noise alone shouldn't move
   * an agent off the fence.
   */
  change24h: number;
  /**
   * Latest `trend_snapshots.momentum` label (or `"Unknown"` if no snapshot
   * row exists for this person). Used as a tertiary input to the direction
   * derivation when the deltas don't agree clearly.
   */
  momentum: TrendMomentum;
  /**
   * Collapsed direction signal — see `TrendDirection` doc above.
   * Always populated; `"FLAT"` when nothing else is conclusive.
   *
   * Priority ladder (first match wins):
   *   1. `pctChangeVsOpen` set AND |abs| > 2%   -> sign of pctChangeVsOpen
   *   2. `change24h` |abs| > 0.5 AND `scoreDelta7d` agrees in sign  -> that sign
   *   3. `momentum === "Breakout"` -> UP, `"Cooling"` -> DOWN
   *   4. `"FLAT"`
   */
  trendDirection: TrendDirection;
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
   * Available whenever the agent runner can resolve an opening score for
   * the market context — Up/Down per-person markets carry it as
   * `metadata.openingScore.score`, and (as of the Agent v2 sprint) H2H /
   * Race per-entry calls also populate it via a `trend_snapshots` lookup
   * at-or-just-before market `createdAt`. Jackpots and community markets
   * still leave this undefined.
   *
   * Why this exists separately from `scoreDelta7d`: the 7-day rolling
   * delta is a momentum signal, not a "vs. baseline" signal. A market
   * that opened on Monday and closes on Friday cares about the move
   * since Monday, which may differ materially from the trailing 7d.
   * This field is the primary input to `computeSignalBoost` when present
   * (saturates at ±0.20 with a stronger coefficient than the 7d fallback).
   */
  pctChangeVsOpen?: number;
}

export interface CrowdSplit {
  [entryId: string]: number;
}

export interface PredictionDecision {
  abstain: boolean;
  abstainReason?:
    | "domain"
    | "activity_gate"
    | "low_edge"
    | "random"
    | "no_signal"
    | "world_abstain"
    | "api_error";
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
  /**
   * Sharp-ranker conviction (0..1) for THIS market+side, persisted into
   * `decisionPayload` so the action worker can pass it to `sizeAmmBudget`
   * and widen the edge band on high-conviction trades. Set in
   * `agentRunner` when the LLM ranker has a pick AND the agent's chosen
   * side matches the LLM's. Undefined otherwise — sizing falls back to
   * `DEFAULT_AGENT_EDGE_BAND`.
   */
  rankerConviction?: number;
}

export interface ScheduledActionData {
  agentId: string;
  marketId: string;
  entryId: string;
  actionType: "predict" | "jackpot_bet" | "conviction" | "repredict" | "sell";
  decisionPayload: PredictionDecision | SellDecision;
  stakeAmount: number;
  executeAfter: Date;
}

/**
 * Why a sell candidate fired:
 *   - take_profit  : live price >= bandTop  (profit-zone breach, edge realized)
 *   - cut_loss     : live price <= bandBottom (loss-zone breach, thesis broken)
 *   - early_profit : live price inside band but in the upper half — opportunistic
 *                    partial profit-take (lower probability, smaller fraction).
 *
 * The persona cascade in `sellEngine.computeSellDecision` decides which (if
 * any) of these fires per agent×market×sweep.
 */
export type SellReason =
  | "take_profit"
  | "cut_loss"
  | "early_profit"
  | "score_reversal";

/**
 * Output of `computeSellDecision` — null means "agent does NOT sell this
 * sweep" (most agent×market×sweep combinations). When non-null, downstream
 * code reads `sellFraction` to derive `sharesToSell = netShares × fraction`
 * (clamped) and persists the rest of the fields into the scheduled-action
 * `decisionPayload` for the worker.
 *
 * Mirrors `PredictionDecision` rather than reusing it because the shape is
 * fundamentally different: predictions pick AN ENTRY at a confidence;
 * sells already KNOW the entry (from the agent's existing position) and
 * only need to decide whether and how much to exit.
 */
export interface SellDecision {
  reason: SellReason;
  /**
   * Fractional share count to sell (0..1 of the agent's net position on
   * this entry). Tuned per persona band — sharps usually clean-exit
   * (0.85-1.0), casuals often take partials (0.30-0.70). The action
   * worker is the one that applies this to live netShares so any
   * intervening human/agent activity since scheduling reduces the sell
   * proportionally rather than overflowing.
   */
  sellFraction: number;
  /**
   * Agent's anchor (weighted-average buy price) at decision time. Stored
   * for telemetry / explainability — agent reads this in the future
   * "show me my exit P&L" admin tile.
   */
  anchor: number;
  /** Live AMM price at decision time. */
  livePrice: number;
  /** Top edge of conviction band (anchor + topRadius). */
  bandTop: number;
  /** Bottom edge of conviction band (anchor - bottomRadius). */
  bandBottom: number;
  /**
   * Conviction (0..1) used to derive band width. Pulled from the original
   * buy's decision payload when available, otherwise defaulted to 0.5
   * (widest band). Persisted so we can correlate later: did high-conviction
   * positions exit cleaner than low-conviction ones?
   */
  conviction: number;
  /** Persona band that drove the cascade — for log readability. */
  personaBand: string;
}

export interface AgentMemoryData {
  memoryType: "strength" | "weakness" | "recent_outcome" | "self_note";
  content: string;
  category?: string;
}
