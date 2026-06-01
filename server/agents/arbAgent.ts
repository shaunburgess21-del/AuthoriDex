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
  ARB_COHORT_ENABLED,
  isLockInFairH2HEnabled,
  LOCKIN_H2H_SIGMA_1D,
  LOCKIN_H2H_BETA,
} from "./constants";
import {
  computeLockInFairUp,
  fairForEntry,
  fairH2HByEntryId,
  favoredH2HFromFairMap,
  LOCKIN_FAIR_MAX,
  LOCKIN_DECISIVE_PCT,
} from "./lockInFair";
import type { MarketEntryData } from "./types";
import { getSimulationProfile } from "./simulationProfile";

export function isArbAgent(agent: AgentConfigData): boolean {
  if (!ARB_COHORT_ENABLED) return false;
  return getSimulationProfile(agent.simulationProfile).personaBand === "arb";
}

export function computeArbPrediction(
  market: MarketWithEntries,
  signals: TrendSignals,
  hoursRemaining: number,
  currentPrices: Record<string, number>,
): PredictionDecision {
  const abstain = (
    reason: PredictionDecision["abstainReason"],
  ): PredictionDecision => ({ abstain: true, abstainReason: reason });

  const entries = market.entries;
  if (market.marketType !== "updown" || entries.length !== 2) {
    return abstain("low_edge");
  }

  const pct = signals.pctChangeVsOpen;
  if (pct == null || Math.abs(pct) < LOCKIN_DECISIVE_PCT) {
    return abstain("low_edge");
  }

  const fairUp = computeLockInFairUp(pct, hoursRemaining);
  if (fairUp == null) return abstain("low_edge");

  let chosen = entries[0];
  let fairSide =
    fairForEntry(fairUp, chosen.label, POSITIVE_HINTS, NEGATIVE_HINTS) ?? 0.5;

  for (const entry of entries) {
    const f = fairForEntry(fairUp, entry.label, POSITIVE_HINTS, NEGATIVE_HINTS);
    if (f != null && f > fairSide) {
      chosen = entry;
      fairSide = f;
    }
  }

  const cur = currentPrices[chosen.id] ?? 0.5;
  if (fairSide - cur < ARB_MIN_EDGE_PP) {
    return abstain("low_edge");
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
