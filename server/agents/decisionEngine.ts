/**
 * Pure deterministic decision engine. Zero DB, LLM, or network imports.
 * Accepts optional RNG parameter for deterministic testing.
 * Works with N entries via MarketEntryData[] — never assumes binary up/down.
 */

import type {
  AgentConfigData,
  MarketWithEntries,
  TrendSignals,
  CrowdSplit,
  PredictionDecision,
} from "./types";
import {
  POSITIVE_HINTS,
  NEGATIVE_HINTS,
  CONTRARIAN_TRIGGER_THRESHOLD,
} from "./constants";
import { productionRNG, type RNG } from "./prng";

export function computePrediction(
  agent: AgentConfigData,
  market: MarketWithEntries,
  signals: TrendSignals,
  crowd: CrowdSplit,
  rng: RNG = productionRNG,
  entrySignals?: Map<string, TrendSignals>
): PredictionDecision {
  const abstain = (
    reason: PredictionDecision["abstainReason"]
  ): PredictionDecision => ({ abstain: true, abstainReason: reason });

  const entries = market.entries;
  if (!entries.length) return abstain("low_edge");

  // Step 1: Domain filter
  const marketCategory = market.category?.toLowerCase() ?? "";
  const domainMatch =
    marketCategory !== "" &&
    agent.specialties.some(
      (s) => marketCategory.includes(s) || s.includes(marketCategory)
    );
  const skipProbability =
    domainMatch ? 0.15 :
    marketCategory === "trending" ? 0.4 :
    0.70;
  if (rng.nextFloat() < skipProbability) return abstain("domain");

  // Step 2: Activity gate
  if (rng.nextFloat() > agent.activityRate) return abstain("activity_gate");

  // Step 2b: Community cadence — spread agent participation across sweeps so
  // pools build gradually over the pre-launch window rather than spiking on
  // the first sweep after publish. 40% skip per sweep per agent.
  if (market.marketType === "community" && rng.nextFloat() < 0.40) {
    return abstain("domain");
  }

  // Step 3: Score each entry
  const n = entries.length;
  const scores: Record<string, number> = {};
  entries.forEach((e) => {
    scores[e.id] = 1 / n;
  });

  // Step 3a: Trend signal adjustments
  const signalBoost = computeSignalBoost(signals, agent);

  entries.forEach((entry) => {
    const label = (entry.label ?? "").toLowerCase();
    if (POSITIVE_HINTS.some((h) => label.includes(h))) {
      scores[entry.id] = Math.max(0.05, scores[entry.id] + signalBoost);
    } else if (NEGATIVE_HINTS.some((h) => label.includes(h))) {
      scores[entry.id] = Math.max(0.05, scores[entry.id] - signalBoost);
    }
  });

  // Step 3a-bis: Per-entry trend signals (H2H/gainer — each entry has its own person)
  if (entrySignals && entrySignals.size > 0) {
    for (const [entryId, entrySig] of Array.from(entrySignals)) {
      const momentum = entrySig.scoreDelta7d / 15;
      const wikiBoost = entrySig.wikiPulse === "rising" ? 0.08 : entrySig.wikiPulse === "falling" ? -0.08 : 0;
      const newsBoost = entrySig.newsLevel === "red" ? 0.05 : entrySig.newsLevel === "green" ? -0.03 : 0;
      const entryBoost = (momentum * 0.12 + wikiBoost + newsBoost) * agent.recencyWeight;
      scores[entryId] = Math.max(0.05, (scores[entryId] ?? (1 / n)) + entryBoost);
    }
  }

  // Step 3b: Prestige bias — favour positive outcomes for high-baseline figures
  if (signals.scoreBaseline > 6500 && agent.prestigeBias > 0.6) {
    const prestigeBoost = (agent.prestigeBias - 0.5) * 0.12;
    entries.forEach((entry) => {
      const label = (entry.label ?? "").toLowerCase();
      if (POSITIVE_HINTS.some((h) => label.includes(h))) {
        scores[entry.id] += prestigeBoost;
      }
    });
  }

  // Step 3c: Normalise
  let total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total <= 0) total = 1;
  Object.keys(scores).forEach((id) => {
    scores[id] /= total;
  });

  // Step 3d: Contrarianism adjustment
  if (agent.contrarianism > 0.5 && Object.keys(crowd).length > 0) {
    const crowdEntries = Object.entries(crowd).sort((a, b) => b[1] - a[1]);
    if (crowdEntries.length > 0) {
      const [dominantId, dominantShare] = crowdEntries[0];

      if (dominantShare > CONTRARIAN_TRIGGER_THRESHOLD) {
        const fadeAmount =
          agent.contrarianism *
          0.25 *
          ((dominantShare - CONTRARIAN_TRIGGER_THRESHOLD) / 0.35);
        scores[dominantId] = Math.max(0.05, scores[dominantId] - fadeAmount);

        const minorityTotal = Object.entries(scores)
          .filter(([id]) => id !== dominantId)
          .reduce((a, [, v]) => a + v, 0);

        if (minorityTotal > 0) {
          Object.keys(scores).forEach((id) => {
            if (id !== dominantId) {
              scores[id] += (fadeAmount * scores[id]) / minorityTotal;
            }
          });
        }

        // Re-normalise
        const newTotal = Object.values(scores).reduce((a, b) => a + b, 0);
        if (newTotal > 0) {
          Object.keys(scores).forEach((id) => {
            scores[id] /= newTotal;
          });
        }
      }
    }
  }

  // Step 4: Select entry
  // For multi-outcome community markets (3+ entries), use weighted random
  // selection so agents distribute across options rather than all piling
  // onto the top pick. Binary/updown markets still use deterministic top-1.
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  let chosenEntryId: string;
  let rawProbability: number;

  const isMultiCommunity =
    market.marketType === "community" &&
    market.openMarketType === "multi" &&
    n >= 3;

  if (isMultiCommunity) {
    const candidates = sorted.slice(0, Math.min(3, n));
    const totalWeight = candidates.reduce((s, [, v]) => s + v, 0);
    const roll = rng.nextFloat() * totalWeight;
    let cumulative = 0;
    let picked = candidates[0];
    for (const candidate of candidates) {
      cumulative += candidate[1];
      if (roll <= cumulative) { picked = candidate; break; }
    }
    [chosenEntryId, rawProbability] = picked;
  } else {
    [chosenEntryId, rawProbability] = sorted[0];
  }

  // Step 5: Edge check
  const chanceLevel = 1 / n;
  const edge = rawProbability - chanceLevel;
  const edgeThreshold = agent.riskAppetite * (0.5 / n);
  if (edge < edgeThreshold) return abstain("low_edge");

  // Step 6: Confidence calibration
  // confidence_cal > 0.7 → more extreme outputs (bold agent)
  // confidence_cal < 0.5 → compressed outputs (cautious agent)
  const confidence =
    chanceLevel + (rawProbability - chanceLevel) * agent.confidenceCal;
  const clampedConfidence = Math.max(
    chanceLevel + 0.01,
    Math.min(0.97, confidence)
  );

  // Step 7: Final random abstain (15% chance — spreads decisions across more sweeps)
  if (rng.nextFloat() < 0.15) return abstain("random");

  return {
    abstain: false,
    entryId: chosenEntryId,
    rawProbability: parseFloat(rawProbability.toFixed(4)),
    confidence: parseFloat(clampedConfidence.toFixed(3)),
  };
}

function computeSignalBoost(
  signals: TrendSignals,
  agent: AgentConfigData
): number {
  let boost = 0;

  // Wiki Pulse
  if (signals.wikiPulse === "rising") boost += 0.1 * agent.recencyWeight;
  if (signals.wikiPulse === "falling") boost -= 0.1 * agent.recencyWeight;

  // News level (red = high activity = net positive for attention)
  if (signals.newsLevel === "red") boost += 0.07 * agent.recencyWeight;
  if (signals.newsLevel === "green") boost -= 0.04 * agent.recencyWeight;

  // 7-day score delta as momentum signal
  const normalizedDelta = Math.max(
    -1,
    Math.min(1, signals.scoreDelta7d / 15)
  );
  boost += normalizedDelta * 0.1 * agent.recencyWeight;

  return boost;
}
