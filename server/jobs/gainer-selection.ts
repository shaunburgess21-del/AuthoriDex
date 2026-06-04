import {
  GAINER_ANCHOR_COUNT,
  GAINER_FIELD_SIZE,
  GAINER_MIN_ELIGIBLE,
  GAINER_MOVER_COUNT,
  GAINER_MOVEMENT_MIN_SAMPLES,
  GAINER_SCORE_WEIGHT_LOWER_BASE,
  GAINER_SCORE_WEIGHT_MOMENTUM,
  GAINER_SCORE_WEIGHT_VOLATILITY,
} from "@shared/constants";
import { createPRNG } from "../agents/prng";
import type { SnapshotScore } from "../native-markets/openingScores";
import type { GainerMovementStat } from "./gainer-movement-stats";
import { weightedSampleWithoutReplacement } from "./weighted-sample";

export type GainerSelectionPerson = {
  id: string;
};

export type GainerSelectionInput = {
  people: GainerSelectionPerson[];
  fameById: Map<string, number>;
  openingById: Map<string, SnapshotScore>;
  movementById: Map<string, GainerMovementStat>;
  weekNumber: number;
  category: string;
};

export type GainerSelectionSuccess = {
  ok: true;
  personIds: string[];
  anchorId: string;
  moverIds: string[];
};

export type GainerSelectionSkip = {
  ok: false;
  reason: "too_few_eligible";
  eligibleCount: number;
};

export type GainerSelectionResult = GainerSelectionSuccess | GainerSelectionSkip;

export function hashGainerSelectionSeed(weekNumber: number, category: string): number {
  const input = `${weekNumber}:${category}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isOpeningEligible(snap: SnapshotScore | undefined): snap is SnapshotScore {
  if (!snap) return false;
  if (snap.windowMethod === "latest_tick") return false;
  return true;
}

function isMovementEligible(stat: GainerMovementStat | undefined): stat is GainerMovementStat {
  if (!stat) return false;
  return stat.sampleCount >= GAINER_MOVEMENT_MIN_SAMPLES;
}

export function filterGainerEligible(input: GainerSelectionInput): string[] {
  return input.people
    .map((p) => p.id)
    .filter((id) => {
      return (
        isOpeningEligible(input.openingById.get(id)) &&
        isMovementEligible(input.movementById.get(id))
      );
    });
}

function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max <= min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

export function computeMovementScores(
  eligibleIds: string[],
  fameById: Map<string, number>,
  movementById: Map<string, GainerMovementStat>,
): Map<string, number> {
  const scores = new Map<string, number>();
  if (eligibleIds.length === 0) return scores;

  const stddevs = eligibleIds.map((id) => movementById.get(id)!.stddev30d);
  const momenta = eligibleIds.map((id) => movementById.get(id)!.momentum7d);
  const fameValues = eligibleIds.map((id) => fameById.get(id) ?? 0);

  const normVol = minMaxNormalize(stddevs);
  const normMom = minMaxNormalize(momenta);
  const normFame = minMaxNormalize(fameValues);
  const lowerBase = normFame.map((f) => 1 - f);

  eligibleIds.forEach((id, i) => {
    const movementScore =
      normVol[i] * GAINER_SCORE_WEIGHT_VOLATILITY +
      normMom[i] * GAINER_SCORE_WEIGHT_MOMENTUM +
      lowerBase[i] * GAINER_SCORE_WEIGHT_LOWER_BASE;
    scores.set(id, Math.max(movementScore, 1e-6));
  });

  return scores;
}

/**
 * Pick exactly {@link GAINER_FIELD_SIZE} runners: 1 fame anchor + 4 movement-weighted
 * movers (seeded per week+category). Deterministic for a given seed input.
 */
export function selectGainerField(input: GainerSelectionInput): GainerSelectionResult {
  const eligibleIds = filterGainerEligible(input);
  if (eligibleIds.length < GAINER_MIN_ELIGIBLE) {
    return { ok: false, reason: "too_few_eligible", eligibleCount: eligibleIds.length };
  }

  const movementScores = computeMovementScores(
    eligibleIds,
    input.fameById,
    input.movementById,
  );

  const anchorId = eligibleIds.reduce((best, id) => {
    const bestFame = input.fameById.get(best) ?? 0;
    const idFame = input.fameById.get(id) ?? 0;
    return idFame > bestFame ? id : best;
  }, eligibleIds[0]);

  const moverPool = eligibleIds.filter((id) => id !== anchorId);
  const seed = hashGainerSelectionSeed(input.weekNumber, input.category);
  const rng = createPRNG(seed);
  const moverIds = weightedSampleWithoutReplacement(
    moverPool,
    movementScores,
    GAINER_MOVER_COUNT,
    rng,
  );

  if (GAINER_ANCHOR_COUNT !== 1) {
    throw new Error(`[gainer-selection] GAINER_ANCHOR_COUNT must be 1, got ${GAINER_ANCHOR_COUNT}`);
  }

  const moversByScore = [...moverIds].sort(
    (a, b) => (movementScores.get(b) ?? 0) - (movementScores.get(a) ?? 0),
  );

  const personIds = [anchorId, ...moversByScore];
  if (personIds.length !== GAINER_FIELD_SIZE) {
    throw new Error(
      `[gainer-selection] expected ${GAINER_FIELD_SIZE} runners, got ${personIds.length}`,
    );
  }

  return { ok: true, personIds, anchorId, moverIds: moversByScore };
}
