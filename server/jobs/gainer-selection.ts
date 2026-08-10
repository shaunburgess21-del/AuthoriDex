import {
  GAINER_ANCHOR_COUNT,
  GAINER_BAND_TIERS,
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
  /** True when the field was drawn from an opening-score band. */
  bandApplied: boolean;
  /** 0-based index into GAINER_BAND_TIERS when bandApplied; otherwise null. */
  bandTier: number | null;
  /**
   * max/min opening score of the band *pool* the field was drawn from.
   * Null when banding did not apply.
   */
  bandRatio: number | null;
  /**
   * max/min opening score of the final five-person field. Always set when
   * every runner has a positive opening score — this is what the
   * small-denominator audit should compare week to week.
   */
  fieldRatio: number | null;
  /** Size of the pool the field was drawn from. */
  poolSize: number;
};

export type GainerSelectionSkip = {
  ok: false;
  reason: "too_few_eligible";
  eligibleCount: number;
};

export type GainerSelectionResult = GainerSelectionSuccess | GainerSelectionSkip;

export type GainerBandPool = {
  personIds: string[];
  /** maxOpen / minOpen within the pool. */
  ratio: number;
  /** 0-based index into GAINER_BAND_TIERS. */
  tierIndex: number;
  maxOpen: number;
  minOpen: number;
};

/**
 * Lenient flag parser — matches warm-start / H2H prior so Railway `TRUE` works.
 */
function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * Master switch for opening-score band selection. Default OFF so a deploy is
 * a no-op until Monday generation after the flag is set.
 */
export function isGainerBandSelectionEnabled(): boolean {
  return envFlag(process.env.GAINER_BAND_SELECTION_ENABLED);
}

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
 * Contiguous opening-score windows that satisfy a single band tier.
 * Eligible ids are sorted high→low by opening score; each index is tried as
 * the high end of a window that expands while max/min ≤ maxRatio.
 *
 * Pure — exported for unit tests and the ops preview.
 */
export function findGainerBandPoolsForTier(
  eligibleIds: string[],
  openingById: Map<string, SnapshotScore>,
  tierIndex: number,
  maxRatio: number,
  minPool: number,
): GainerBandPool[] {
  const sorted = eligibleIds
    .map((id) => ({ id, score: openingById.get(id)?.score ?? 0 }))
    .filter((row) => row.score > 0 && Number.isFinite(row.score))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (sorted.length < minPool) return [];

  const pools: GainerBandPool[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (
      j + 1 < sorted.length &&
      sorted[i]!.score / sorted[j + 1]!.score <= maxRatio
    ) {
      j++;
    }
    const size = j - i + 1;
    if (size < minPool) continue;

    const personIds = sorted.slice(i, j + 1).map((r) => r.id);
    const key = personIds.join(",");
    if (seen.has(key)) continue;
    seen.add(key);

    const maxOpen = sorted[i]!.score;
    const minOpen = sorted[j]!.score;
    pools.push({
      personIds,
      ratio: maxOpen / minOpen,
      tierIndex,
      maxOpen,
      minOpen,
    });
  }

  return pools;
}

/**
 * Walk {@link GAINER_BAND_TIERS} in order and return the first tier that has
 * at least one qualifying pool. Returns null when no tier qualifies.
 */
export function findQualifyingGainerBandPools(
  eligibleIds: string[],
  openingById: Map<string, SnapshotScore>,
  tiers: readonly { maxRatio: number; minPool: number }[] = GAINER_BAND_TIERS,
): { tierIndex: number; pools: GainerBandPool[] } | null {
  for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
    const tier = tiers[tierIndex]!;
    const pools = findGainerBandPoolsForTier(
      eligibleIds,
      openingById,
      tierIndex,
      tier.maxRatio,
      tier.minPool,
    );
    if (pools.length > 0) {
      return { tierIndex, pools };
    }
  }
  return null;
}

function pickFieldFromPool(
  poolIds: string[],
  input: GainerSelectionInput,
  rng: ReturnType<typeof createPRNG>,
  bandMeta: {
    bandApplied: boolean;
    bandTier: number | null;
    bandRatio: number | null;
    poolSize: number;
  },
): GainerSelectionSuccess {
  if (poolIds.length < GAINER_FIELD_SIZE) {
    throw new Error(
      `[gainer-selection] pool has ${poolIds.length} people, need ≥${GAINER_FIELD_SIZE}`,
    );
  }

  const movementScores = computeMovementScores(
    poolIds,
    input.fameById,
    input.movementById,
  );

  // Highest fame in the pool; id tie-break keeps the choice deterministic
  // when two people share a fame_index (same pattern as the H2H fame sort).
  const anchorId = poolIds.reduce((best, id) => {
    const bestFame = input.fameById.get(best) ?? 0;
    const idFame = input.fameById.get(id) ?? 0;
    if (idFame > bestFame) return id;
    if (idFame < bestFame) return best;
    return id.localeCompare(best) < 0 ? id : best;
  }, poolIds[0]!);

  const moverPool = poolIds.filter((id) => id !== anchorId);
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

  const fieldRatioRaw = fieldOpeningRatio(personIds, input.openingById);

  return {
    ok: true,
    personIds,
    anchorId,
    moverIds: moversByScore,
    fieldRatio: fieldRatioRaw != null ? Number(fieldRatioRaw.toFixed(4)) : null,
    ...bandMeta,
  };
}

function fieldOpeningRatio(
  personIds: string[],
  openingById: Map<string, SnapshotScore>,
): number | null {
  const scores = personIds
    .map((id) => openingById.get(id)?.score)
    .filter((s): s is number => s != null && Number.isFinite(s) && s > 0);
  if (scores.length < 2) return null;
  return Math.max(...scores) / Math.min(...scores);
}

/**
 * Among qualifying pools at a tier, keep only those at the minimum ratio
 * (within a float epsilon). Maximal window expansion otherwise floods the
 * candidate list with large near-cap pools, and a uniform pick would undo
 * most of the compression the tiers are for.
 */
export function preferTightestBandPools(pools: GainerBandPool[]): GainerBandPool[] {
  if (pools.length <= 1) return pools;
  let minRatio = pools[0]!.ratio;
  for (const p of pools) {
    if (p.ratio < minRatio) minRatio = p.ratio;
  }
  return pools.filter((p) => p.ratio <= minRatio + 1e-9);
}

/**
 * Pick exactly {@link GAINER_FIELD_SIZE} runners: 1 fame anchor + 4 movement-weighted
 * movers (seeded per week+category). Deterministic for a given seed input.
 *
 * When band selection is enabled (or `forceBand` is set for previews), the
 * field is drawn from a compressed opening-score band when one qualifies;
 * otherwise falls back to the whole eligible category (pre-band behaviour).
 */
export function selectGainerField(
  input: GainerSelectionInput,
  options?: { forceBand?: boolean },
): GainerSelectionResult {
  const eligibleIds = filterGainerEligible(input);
  if (eligibleIds.length < GAINER_MIN_ELIGIBLE) {
    return { ok: false, reason: "too_few_eligible", eligibleCount: eligibleIds.length };
  }

  const seed = hashGainerSelectionSeed(input.weekNumber, input.category);
  const rng = createPRNG(seed);
  const useBand = options?.forceBand === true || isGainerBandSelectionEnabled();

  if (useBand) {
    const qualifying = findQualifyingGainerBandPools(eligibleIds, input.openingById);
    if (qualifying && qualifying.pools.length > 0) {
      const tightest = preferTightestBandPools(qualifying.pools);
      const pickIdx = Math.floor(rng.nextFloat() * tightest.length);
      const band = tightest[Math.min(pickIdx, tightest.length - 1)]!;
      return pickFieldFromPool(band.personIds, input, rng, {
        bandApplied: true,
        bandTier: band.tierIndex,
        bandRatio: Number(band.ratio.toFixed(4)),
        poolSize: band.personIds.length,
      });
    }
  }

  // Fallback: whole-category selection (legacy path, or band found nothing).
  return pickFieldFromPool(eligibleIds, input, rng, {
    bandApplied: false,
    bandTier: null,
    bandRatio: null,
    poolSize: eligibleIds.length,
  });
}
