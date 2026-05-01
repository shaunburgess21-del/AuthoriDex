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
  WORLD_MARKET_BOOST_ENABLED,
  JACKPOT_AGENT_COLLISION_RANGE,
} from "./constants";
import { JACKPOT_MAX_PREDICTED_SCORE } from "../config/constants";
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
  // Off-domain skip was 0.70 which combined with the edge gate below crushed
  // up/down volume to ~10-15% of jackpot's effective rate (which has no edge
  // gate and only a 0.35 off-domain skip). Lowering to 0.50 keeps a real
  // domain effect — a tech-specialist still skips half of all sports cards
  // — while letting up/down feeds breathe across all 159 weekly cards.
  const skipProbability =
    domainMatch ? 0.15 :
    marketCategory === "trending" ? 0.4 :
    0.50;
  if (rng.nextFloat() < skipProbability) return abstain("domain");

  // Step 2: Activity gate
  if (rng.nextFloat() > agent.activityRate) return abstain("activity_gate");

  // Step 2b: Community cadence — spread agent participation across sweeps.
  // Skipped when WORLD_MARKET_BOOST_ENABLED because WORLD_MARKET_DELAY_RANGES
  // already stagger execution times across hours/days per archetype.
  if (!WORLD_MARKET_BOOST_ENABLED && market.marketType === "community" && rng.nextFloat() < 0.40) {
    return abstain("domain");
  }

  // Step 3: Score each entry
  const n = entries.length;
  const scores: Record<string, number> = {};
  const isH2H = market.marketType === "h2h";

  // For H2H, seed starting probabilities with a fame-weighted base so the
  // stronger / more-momentum person starts ahead (same idea as the VoxDex
  // Model pill shown to users). Without this, the generic 1/n start plus
  // tiny per-entry boosts almost never clear the edge threshold below, and
  // agents systematically abstain on every H2H pairing.
  if (isH2H && entries.length === 2 && entrySignals && entrySignals.size === 2) {
    const [eA, eB] = entries;
    const sA = entrySignals.get(eA.id);
    const sB = entrySignals.get(eB.id);
    if (sA && sB) {
      const fA = Math.max(sA.fameIndex ?? 0, 1);
      const fB = Math.max(sB.fameIndex ?? 0, 1);
      const momBonus = (s: TrendSignals): number => {
        const delta = s.scoreDelta7d ?? 0;
        if (s.wikiPulse === "rising" && delta > 8) return 1.10;
        if (delta > 3) return 1.05;
        if (s.wikiPulse === "falling" || delta < -3) return 0.95;
        return 1.0;
      };
      const wA = fA * momBonus(sA);
      const wB = fB * momBonus(sB);
      const pA = wA / (wA + wB);
      scores[eA.id] = Math.max(0.05, Math.min(0.95, pA));
      scores[eB.id] = Math.max(0.05, Math.min(0.95, 1 - pA));
    } else {
      entries.forEach((e) => { scores[e.id] = 1 / n; });
    }
  } else {
    entries.forEach((e) => { scores[e.id] = 1 / n; });
  }

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

  // Step 3a-bis: Per-entry trend signals (H2H/gainer — each entry has its own person).
  // For H2H we've already used fame + momentum to seed the base above, so skip
  // this second pass to avoid double-counting the same signal and to keep the
  // final probability readable against the pill users see.
  if (!isH2H && entrySignals && entrySignals.size > 0) {
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
  // For multi-outcome community markets (3+ entries) and H2H pairings, use
  // weighted random selection so agents distribute across options in
  // proportion to their conviction instead of all piling onto the top pick
  // (or abstaining together on near-coin-flip H2Hs). Up/Down still uses
  // deterministic top-1 because the signal there is directional, not a
  // comparison between two subjects.
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
  } else if (isH2H) {
    const totalWeight = sorted.reduce((s, [, v]) => s + v, 0) || 1;
    const roll = rng.nextFloat() * totalWeight;
    let cumulative = 0;
    let picked = sorted[0];
    for (const candidate of sorted) {
      cumulative += candidate[1];
      if (roll <= cumulative) { picked = candidate; break; }
    }
    chosenEntryId = picked[0];
    rawProbability = picked[1] / totalWeight;
  } else {
    [chosenEntryId, rawProbability] = sorted[0];
  }

  // Step 5: Edge check
  // H2H pairings are usually close in fame (markets like Tucker vs Kylie
  // sit at ~50/50), so the standard "must beat chance by X" gate would force
  // agents to abstain on nearly every pairing. Since we use weighted random
  // selection for H2H above, the pool naturally splits in proportion to
  // conviction — the edge check would just starve the section.
  const chanceLevel = 1 / n;
  if (!isH2H) {
    const edge = rawProbability - chanceLevel;
    // Halved from 0.5/n to 0.25/n. With the previous threshold an average
    // riskAppetite=0.5 agent needed model probability ≥62.5% on every up/down
    // (n=2) to bet — most weekly cards sit at 51-58%, so agents abstained on
    // the majority. The simulation layer below applies a SECOND, persona-
    // aware edge gate against the live pool, so we don't need a punishing
    // chance-level gate here as well.
    const edgeThreshold = agent.riskAppetite * (0.25 / n);
    if (edge < edgeThreshold) return abstain("low_edge");
  }

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

/**
 * Deterministic jackpot prediction: picks an integer score for a celebrity
 * based on their current trend signals and the agent's personality traits.
 * Receives taken numbers from the caller so this file stays DB-free.
 */
export function computeJackpotPrediction(
  agent: AgentConfigData,
  signals: TrendSignals,
  takenNumbers: Set<number>,
  marketCategory: string | null,
  rng: RNG = productionRNG,
): PredictionDecision {
  const abstain = (
    reason: PredictionDecision["abstainReason"]
  ): PredictionDecision => ({ abstain: true, abstainReason: reason });

  // Activity gate (same pattern as computePrediction)
  if (rng.nextFloat() > agent.activityRate) return abstain("activity_gate");

  // Domain filter — jackpots are celebrity-linked so category relevance matters
  const category = (marketCategory ?? "").toLowerCase();
  const domainMatch =
    category !== "" &&
    agent.specialties.some((s) => category.includes(s) || s.includes(category));
  // Off-domain bumped from 0.35 → 0.45 so jackpot's per-market effective
  // scheduling rate sits closer to the new looser up/down rate. Without this,
  // the activity feed kept skewing 4-5x toward jackpot. Once the top-20-only
  // jackpot rule kicks in next Monday, only ~36% of agents will be eligible,
  // which compounds the reduction further.
  const skipProbability = domainMatch ? 0.10 : 0.45;
  if (rng.nextFloat() < skipProbability) return abstain("domain");

  // Final random abstain (10% — slightly lower than standard to ensure jackpot participation)
  if (rng.nextFloat() < 0.10) return abstain("random");

  const anchor = signals.fameIndex;
  let prediction = anchor;
  let reasoning = "";

  // Archetype-driven adjustments
  switch (agent.archetype) {
    case "momentum_chaser": {
      const momentum = signals.scoreDelta7d * agent.recencyWeight * 1.5;
      prediction += momentum;
      reasoning = `Extrapolated ${signals.scoreDelta7d > 0 ? "upward" : "downward"} trend (7d delta ${signals.scoreDelta7d.toFixed(1)})`;
      break;
    }
    case "prestige_maximiser": {
      const pullToBaseline = (signals.scoreBaseline - anchor) * agent.prestigeBias * 0.4;
      prediction += pullToBaseline;
      reasoning = `Biased toward prestige baseline (${signals.scoreBaseline})`;
      break;
    }
    case "contrarian": {
      const deviation = anchor - signals.scoreBaseline;
      const reversion = -deviation * agent.contrarianism * 0.5;
      prediction += reversion;
      reasoning = `Mean-reverted from current (deviation ${deviation > 0 ? "+" : ""}${deviation.toFixed(0)} from baseline)`;
      break;
    }
    case "news_reactive": {
      const newsBoost = signals.newsLevel === "red" ? 80 : signals.newsLevel === "green" ? -40 : 10;
      const wikiBoost = signals.wikiPulse === "rising" ? 50 : signals.wikiPulse === "falling" ? -30 : 0;
      prediction += (newsBoost + wikiBoost) * agent.recencyWeight;
      reasoning = `Weighted news=${signals.newsLevel}, wiki=${signals.wikiPulse}`;
      break;
    }
    case "long_horizon": {
      const drift = signals.scoreDelta7d * 0.2 * (1 - agent.boldness);
      prediction += drift;
      reasoning = `Minimal change expected (long-horizon stable assumption)`;
      break;
    }
    case "recency_bias": {
      const recentMove = signals.scoreDelta7d * agent.recencyWeight * 2.0;
      prediction += recentMove;
      reasoning = `Heavily weighted recent movement (7d delta ${signals.scoreDelta7d.toFixed(1)})`;
      break;
    }
    case "domain_specialist": {
      const variance = domainMatch ? 0.3 : 1.0;
      const drift = signals.scoreDelta7d * variance * agent.recencyWeight;
      prediction += drift;
      reasoning = domainMatch
        ? `Domain match — tight prediction near current score`
        : `Outside specialty — wider spread`;
      break;
    }
    case "culture_tracker": {
      const socialBoost = signals.wikiPulse === "rising" ? 60 : signals.wikiPulse === "falling" ? -40 : 0;
      const momentum = signals.scoreDelta7d * agent.recencyWeight;
      prediction += socialBoost + momentum;
      reasoning = `Social/cultural signals: wiki=${signals.wikiPulse}, momentum=${signals.scoreDelta7d.toFixed(1)}`;
      break;
    }
    case "high_conviction": {
      const smallAdjust = signals.scoreDelta7d * 0.5;
      prediction += smallAdjust;
      reasoning = `High conviction — committed near current score with minor trend adjust`;
      break;
    }
    case "conservative": {
      const tinyDrift = signals.scoreDelta7d * 0.15;
      prediction += tinyDrift;
      reasoning = `Conservative — minimal deviation from current ${anchor}`;
      break;
    }
    case "chaos_agent": {
      const maxOffset = anchor * 0.15 * agent.riskAppetite;
      const chaosOffset = (rng.nextFloat() * 2 - 1) * maxOffset * agent.boldness;
      prediction += chaosOffset;
      reasoning = `Chaos pick — random offset ${chaosOffset > 0 ? "+" : ""}${chaosOffset.toFixed(0)} from anchor`;
      break;
    }
    default: {
      const defaultDrift = signals.scoreDelta7d * 0.5;
      prediction += defaultDrift;
      reasoning = `Default: anchored to current score with trend adjustment`;
    }
  }

  // Add PRNG noise scaled by boldness and riskAppetite
  const noiseScale = anchor * 0.02 * agent.boldness * (0.5 + agent.riskAppetite * 0.5);
  const noise = (rng.nextFloat() * 2 - 1) * noiseScale;
  prediction += noise;

  // Clamp and round
  let score = Math.round(prediction);
  score = Math.max(1, Math.min(JACKPOT_MAX_PREDICTED_SCORE, score));

  // Find an available number if taken
  if (takenNumbers.has(score)) {
    let found = false;
    for (let offset = 1; offset <= JACKPOT_AGENT_COLLISION_RANGE; offset++) {
      if (score + offset <= JACKPOT_MAX_PREDICTED_SCORE && !takenNumbers.has(score + offset)) {
        score = score + offset;
        found = true;
        break;
      }
      if (score - offset >= 1 && !takenNumbers.has(score - offset)) {
        score = score - offset;
        found = true;
        break;
      }
    }
    if (!found) {
      return abstain("low_edge");
    }
  }

  // Confidence: tighter predictions (closer to anchor) get higher confidence
  const distFromAnchor = Math.abs(score - anchor);
  const maxReasonableDist = anchor * 0.1 || 500;
  const rawConfidence = 1 - Math.min(1, distFromAnchor / maxReasonableDist);
  const confidence = parseFloat(
    (0.4 + rawConfidence * 0.55 * agent.confidenceCal).toFixed(3)
  );

  return {
    abstain: false,
    predictedScore: score,
    confidence,
    reasoning,
    source: "deterministic",
  };
}
