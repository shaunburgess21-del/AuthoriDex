import {
  ANCHORED_ANCHOR_COUNT,
  ANCHORED_MOVER_COUNT,
  ANCHORED_MOVER_RANK_RANGE,
  ANCHORED_WILDCARD_COUNT,
  ANCHORED_WILDCARD_RANK_RANGE,
  GAINER_MOVEMENT_MIN_SAMPLES,
} from "@shared/constants";
import { createPRNG } from "../agents/prng";
import type { GainerMovementStat } from "./gainer-movement-stats";
import { weightedSampleWithoutReplacement } from "./weighted-sample";

export type AnchoredMarketType = "jackpot" | "updown";

export type AnchoredSelectionPerson = {
  id: string;
};

export type AnchoredSelectionInput = {
  people: AnchoredSelectionPerson[];
  fameById: Map<string, number>;
  momentumById: Map<string, GainerMovementStat>;
  weekNumber: number;
  marketType: AnchoredMarketType;
  anchorCount?: number;
  moverCount?: number;
  wildcardCount?: number;
  moverRankRange?: readonly [number, number];
  wildcardRankRange?: readonly [number, number];
};

export type AnchoredSelectionResult = {
  anchors: string[];
  movers: string[];
  wildcards: string[];
  all: string[];
};

export function hashAnchoredSelectionSeed(weekNumber: number, marketType: string): number {
  const input = `${weekNumber}:${marketType}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max <= min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

function idsInRankRange(
  rankedIds: string[],
  used: Set<string>,
  [lo, hi]: readonly [number, number],
): string[] {
  return rankedIds.slice(lo - 1, hi).filter((id) => !used.has(id));
}

function hasMomentumForMover(stat: GainerMovementStat | undefined): stat is GainerMovementStat {
  if (!stat) return false;
  return stat.sampleCount >= GAINER_MOVEMENT_MIN_SAMPLES;
}

function computeWildcardWeights(
  pool: string[],
  fameById: Map<string, number>,
): Map<string, number> {
  const weights = new Map<string, number>();
  if (pool.length === 0) return weights;
  const fameValues = pool.map((id) => fameById.get(id) ?? 0);
  const normFame = minMaxNormalize(fameValues);
  pool.forEach((id, i) => {
    weights.set(id, Math.max(1 - normFame[i], 1e-6));
  });
  return weights;
}

function buildMoverWeights(
  pool: string[],
  momentumById: Map<string, GainerMovementStat>,
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const id of pool) {
    const stat = momentumById.get(id);
    if (hasMomentumForMover(stat)) {
      weights.set(id, Math.max(stat.momentum7d, 1e-6));
    } else {
      weights.set(id, 1e-6);
    }
  }
  return weights;
}

/**
 * Pick a weekly field: fixed top-N anchors + momentum-weighted movers +
 * lower-fame wildcards. Seeded per week + marketType so jackpot and updown
 * share anchors but rotate different movers/wildcards.
 */
export function selectAnchoredField(input: AnchoredSelectionInput): AnchoredSelectionResult {
  const anchorCount = input.anchorCount ?? ANCHORED_ANCHOR_COUNT;
  const moverCount = input.moverCount ?? ANCHORED_MOVER_COUNT;
  const wildcardCount = input.wildcardCount ?? ANCHORED_WILDCARD_COUNT;
  const moverRange = input.moverRankRange ?? ANCHORED_MOVER_RANK_RANGE;
  const wildcardRange = input.wildcardRankRange ?? ANCHORED_WILDCARD_RANK_RANGE;

  const sorted = [...input.people].sort((a, b) => {
    const fameA = input.fameById.get(a.id) ?? 0;
    const fameB = input.fameById.get(b.id) ?? 0;
    if (fameB !== fameA) return fameB - fameA;
    return a.id.localeCompare(b.id);
  });

  const rankedIds = sorted.map((p) => p.id);
  const used = new Set<string>();

  const anchors: string[] = [];
  for (let i = 0; i < Math.min(anchorCount, rankedIds.length); i++) {
    anchors.push(rankedIds[i]);
    used.add(rankedIds[i]);
  }

  const moverPool = idsInRankRange(rankedIds, used, moverRange);
  const moverEligible = moverPool.filter((id) => hasMomentumForMover(input.momentumById.get(id)));

  let moverSource =
    moverEligible.length >= moverCount
      ? moverEligible
      : moverPool.filter((id) => !used.has(id));

  if (moverSource.length < moverCount) {
    const padFromWildcards = idsInRankRange(rankedIds, used, wildcardRange).filter(
      (id) => !moverSource.includes(id),
    );
    moverSource = [...moverSource, ...padFromWildcards];
  }

  const seed = hashAnchoredSelectionSeed(input.weekNumber, input.marketType);
  const rng = createPRNG(seed);

  const moversAvailable = moverSource.filter((id) => !used.has(id));
  const movers = weightedSampleWithoutReplacement(
    moversAvailable,
    buildMoverWeights(moversAvailable, input.momentumById),
    Math.min(moverCount, moversAvailable.length),
    rng,
  );
  for (const id of movers) used.add(id);

  let wildcardPool = idsInRankRange(rankedIds, used, wildcardRange);
  if (wildcardPool.length < wildcardCount) {
    const remaining = rankedIds.filter((id) => !used.has(id) && !wildcardPool.includes(id));
    wildcardPool = [...wildcardPool, ...remaining];
  }

  const wildcards = weightedSampleWithoutReplacement(
    wildcardPool,
    computeWildcardWeights(wildcardPool, input.fameById),
    Math.min(wildcardCount, wildcardPool.length),
    rng,
  );

  const all = [...anchors, ...movers, ...wildcards];
  return { anchors, movers, wildcards, all };
}
