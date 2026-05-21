/**
 * Pure conviction follow-up logic for AMM Up/Down markets.
 *
 * Replaces the old AMM-price-delta trigger in `runConvictionSweep`.
 * Conviction fires when |pctChangeVsOpen| clears the weekly threshold
 * and the agent either doubles down (score agrees with held side) or
 * flips (score disagrees).
 */

import {
  CONVICTION_SCORE_THRESHOLD_PCT,
  CONVICTION_SCORE_AGREE_FLIP,
  CONVICTION_SCORE_DISAGREE_FLIP_BASE,
  CONVICTION_SCORE_DISAGREE_FLIP_CONTRARIAN,
} from "./constants";
import { productionRNG, type RNG } from "./prng";

export interface ConvictionEngineInput {
  anchorEntryId: string;
  upEntryId: string;
  downEntryId: string;
  pctChangeVsOpen: number;
  contrarianism: number;
}

export interface ConvictionEngineResult {
  chosenEntryId: string;
  doubled: boolean;
  scoreAgreesWithHold: boolean;
  flipApplied: boolean;
  confidence: number;
}

function scoreFavouredEntryId(
  pct: number,
  upEntryId: string,
  downEntryId: string,
): string | null {
  if (pct > CONVICTION_SCORE_THRESHOLD_PCT) return upEntryId;
  if (pct < -CONVICTION_SCORE_THRESHOLD_PCT) return downEntryId;
  return null;
}

/**
 * Decide a conviction follow-up buy from weekly-open score movement.
 * Returns null when |pctChangeVsOpen| is below threshold (flat zone).
 */
export function computeConvictionFollowUp(
  input: ConvictionEngineInput,
  rng: RNG = productionRNG,
): ConvictionEngineResult | null {
  const pct = input.pctChangeVsOpen;
  if (!Number.isFinite(pct) || Math.abs(pct) < CONVICTION_SCORE_THRESHOLD_PCT) {
    return null;
  }

  const favouredId = scoreFavouredEntryId(
    pct,
    input.upEntryId,
    input.downEntryId,
  );
  if (!favouredId) return null;

  const agrees =
    input.anchorEntryId === favouredId;
  const otherEntryId =
    input.anchorEntryId === input.upEntryId
      ? input.downEntryId
      : input.upEntryId;

  const contrarianBump =
    Math.max(0, Math.min(1, input.contrarianism)) *
    CONVICTION_SCORE_DISAGREE_FLIP_CONTRARIAN;

  let chosenEntryId = input.anchorEntryId;
  let flipApplied = false;

  if (agrees) {
    const flipChance =
      CONVICTION_SCORE_AGREE_FLIP + contrarianBump * 0.5;
    if (rng.nextFloat() < flipChance) {
      chosenEntryId = otherEntryId;
      flipApplied = true;
    }
  } else {
    const flipChance =
      CONVICTION_SCORE_DISAGREE_FLIP_BASE + contrarianBump;
    chosenEntryId = otherEntryId;
    flipApplied = true;
    if (rng.nextFloat() >= flipChance) {
      chosenEntryId = input.anchorEntryId;
      flipApplied = false;
    }
  }

  const confidence = Math.min(
    0.95,
    0.6 + Math.abs(pct),
  );

  return {
    chosenEntryId,
    doubled: chosenEntryId === input.anchorEntryId,
    scoreAgreesWithHold: agrees,
    flipApplied,
    confidence: parseFloat(confidence.toFixed(3)),
  };
}

export const _scoreFavouredEntryIdForTesting = scoreFavouredEntryId;
