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
} from "./constants";
import {
  computeLockInFairUp,
  fairForEntry,
  LOCKIN_FAIR_MAX,
  LOCKIN_DECISIVE_PCT,
} from "./lockInFair";
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
