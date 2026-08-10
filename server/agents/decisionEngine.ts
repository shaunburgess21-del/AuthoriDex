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
  DECISIVE_WEEKLY_MOVE_PCT,
  PRESTIGE_MIN_BASELINE,
  NO_SIGNAL_ABSTAIN_RATE_STANDARD,
  NO_SIGNAL_ABSTAIN_RATE_SHARP,
  YOUNG_MARKET_HOURS,
  NATIVE_LLM_BOOST_WEIGHT,
  LOCKIN_FAIR_SHADOW,
  isLockInFairEnabled,
  isLockInFairH2HShadow,
  isLockInFairH2HEnabled,
  isLockInFairGainerShadow,
  isLockInFairGainerEnabled,
  LOCKIN_H2H_DECISIVE_FAIR,
  LOCKIN_H2H_SIGMA_1D,
  LOCKIN_H2H_BETA,
  LOCKIN_GAINER_DECISIVE_FAIR,
  LOCKIN_GAINER_SIGMA_1D,
  LOCKIN_GAINER_BETA,
} from "./constants";
import {
  computeLockInFairUp,
  fairForEntry,
  fairH2HByEntryId,
  fairGainerByEntryId,
  favoredH2HFromFairMap,
  LOCKIN_DECISIVE_PCT,
  LOCKIN_FAIR_MAX,
} from "./lockInFair";
import type { NativeAssessment } from "./nativeMarketTypes";
import { JACKPOT_MAX_PREDICTED_SCORE } from "../config/constants";
import { productionRNG, type RNG } from "./prng";
import { getSimulationProfile } from "./simulationProfile";

/**
 * Sharp-band detection. Sharps get tighter edge gates, lower random
 * abstain, multi-window momentum weighting, and stronger value-bet stake
 * boosts — they're the cohort that should sit near the top of the weekly
 * leaderboard most of the time. Rest of the cohort uses the standard path.
 */
function isSharpAgent(agent: AgentConfigData): boolean {
  const sim = getSimulationProfile(agent.simulationProfile);
  return sim.personaBand === "sharp";
}

export function computePrediction(
  agent: AgentConfigData,
  market: MarketWithEntries,
  signals: TrendSignals,
  crowd: CrowdSplit,
  rng: RNG = productionRNG,
  entrySignals?: Map<string, TrendSignals>,
  options: {
    priority?: "high" | "normal";
    decisiveLatched?: boolean;
    nativeAssessment?: NativeAssessment | null;
    /** Hours until market endAt — drives lock-in fair value. */
    hoursRemaining?: number;
  } = {},
): PredictionDecision {
  const abstain = (
    reason: PredictionDecision["abstainReason"]
  ): PredictionDecision => ({ abstain: true, abstainReason: reason });

  const entries = market.entries;
  if (!entries.length) return abstain("low_edge");

  const sharp = isSharpAgent(agent);

  // Cohort-wide gates derived from the weekly-open delta. Hoisted up here
  // so every downstream step (prestige bias, contrarian fade, weighted-
  // random selection) consults the SAME computation instead of each
  // re-deriving it inline. `pctChangeVsOpen` is only set on binary
  // up/down per-person markets (see agentRunner getTrendSignals), so on
  // jackpot / community / pre-Sprint-6 markets both flags stay false and
  // legacy behaviour is preserved.
  //
  //   decisivelyDown    — used to disarm the UP prestige boost the moment
  //                       a famous person is more than 5% below open.
  //                       Tighter threshold because "famous person in
  //                       any noticeable drawdown" is enough to flip the
  //                       heuristic from helpful to actively wrong.
  //   decisiveWeeklyMove — used in both directions to skip the cohort
  //                       splitting / contrarianism mechanics that exist
  //                       to inject variance on borderline reads. ±10%
  //                       (or latched for the week — see agentRunner
  //                       metadata.weeklyOpen) so a bounce off −18% to
  //                       −12% does not re-enable randomized UP picks.
  const pctVsOpen =
    signals.pctChangeVsOpen != null && Number.isFinite(signals.pctChangeVsOpen)
      ? signals.pctChangeVsOpen
      : null;
  const decisivelyDown = pctVsOpen != null && pctVsOpen < -0.05;
  const decisiveWeeklyMove =
    options.decisiveLatched === true ||
    (pctVsOpen != null && Math.abs(pctVsOpen) >= DECISIVE_WEEKLY_MOVE_PCT);

  const hoursRemaining =
    typeof options.hoursRemaining === "number" && Number.isFinite(options.hoursRemaining)
      ? Math.max(0, options.hoursRemaining)
      : 7 * 24;

  const isBinaryUpDown =
    market.marketType === "updown" && entries.length === 2;
  const fairUp =
    isBinaryUpDown
      ? computeLockInFairUp(signals.pctChangeVsOpen, hoursRemaining)
      : null;

  const lockInDecisive =
    isBinaryUpDown &&
    fairUp != null &&
    pctVsOpen != null &&
    Math.abs(pctVsOpen) >= LOCKIN_DECISIVE_PCT;

  const isH2HPair = market.marketType === "h2h" && entries.length === 2;
  let h2hFairByEntryId: Record<string, number> | null = null;
  if (isH2HPair && entrySignals && entrySignals.size >= 2) {
    const [eA, eB] = entries;
    const scoreA = entrySignals.get(eA.id)?.fameIndex;
    const scoreB = entrySignals.get(eB.id)?.fameIndex;
    if (
      scoreA != null &&
      Number.isFinite(scoreA) &&
      scoreB != null &&
      Number.isFinite(scoreB)
    ) {
      h2hFairByEntryId = fairH2HByEntryId(
        eA.id,
        scoreA,
        eB.id,
        scoreB,
        hoursRemaining,
        LOCKIN_H2H_SIGMA_1D,
        LOCKIN_H2H_BETA,
      );
    }
  }
  const h2hFavored =
    h2hFairByEntryId != null ? favoredH2HFromFairMap(h2hFairByEntryId) : null;
  const lockInH2HDecisive =
    isH2HPair &&
    h2hFavored != null &&
    h2hFavored.fair >= LOCKIN_H2H_DECISIVE_FAIR;

  const isGainerField = market.marketType === "gainer" && entries.length >= 2;
  let gainerFairByEntryId: Record<string, number> | null = null;
  if (isGainerField && entrySignals && entrySignals.size >= 2) {
    const pctByEntryId: Record<string, number | null | undefined> = {};
    for (const entry of entries) {
      pctByEntryId[entry.id] = entrySignals.get(entry.id)?.pctChangeVsOpen;
    }
    gainerFairByEntryId = fairGainerByEntryId(
      pctByEntryId,
      hoursRemaining,
      LOCKIN_GAINER_SIGMA_1D,
      LOCKIN_GAINER_BETA,
    );
  }
  const gainerFavored =
    gainerFairByEntryId != null
      ? favoredH2HFromFairMap(gainerFairByEntryId)
      : null;
  const lockInGainerDecisive =
    isGainerField &&
    gainerFavored != null &&
    gainerFavored.fair >= LOCKIN_GAINER_DECISIVE_FAIR;

  // Step 1: Domain filter
  const marketCategory = market.category?.toLowerCase() ?? "";
  const domainMatch =
    marketCategory !== "" &&
    agent.specialties.some(
      (s) => marketCategory.includes(s) || s.includes(marketCategory)
    );
  // Sharps get a much shallower off-domain skip — they're the cohort that
  // hunts edge anywhere it shows up, regardless of category. Standard band
  // still skips 50% of off-domain markets so specialty actually means
  // something for everyone else.
  const skipProbability = sharp
    ? (domainMatch ? 0.05 : marketCategory === "trending" ? 0.20 : 0.25)
    : (domainMatch ? 0.15 : marketCategory === "trending" ? 0.40 : 0.50);
  if (rng.nextFloat() < skipProbability) return abstain("domain");

  // Step 2: Activity gate
  if (rng.nextFloat() > agent.activityRate) return abstain("activity_gate");

  // Step 2a: Young market + no directional signal — reduce Monday pile-on.
  const isNativeMarket =
    market.marketType === "updown" ||
    market.marketType === "h2h" ||
    market.marketType === "gainer";
  const isSignalSparse =
    isNativeMarket &&
    (signals.pctChangeVsOpen == null ||
      (Number.isFinite(signals.pctChangeVsOpen) &&
        Math.abs(signals.pctChangeVsOpen) < 0.02)) &&
    Math.abs(signals.change24h) < 0.5;
  const marketCreatedAt = market.createdAt
    ? new Date(market.createdAt).getTime()
    : null;
  const isYoungMarket =
    marketCreatedAt != null &&
    Number.isFinite(marketCreatedAt) &&
    Date.now() - marketCreatedAt < YOUNG_MARKET_HOURS * 60 * 60 * 1000;
  if (isSignalSparse && isYoungMarket) {
    const sparseAbstainRate = sharp
      ? NO_SIGNAL_ABSTAIN_RATE_SHARP
      : NO_SIGNAL_ABSTAIN_RATE_STANDARD;
    if (rng.nextFloat() < sparseAbstainRate) return abstain("no_signal");
  }

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
      // Multiplicative bonus that combines three composite signals on
      // each side:
      //   - 7d delta tiers      (max ±2.5% on tier 1, ±5% on tier 2)
      //   - vs-open baseline    (saturating at ±20%, max ±10%)
      //   - trendDirection tilt (max ±4%)
      //
      // Plan D — composite-only agents (this commit). Wiki/news reads
      // were removed here because the leaderboard score already
      // integrates them; the 7d delta tier (`scoreDelta7d`) already
      // reflects whatever wiki/news activity moved the score. The
      // bigger 1.05 tier (`delta > 8`) used to require `wikiPulse rising`
      // as a co-trigger; now it just requires the stronger 7d momentum.
      //
      // The vs-open factor is the magnitude-aware completion of Phase 1b:
      // we resolve a per-entry baseline from `trend_snapshots` at-or-
      // before market.createdAt, so a person who has tanked 30% from open
      // SHOULD lose meaningful fame weight in an H2H, not just the 4%
      // direction-tilt nudge. Saturates at ±20% with a 0.10 coefficient
      // — half of `computeSignalBoost`'s 0.18, because H2H is a mutual
      // comparison (both sides get the factor) so net effect on the
      // probability split roughly doubles.
      //
      // Why direction tilt stays ON TOP of the vs-open factor: when
      // pctChangeVsOpen is small/zero but `change24h` and `change7d`
      // agree (rung 2 of the priority ladder), direction is still UP/DOWN
      // and provides a sign-aware nudge that the vs-open factor (near 1.0)
      // wouldn't catch.
      const momBonus = (s: TrendSignals): number => {
        const delta = s.scoreDelta7d ?? 0;
        let bonus = 1.0;
        if (delta > 8) bonus = 1.05;
        else if (delta > 3) bonus = 1.025;
        else if (delta < -3) bonus = 0.975;
        if (
          s.pctChangeVsOpen != null &&
          Number.isFinite(s.pctChangeVsOpen)
        ) {
          const normalized = Math.max(-1, Math.min(1, s.pctChangeVsOpen / 0.20));
          bonus *= 1 + normalized * 0.10;
        }
        if (s.trendDirection === "UP") bonus *= 1.04;
        else if (s.trendDirection === "DOWN") bonus *= 0.96;
        return bonus;
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

  // H2H / Gainer: LLM probability tilts the leading entry (entry 0 in
  // prompt). Up/Down uses POSITIVE_HINTS in Step 3a via computeSignalBoost.
  if (
    options.nativeAssessment &&
    Number.isFinite(options.nativeAssessment.probability) &&
    (market.marketType === "h2h" || market.marketType === "gainer")
  ) {
    const llmTilt =
      (options.nativeAssessment.probability - 0.5) *
      2 *
      NATIVE_LLM_BOOST_WEIGHT *
      agent.recencyWeight;
    if (market.marketType === "h2h" && entries.length === 2) {
      scores[entries[0].id] = Math.max(
        0.05,
        Math.min(0.95, (scores[entries[0].id] ?? 0.5) + llmTilt),
      );
      scores[entries[1].id] = Math.max(
        0.05,
        Math.min(0.95, (scores[entries[1].id] ?? 0.5) - llmTilt),
      );
    } else if (market.marketType === "gainer" && entries.length >= 2) {
      scores[entries[0].id] = Math.max(
        0.05,
        Math.min(0.95, (scores[entries[0].id] ?? 1 / n) + llmTilt),
      );
      const share = llmTilt / (entries.length - 1);
      for (let i = 1; i < entries.length; i++) {
        scores[entries[i].id] = Math.max(
          0.05,
          Math.min(0.95, (scores[entries[i].id] ?? 1 / n) - share),
        );
      }
    }
  }

  // Step 3a: Trend signal adjustments
  // Per-agent jitter (±0.06) breaks the lock-step "every agent reads the
  // same composite signals → all pick the same side" pattern that was
  // producing 60+ identical Theo Von "Down" bets per week. Each agent's
  // interpretation of the same signals now varies by ~one notch, which
  // still keeps the dominant view dominant on high-conviction markets but
  // lets ~15-25% of the cohort lean the other way on borderline reads.
  //
  // Sharps get HALF the jitter — they're supposed to read the signals
  // accurately and consistently. The smaller jitter still avoids two sharps
  // making identical decisions but doesn't bury their edge in noise.
  const jitterRange = sharp ? 0.03 : 0.06;
  const jitter = (rng.nextFloat() * 2 - 1) * jitterRange;
  const baseSignalBoost = computeSignalBoost(
    signals,
    agent,
    options.nativeAssessment,
    market.marketType,
  );
  // Multi-window momentum bonus: only sharps get this. When 7d and 14d
  // disagree (e.g. 7d falling but 14d still strongly rising), the agent
  // assumes mean-reversion is in play and dampens the short-window signal.
  // When 7d, 14d, and 30d all agree, the agent gets confidence — the trend
  // is real, not noise. This is the single most useful "sharp tell" we can
  // add without external data: noticing trend persistence vs reversal.
  const multiWindowAdjust = sharp ? computeMultiWindowAdjust(signals, agent) : 0;
  const signalBoost = baseSignalBoost + multiWindowAdjust + jitter;

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
      // Plan D — composite-only agents (this commit). Wiki/news entry
      // boosts were removed because the leaderboard score already
      // integrates them; an entry's `pctChangeVsOpen` and `scoreDelta7d`
      // already reflect whatever wiki/news activity moved its score.
      // Race entry seeding is now: 7d momentum + vs-open flow + direction
      // tilt — every input a derivative of the composite.
      //
      // Vs-open baseline: saturates at ±20% with a 0.10 coefficient —
      // smaller than computeSignalBoost's 0.18 because race entries
      // dilute (all entries' boosts get re-normalised at Step 3c), but
      // big enough to visibly fade an entry that has tanked materially
      // since the market opened. Skipped silently when no baseline could
      // be resolved (no snapshot pre-dating market.createdAt).
      const vsOpenBoost =
        entrySig.pctChangeVsOpen != null && Number.isFinite(entrySig.pctChangeVsOpen)
          ? Math.max(-1, Math.min(1, entrySig.pctChangeVsOpen / 0.20)) * 0.10
          : 0;
      // Direction tilt for race-style multi-entry comparisons: small
      // additive nudge that catches the case where vsOpen is near zero
      // but the priority ladder still agrees on direction (rung 2/3).
      const dirBoost =
        entrySig.trendDirection === "UP" ? 0.03
        : entrySig.trendDirection === "DOWN" ? -0.03
        : 0;
      const entryBoost = (momentum * 0.12 + vsOpenBoost + dirBoost) * agent.recencyWeight;
      scores[entryId] = Math.max(0.05, (scores[entryId] ?? (1 / n)) + entryBoost);
    }
  }

  // Step 3b: Prestige bias — favour positive outcomes for high-baseline figures.
  //
  // Guard: skip when the person is in clear weekly drawdown vs THIS
  // market's opening score (`pctChangeVsOpen < -0.05`). The old version
  // gated only on raw fame (`scoreBaseline > 6500`), which is a live
  // measure — a celebrity who has tanked 37% from their weekly open
  // still trivially clears it, and the UP-direction prestige boost then
  // actively fights the reality of the market resolving DOWN. This was
  // the second-biggest contributor to the "Putin/Vinicius/Magyar
  // 50/50 on −30% markets" mispricing (after the saturated 7d momentum
  // signal, now superseded by `pctChangeVsOpen` in computeSignalBoost).
  //
  // We only KILL prestige in the down direction. A celeb who is flat
  // or up vs open still benefits — the heuristic captures a real
  // pattern (famous people's markets tend to resolve toward the
  // "person continues to exist as the kind of person they are"
  // direction), it just shouldn't dominate when the reality has
  // already moved decisively the other way. `decisivelyDown` is
  // hoisted to the top of the function so every guard reads the same
  // value.
  const hasPositiveDirectionalSignal =
    (signals.pctChangeVsOpen != null &&
      Number.isFinite(signals.pctChangeVsOpen) &&
      signals.pctChangeVsOpen > 0.02) ||
    (signals.change24h > 0.5 && signals.scoreDelta7d >= 0);

  if (
    signals.scoreBaseline > PRESTIGE_MIN_BASELINE &&
    agent.prestigeBias > 0.6 &&
    !decisivelyDown &&
    hasPositiveDirectionalSignal
  ) {
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
  //
  // Contrarianism exists to keep the cohort from groupthink on
  // BORDERLINE reads — a "many humans bet Down on Theo Von, agents
  // should add some Up to balance the book" mechanic. On a decisively-
  // trending weekly market it stops being a balance and starts being
  // noise that fights the model: if humans rightly pile DOWN on a
  // person who is -30% from open, contrarian agents fading DOWN are
  // just pushing the price back to 50/50 against reality. Skip when
  // `decisiveWeeklyMove` (same threshold as the weighted-random skip
  // below — they're two sides of the same "honour the obvious read"
  // rule).
  if (
    agent.contrarianism > 0.5 &&
    !decisiveWeeklyMove &&
    !lockInH2HDecisive &&
    !lockInGainerDecisive &&
    Object.keys(crowd).length > 0
  ) {
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

  // Step 3e: Lock-in fair — on a decisive weekly lead, pick the favoured side
  // deterministically so contrarianism / weighted random can't price backwards.
  let lockInForcedEntryId: string | null = null;
  if (isLockInFairH2HEnabled() && lockInH2HDecisive && h2hFavored) {
    lockInForcedEntryId = h2hFavored.entryId;
  } else if (
    isLockInFairGainerEnabled() &&
    lockInGainerDecisive &&
    gainerFavored
  ) {
    lockInForcedEntryId = gainerFavored.entryId;
  } else if (
    isLockInFairEnabled() &&
    lockInDecisive &&
    fairUp != null
  ) {
    for (const entry of entries) {
      const f = fairForEntry(fairUp, entry.label, POSITIVE_HINTS, NEGATIVE_HINTS);
      if (f != null && f >= 0.5) {
        lockInForcedEntryId = entry.id;
        break;
      }
    }
    if (lockInForcedEntryId == null) {
      for (const entry of entries) {
        const f = fairForEntry(fairUp, entry.label, POSITIVE_HINTS, NEGATIVE_HINTS);
        if (f != null && f < 0.5) {
          lockInForcedEntryId = entry.id;
          break;
        }
      }
    }
  }

  // Step 4: Select entry
  // - Multi-outcome community markets (3+ entries) and H2H pairings always
  //   use weighted random selection so agents distribute across options in
  //   proportion to their conviction instead of all piling onto the top
  //   pick (or abstaining together on near-coin-flip H2Hs).
  // - Binary up/down uses weighted random for STANDARD-band agents when
  //   the top score is below 0.65 (moderate conviction) — this prevents
  //   the entire cohort from piling onto the same side on borderline
  //   reads (the Theo Von Down problem from 2026-05-01).
  // - Sharps ALWAYS use deterministic top-pick on binary up/down. The
  //   whole point of the sharp band is to read the model accurately;
  //   randomly picking the lower-conviction side just to spread variety
  //   would erode their P&L and defeat the leaderboard differentiation.
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  let chosenEntryId: string;
  let rawProbability: number;

  const isMultiCommunity =
    market.marketType === "community" &&
    market.openMarketType === "multi" &&
    n >= 3;

  const isBinaryUpDownSelect = !isH2H && !isMultiCommunity && n === 2;
  const useWeightedUpDown =
    isBinaryUpDownSelect && !sharp && sorted[0][1] < 0.65 && !decisiveWeeklyMove;

  if (lockInForcedEntryId) {
    chosenEntryId = lockInForcedEntryId;
    rawProbability = sorted.find(([id]) => id === lockInForcedEntryId)?.[1] ?? 0.5;
  } else if (isMultiCommunity) {
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
  } else if (isH2H || useWeightedUpDown) {
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
  // conviction — the edge check would just starve the section. Same logic
  // applies to weighted up/down picks (added below for variety): the agent
  // may have intentionally picked the lower-scoring side, so we instead
  // gate on whether EITHER side has any conviction at all.
  const chanceLevel = 1 / n;
  if ((isH2H || useWeightedUpDown) && !lockInForcedEntryId) {
    // Sanity floor: only abstain when both sides are essentially a coin
    // flip with no model signal at all (max < 52%). Otherwise honour the
    // weighted draw — that's the whole point of the spread.
    // Skip when lock-in already force-picked — fame-weighted scores can stay
    // near 50/50 even when fair value is decisive.
    const topScore = sorted[0][1];
    if (topScore < 0.52) return abstain("low_edge");
  } else if (!lockInForcedEntryId) {
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
  const opinionConfidence =
    chanceLevel + (rawProbability - chanceLevel) * agent.confidenceCal;

  let targetConfidence = opinionConfidence;
  if (isLockInFairH2HEnabled() && h2hFairByEntryId != null) {
    const chosenFair = h2hFairByEntryId[chosenEntryId];
    if (chosenFair != null && Number.isFinite(chosenFair)) {
      const h2hForced =
        lockInH2HDecisive &&
        h2hFavored != null &&
        chosenEntryId === h2hFavored.entryId;
      targetConfidence = h2hForced
        ? h2hFavored.fair
        : Math.max(opinionConfidence, chosenFair);
    }
  } else if (isLockInFairGainerEnabled() && gainerFairByEntryId != null) {
    const chosenFair = gainerFairByEntryId[chosenEntryId];
    if (chosenFair != null && Number.isFinite(chosenFair)) {
      const gainerForced =
        lockInGainerDecisive &&
        gainerFavored != null &&
        chosenEntryId === gainerFavored.entryId;
      targetConfidence = gainerForced
        ? gainerFavored.fair
        : Math.max(opinionConfidence, chosenFair);
    }
  } else if (isLockInFairEnabled() && fairUp != null) {
    const chosenEntry = entries.find((e) => e.id === chosenEntryId);
    const fairSide = fairForEntry(
      fairUp,
      chosenEntry?.label,
      POSITIVE_HINTS,
      NEGATIVE_HINTS,
    );
    if (fairSide != null) {
      // Lock-in is a fact near close — bypass confidenceCal (not a bold opinion).
      targetConfidence = lockInForcedEntryId
        ? fairSide
        : Math.max(opinionConfidence, fairSide);
    }
  }

  const clampedConfidence = Math.max(
    chanceLevel + 0.01,
    Math.min(LOCKIN_FAIR_MAX, targetConfidence),
  );

  if (LOCKIN_FAIR_SHADOW && fairUp != null && market.id) {
    const chosenEntry = entries.find((e) => e.id === chosenEntryId);
    const fairSide = fairForEntry(
      fairUp,
      chosenEntry?.label,
      POSITIVE_HINTS,
      NEGATIVE_HINTS,
    );
    console.log(
      `[LockInFair][shadow] market=${market.id.slice(0, 8)} hrs=${hoursRemaining.toFixed(1)} fairUp=${fairUp.toFixed(3)} fairSide=${fairSide?.toFixed(3) ?? "n/a"} opinion=${opinionConfidence.toFixed(3)} target=${clampedConfidence.toFixed(3)} pctOpen=${pctVsOpen?.toFixed(3) ?? "n/a"}`,
    );
  }

  if (isLockInFairH2HShadow() && h2hFairByEntryId != null && market.id) {
    const chosenFair = h2hFairByEntryId[chosenEntryId];
    console.log(
      `[LockInFairH2H][shadow] market=${market.id.slice(0, 8)} hrs=${hoursRemaining.toFixed(1)} fairFav=${h2hFavored?.fair.toFixed(3) ?? "n/a"} favEntry=${h2hFavored?.entryId.slice(0, 8) ?? "n/a"} chosenFair=${chosenFair?.toFixed(3) ?? "n/a"} opinion=${opinionConfidence.toFixed(3)} target=${clampedConfidence.toFixed(3)}`,
    );
  }

  if (isLockInFairGainerShadow() && gainerFairByEntryId != null && market.id) {
    const chosenFair = gainerFairByEntryId[chosenEntryId];
    console.log(
      `[LockInFairGainer][shadow] market=${market.id.slice(0, 8)} hrs=${hoursRemaining.toFixed(1)} fairFav=${gainerFavored?.fair.toFixed(3) ?? "n/a"} favEntry=${gainerFavored?.entryId.slice(0, 8) ?? "n/a"} chosenFair=${chosenFair?.toFixed(3) ?? "n/a"} opinion=${opinionConfidence.toFixed(3)} target=${clampedConfidence.toFixed(3)}`,
    );
  }

  // Step 7: Final random abstain. Sharps abstain less because the whole
  // point of the band is they show up consistently when the model has
  // anything resembling a view. Standard band keeps the wider random gate
  // so the activity feed doesn't become just sharps + jackpot noise.
  // If the LLM market-ranker flagged this as a high-priority market for
  // a sharp, the random abstain is skipped entirely — the whole point of
  // the ranker is to make sure sharps don't randomly walk away from the
  // markets the LLM identified as high-edge.
  const isHighPriority = options.priority === "high" && sharp;
  if (!isHighPriority) {
    const finalAbstainRate = sharp ? 0.05 : 0.15;
    if (rng.nextFloat() < finalAbstainRate) return abstain("random");
  }

  return {
    abstain: false,
    entryId: chosenEntryId,
    rawProbability: parseFloat(rawProbability.toFixed(4)),
    confidence: parseFloat(clampedConfidence.toFixed(3)),
  };
}

function computeSignalBoost(
  signals: TrendSignals,
  agent: AgentConfigData,
  nativeAssessment?: NativeAssessment | null,
  marketType?: string,
): number {
  let boost = 0;

  // Plan D — composite-only agents. Wiki/news component reads were
  // dropped here in commit (this commit) because the trend score
  // already integrates wiki + news + Google Trends + IG/YT followers
  // (see scoring/trendScore.ts). Reading them again on top in the
  // decision engine was double-counting attention. Agent decisions
  // now derive purely from composite-derived signals: `pctChangeVsOpen`
  // (flow) with `scoreDelta7d` legacy fallback, and the `trendDirection`
  // consensus tilt. By construction agents can only move in directions
  // the leaderboard score itself moves.

  // Primary directional read for binary up/down markets: move since
  // THIS market opened (Monday → Friday for weekly cards). Saturates at
  // ±20% with a strong 0.18 coefficient — a person who is −20% below
  // their weekly open will push DOWN entries up by ~0.18 (and UP entries
  // down by the same amount), which on a 0.50 base gives ~0.68/0.32 —
  // enough to clear the existing edge gate without going extreme.
  //
  // When `pctChangeVsOpen` is missing (jackpot evaluation, community
  // markets, or pre-Sprint-6 markets that never had metadata.openingScore
  // stamped) we fall back to the original 7d rolling momentum read so
  // legacy behaviour is preserved.
  //
  // Note: as of the Agent v2 sprint, H2H/Race per-entry signals DO carry
  // `pctChangeVsOpen` (resolved via `getEntryOpeningScore` against
  // `trend_snapshots` at market createdAt), so the strong-coefficient path
  // now applies to per-entry comparisons too — fixing the "Putin baseline
  // -DOWN doesn't read through" bug.
  if (signals.pctChangeVsOpen != null && Number.isFinite(signals.pctChangeVsOpen)) {
    const normalizedOpen = Math.max(-1, Math.min(1, signals.pctChangeVsOpen / 0.20));
    boost += normalizedOpen * 0.18 * agent.recencyWeight;
  } else {
    // 7-day score delta as momentum signal — legacy fallback path
    const normalizedDelta = Math.max(
      -1,
      Math.min(1, signals.scoreDelta7d / 15)
    );
    boost += normalizedDelta * 0.1 * agent.recencyWeight;
  }

  // Explicit `trendDirection` tilt — small uniform bump that survives when
  // the underlying signals are individually weak but agree on direction.
  // Magnitude (0.03) is intentionally a third of the pctChangeVsOpen
  // coefficient so this can't overwhelm the primary "vs open" read; its
  // job is to tilt borderline cases the right way, not to dominate.
  // FLAT contributes nothing — see TrendDirection priority ladder for why
  // FLAT means "no signals agree clearly" rather than "neutral".
  if (signals.trendDirection === "UP") boost += 0.03 * agent.recencyWeight;
  else if (signals.trendDirection === "DOWN") boost -= 0.03 * agent.recencyWeight;

  // Native LLM read — Up/Down only (H2H/Gainer applied in Step 3 above).
  if (
    nativeAssessment &&
    Number.isFinite(nativeAssessment.probability) &&
    marketType !== "h2h" &&
    marketType !== "gainer"
  ) {
    const llmTilt = (nativeAssessment.probability - 0.5) * 2;
    boost += llmTilt * NATIVE_LLM_BOOST_WEIGHT * agent.recencyWeight;
  }

  return boost;
}

/**
 * Multi-window momentum adjustment for sharp-band agents.
 *
 * Reads 7d / 14d / 30d trend deltas (when populated by the sharp signal
 * fetcher) and returns an additional boost that captures one of three
 * patterns:
 *
 * • All three windows agree on direction → trend persistence. Add a
 *   confidence bump in the same direction (the move is real, not noise).
 * • 7d disagrees with 14d/30d → mean-reversion candidate. Dampen the
 *   short-window signal (the recent move is likely noise around a
 *   longer-term level).
 * • 7d agrees with 14d but disagrees with 30d → momentum acceleration.
 *   Modest bump in the short-window direction (the trend is fresh).
 *
 * Magnitudes are intentionally smaller than the base signal boost so this
 * adjusts rather than overrides — it's the kind of "second-order read" a
 * sharp punter does after looking at the chart.
 */
function computeMultiWindowAdjust(
  signals: TrendSignals,
  agent: AgentConfigData,
): number {
  const d7 = signals.scoreDelta7d ?? 0;
  const d14 = signals.scoreDelta14d;
  const d30 = signals.scoreDelta30d;

  if (d14 == null && d30 == null) return 0;

  const sign = (n: number): number => (n > 0.5 ? 1 : n < -0.5 ? -1 : 0);
  const s7 = sign(d7);
  const s14 = d14 != null ? sign(d14) : null;
  const s30 = d30 != null ? sign(d30) : null;

  const recency = agent.recencyWeight;

  if (s14 != null && s30 != null && s7 !== 0 && s7 === s14 && s7 === s30) {
    return 0.06 * s7 * recency;
  }

  if (s14 != null && s30 != null && s7 !== 0 && s7 !== s14 && s14 === s30) {
    return -0.05 * s7 * recency;
  }

  if (s14 != null && s7 !== 0 && s7 === s14 && (s30 == null || s30 !== s7)) {
    return 0.03 * s7 * recency;
  }

  return 0;
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

  // `scoreDelta7d` / `change24h` are PERCENTAGES (e.g. -3.3 for -3.3%), but the
  // archetype drifts below add their result straight onto a fameIndex anchor in
  // the hundreds of thousands. Added raw, every drift was worth a few points —
  // ~0.0005% of anchor — so all archetypes collapsed onto the same guess and
  // only the ±2% noise term below did any work. Convert to points against the
  // anchor so each archetype's stated intent actually moves the prediction.
  const delta7dPoints = anchor * (signals.scoreDelta7d / 100);
  const change24hPoints = anchor * (signals.change24h / 100);

  // Archetype-driven adjustments
  switch (agent.archetype) {
    case "momentum_chaser": {
      const momentum = delta7dPoints * agent.recencyWeight * 1.5;
      prediction += momentum;
      reasoning = `Extrapolated ${signals.scoreDelta7d > 0 ? "upward" : "downward"} trend (7d delta ${signals.scoreDelta7d.toFixed(1)}%)`;
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
      // Plan D — composite-only agents. Was wiki+news coefficients
      // (max ~±130). Replaced with a 24h-score-reaction signal: same
      // "reacts to short news cycles" identity, expressed via the
      // composite signal that already integrates news flow into the
      // score. The old ×30 coefficient existed only to inflate a raw
      // percentage into a visible point count; with the move already
      // converted to points it would overshoot by 30x.
      const reaction = change24hPoints * agent.recencyWeight;
      prediction += reaction;
      reasoning = `Reactive to 24h score move (${signals.change24h.toFixed(1)}%)`;
      break;
    }
    case "long_horizon": {
      const drift = delta7dPoints * 0.2 * (1 - agent.boldness);
      prediction += drift;
      reasoning = `Minimal change expected (long-horizon stable assumption)`;
      break;
    }
    case "recency_bias": {
      const recentMove = delta7dPoints * agent.recencyWeight * 2.0;
      prediction += recentMove;
      reasoning = `Heavily weighted recent movement (7d delta ${signals.scoreDelta7d.toFixed(1)}%)`;
      break;
    }
    case "domain_specialist": {
      const variance = domainMatch ? 0.3 : 1.0;
      const drift = delta7dPoints * variance * agent.recencyWeight;
      prediction += drift;
      reasoning = domainMatch
        ? `Domain match — tight prediction near current score`
        : `Outside specialty — wider spread`;
      break;
    }
    case "culture_tracker": {
      // Plan D — composite-only agents. Was wikiPulse-driven. Replaced
      // with `trendDirection` consensus (which already collapses
      // wiki + news + momentum into UP/DOWN/FLAT inside getTrendSignals).
      // Same "tracks cultural narrative direction" identity via the
      // composite signal.
      // The old +60 / -40 were absolute points from when fameIndex ran in the
      // thousands (see the `?? 5000` fallback in getTrendSignals); against a
      // ~700k anchor they were invisible. Kept as anchor-relative nudges that
      // preserve the original 3:2 up/down asymmetry.
      const directionBoost =
        signals.trendDirection === "UP" ? anchor * 0.006 :
        signals.trendDirection === "DOWN" ? anchor * -0.004 :
        0;
      const momentum = delta7dPoints * agent.recencyWeight;
      prediction += directionBoost + momentum;
      reasoning = `Cultural direction: ${signals.trendDirection}, momentum=${signals.scoreDelta7d.toFixed(1)}%`;
      break;
    }
    case "high_conviction": {
      const smallAdjust = delta7dPoints * 0.5;
      prediction += smallAdjust;
      reasoning = `High conviction — committed near current score with minor trend adjust`;
      break;
    }
    case "conservative": {
      const tinyDrift = delta7dPoints * 0.15;
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
      const defaultDrift = delta7dPoints * 0.5;
      prediction += defaultDrift;
      reasoning = `Default: anchored to current score with trend adjustment`;
    }
  }

  // Now that drifts scale with the anchor they also scale with outliers, and
  // ~15% of the roster carries a >30% weekly swing (100% observed). Left
  // unbounded, `recency_bias` (×2.0) would drive those guesses into the
  // 2,000,000 clamp below, where every agent lands on the identical number.
  // Bound the drift well past the p90 weekend move (~37%) so ordinary
  // archetype behaviour is untouched.
  const maxDrift = anchor * 0.4;
  prediction = anchor + Math.max(-maxDrift, Math.min(maxDrift, prediction - anchor));

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
