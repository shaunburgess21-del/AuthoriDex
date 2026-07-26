/**
 * Arb / market-maker cohort — pure mandate toward lock-in fair value.
 */

import type {
  AgentConfigData,
  MarketWithEntries,
  TrendSignals,
  PredictionDecision,
} from "./types";
import {
  POSITIVE_HINTS,
  NEGATIVE_HINTS,
  ARB_MIN_EDGE_PP,
  isArbCohortEnabled,
  isLockInFairH2HEnabled,
  isLockInFairGainerEnabled,
  LOCKIN_H2H_SIGMA_1D,
  LOCKIN_H2H_BETA,
  LOCKIN_GAINER_SIGMA_1D,
  LOCKIN_GAINER_BETA,
} from "./constants";
import {
  computeLockInFairUp,
  fairForEntry,
  fairH2HByEntryId,
  fairGainerByEntryId,
  favoredH2HFromFairMap,
  LOCKIN_FAIR_MAX,
  LOCKIN_DECISIVE_PCT,
} from "./lockInFair";
import type { MarketEntryData } from "./types";
import { getSimulationProfile } from "./simulationProfile";

export function isArbAgent(agent: AgentConfigData): boolean {
  if (!isArbCohortEnabled()) return false;
  return getSimulationProfile(agent.simulationProfile).personaBand === "arb";
}

export interface ArbPredictionOptions {
  minEdgePp?: number;
  /**
   * Convergence mode: buy whichever side is most underpriced vs its fair —
   * including the unfavored side (e.g. Down at 0.01 when fair Down is 0.35).
   * The legacy favored-side-only path cannot correct overpriced favorites.
   */
  allowUnfavoredSide?: boolean;
  /**
   * Override the |pctChangeVsOpen| decisive gate. The near-close arb keeps
   * LOCKIN_DECISIVE_PCT; the midweek sweep passes a lower bar so mispriced
   * near-flat markets (score reverted after an early pile-on) are tradeable —
   * the edge bar remains the real safety control.
   */
  decisivePct?: number;
}

export function computeArbPrediction(
  market: MarketWithEntries,
  signals: TrendSignals,
  hoursRemaining: number,
  currentPrices: Record<string, number>,
  options?: ArbPredictionOptions,
): PredictionDecision {
  const abstain = (
    reason: PredictionDecision["abstainReason"],
  ): PredictionDecision => ({ abstain: true, abstainReason: reason });

  const entries = market.entries;
  if (market.marketType !== "updown" || entries.length !== 2) {
    return abstain("low_edge");
  }

  const pct = signals.pctChangeVsOpen;
  const decisivePct = options?.decisivePct ?? LOCKIN_DECISIVE_PCT;
  if (pct == null || Math.abs(pct) < decisivePct) {
    return abstain("low_edge");
  }

  const fairUp = computeLockInFairUp(pct, hoursRemaining);
  if (fairUp == null) return abstain("low_edge");

  const minEdgePp = options?.minEdgePp ?? ARB_MIN_EDGE_PP;

  let chosen = entries[0];
  let fairSide =
    fairForEntry(fairUp, chosen.label, POSITIVE_HINTS, NEGATIVE_HINTS) ?? 0.5;

  if (options?.allowUnfavoredSide) {
    let bestEdge = -Infinity;
    for (const entry of entries) {
      const f = fairForEntry(fairUp, entry.label, POSITIVE_HINTS, NEGATIVE_HINTS);
      if (f == null) continue;
      const edge = f - (currentPrices[entry.id] ?? 0.5);
      if (edge > bestEdge) {
        bestEdge = edge;
        chosen = entry;
        fairSide = f;
      }
    }
    if (bestEdge < minEdgePp) {
      return abstain("low_edge");
    }
  } else {
    for (const entry of entries) {
      const f = fairForEntry(fairUp, entry.label, POSITIVE_HINTS, NEGATIVE_HINTS);
      if (f != null && f > fairSide) {
        chosen = entry;
        fairSide = f;
      }
    }

    const cur = currentPrices[chosen.id] ?? 0.5;
    if (fairSide - cur < minEdgePp) {
      return abstain("low_edge");
    }
  }

  return {
    abstain: false,
    entryId: chosen.id,
    direction: "yes",
    confidence: Math.min(LOCKIN_FAIR_MAX, fairSide),
    source: "deterministic",
  };
}

/**
 * H2H arb — buy favored entry when live price is below lock-in fair by ARB_MIN_EDGE_PP.
 */
export function computeArbPredictionH2H(
  entries: MarketEntryData[],
  scoreByEntryId: Record<string, number>,
  hoursRemaining: number,
  currentPrices: Record<string, number>,
): PredictionDecision {
  const abstain = (
    reason: PredictionDecision["abstainReason"],
  ): PredictionDecision => ({ abstain: true, abstainReason: reason });

  if (!isLockInFairH2HEnabled()) return abstain("low_edge");
  if (entries.length !== 2) return abstain("low_edge");

  const [eA, eB] = entries;
  const scoreA = scoreByEntryId[eA.id];
  const scoreB = scoreByEntryId[eB.id];
  if (
    scoreA == null ||
    !Number.isFinite(scoreA) ||
    scoreB == null ||
    !Number.isFinite(scoreB)
  ) {
    return abstain("low_edge");
  }

  const fairMap = fairH2HByEntryId(
    eA.id,
    scoreA,
    eB.id,
    scoreB,
    hoursRemaining,
    LOCKIN_H2H_SIGMA_1D,
    LOCKIN_H2H_BETA,
  );
  const favored = favoredH2HFromFairMap(fairMap);
  if (!favored) return abstain("low_edge");

  const cur = currentPrices[favored.entryId] ?? 0.5;
  if (favored.fair - cur < ARB_MIN_EDGE_PP) {
    return abstain("low_edge");
  }

  return {
    abstain: false,
    entryId: favored.entryId,
    direction: "yes",
    confidence: Math.min(LOCKIN_FAIR_MAX, favored.fair),
    source: "deterministic",
  };
}

/**
 * Community (World Market) arb — converge AMM prices toward the scouted
 * source anchor (`readSourceFairByEntryId`). N-way max-edge buy: whichever
 * entry is most underpriced vs its source fair gets bought, including
 * unfavored sides (mirrors the mid-week `allowUnfavoredSide` semantics —
 * an overpriced favorite is corrected by buying the underpriced rest).
 * No decisive gate: the external consensus IS the signal; the edge bar
 * (`COMMUNITY_ARB_MIN_EDGE_PP`, deliberately above the native 4pp) is the
 * safety control. Caller owns the flag gating (shadow vs enabled).
 */
export function computeArbPredictionCommunity(
  entries: MarketEntryData[],
  fairByEntryId: Record<string, number>,
  currentPrices: Record<string, number>,
  options?: { minEdgePp?: number },
): PredictionDecision {
  const abstain = (
    reason: PredictionDecision["abstainReason"],
  ): PredictionDecision => ({ abstain: true, abstainReason: reason });

  if (entries.length < 2) return abstain("low_edge");

  const minEdgePp = options?.minEdgePp ?? ARB_MIN_EDGE_PP;

  let chosen: MarketEntryData | null = null;
  let chosenFair = 0;
  let bestEdge = -Infinity;
  for (const entry of entries) {
    const fair = fairByEntryId[entry.id];
    if (fair == null || !Number.isFinite(fair)) continue;
    const edge = fair - (currentPrices[entry.id] ?? 1 / entries.length);
    if (edge > bestEdge) {
      bestEdge = edge;
      chosen = entry;
      chosenFair = fair;
    }
  }

  if (!chosen || bestEdge < minEdgePp) {
    return abstain("low_edge");
  }

  return {
    abstain: false,
    entryId: chosen.id,
    direction: "yes",
    confidence: Math.min(LOCKIN_FAIR_MAX, chosenFair),
    edge: bestEdge,
    source: "deterministic",
  };
}

/**
 * Gainer arb — buy favored entry when live price is below lock-in fair by minEdgePp.
 */
export function computeArbPredictionGainer(
  entries: MarketEntryData[],
  pctByEntryId: Record<string, number | null | undefined>,
  hoursRemaining: number,
  currentPrices: Record<string, number>,
  options?: { minEdgePp?: number; allowUnfavoredSide?: boolean },
): PredictionDecision {
  const abstain = (
    reason: PredictionDecision["abstainReason"],
  ): PredictionDecision => ({ abstain: true, abstainReason: reason });

  if (!isLockInFairGainerEnabled()) return abstain("low_edge");
  if (entries.length < 2) return abstain("low_edge");

  const minEdgePp = options?.minEdgePp ?? ARB_MIN_EDGE_PP;

  const fairMap = fairGainerByEntryId(
    pctByEntryId,
    hoursRemaining,
    LOCKIN_GAINER_SIGMA_1D,
    LOCKIN_GAINER_BETA,
  );

  if (options?.allowUnfavoredSide) {
    let chosen: MarketEntryData | null = null;
    let chosenFair = 0;
    let bestEdge = -Infinity;
    for (const entry of entries) {
      const f = fairMap[entry.id];
      if (f == null || !Number.isFinite(f)) continue;
      const cur = currentPrices[entry.id] ?? 1 / entries.length;
      const edge = f - cur;
      if (edge > bestEdge) {
        bestEdge = edge;
        chosen = entry;
        chosenFair = f;
      }
    }
    if (!chosen || bestEdge < minEdgePp) {
      return abstain("low_edge");
    }
    return {
      abstain: false,
      entryId: chosen.id,
      direction: "yes",
      confidence: Math.min(LOCKIN_FAIR_MAX, chosenFair),
      source: "deterministic",
    };
  }

  const favored = favoredH2HFromFairMap(fairMap);
  if (!favored) return abstain("low_edge");

  const cur = currentPrices[favored.entryId] ?? 1 / entries.length;
  if (favored.fair - cur < minEdgePp) {
    return abstain("low_edge");
  }

  return {
    abstain: false,
    entryId: favored.entryId,
    direction: "yes",
    confidence: Math.min(LOCKIN_FAIR_MAX, favored.fair),
    source: "deterministic",
  };
}

export interface ArbLockCandidatePick {
  /** Index into the cohort array, or null when every candidate is blocked. */
  index: number | null;
  /** Lifetime lock blocked the candidate but its actions all predate today. */
  wouldUnlock: boolean;
}

/**
 * Candidate walk for the near-close convergence sweeps' per-agent-per-market
 * lock (see pickUnblockedArbAgent in agentRunner). Pure so it can be unit
 * tested without a database.
 *
 * `lockedTodayByAgent`: agentId → true when the agent already has a live
 * action (pending/in_progress/executed) on the market today, false when all
 * of its actions predate today, absent when it has none at all.
 *
 * Day scope off (legacy lifetime lock): only the round-robin candidate at
 * `startIdx` is considered, and any existing action blocks it. `wouldUnlock`
 * reports when a day-scoped lock would have let that candidate through, so
 * ARB_NEARCLOSE_DAILY_LOCK_SHADOW can size the change before it goes live.
 *
 * Day scope on: walks the cohort from `startIdx` and returns the first agent
 * without an action today — bounded at one action per agent per market per day.
 */
export function pickArbAgentIndexFromLocks(
  agentIds: string[],
  startIdx: number,
  lockedTodayByAgent: ReadonlyMap<string, boolean>,
  dayScoped: boolean,
): ArbLockCandidatePick {
  if (agentIds.length === 0) return { index: null, wouldUnlock: false };

  const attempts = dayScoped ? agentIds.length : 1;
  let wouldUnlock = false;

  for (let i = 0; i < attempts; i++) {
    const idx = (startIdx + i) % agentIds.length;
    const lockedToday = lockedTodayByAgent.get(agentIds[idx]!);
    if (lockedToday === undefined) return { index: idx, wouldUnlock: false };
    if (!lockedToday) {
      if (dayScoped) return { index: idx, wouldUnlock: false };
      wouldUnlock = true;
    }
  }

  return { index: null, wouldUnlock };
}
