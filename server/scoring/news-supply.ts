/**
 * News "share-of-voice" supply correction (cohort-level, flag-gated).
 *
 * The news slots are ~39% of the fameIndex and consume absolute article
 * counts. When the whole cohort's article supply shifts together — a provider
 * quota lapse, an outage, or the ordinary mid-week publishing wave — every
 * person's news signal moves in the same direction at once, synchronising the
 * leaderboard. Wikipedia (an independent signal) does not do this.
 *
 * The fix re-expresses each person's news input relative to the cohort's
 * supply level for the tick, then rescales it back onto the familiar count
 * scale using a stable reference level so nothing downstream changes units:
 *
 *   factorVolume        = clamp(S_ref / S_now,   MIN, MAX)   // 24h supply
 *   factorMomentumDenom = clamp(S_ref / S_avg7d, MIN, MAX)   // 7d supply
 *
 * where
 *   S_now   = cohort mean per-person 24h news count for the current tick
 *   S_avg7d = cohort mean per-person 7d-average news count for the current tick
 *   S_ref   = reference cohort news level (trailing news-window mean of the
 *             persisted `trend_snapshots.news_count`)
 *
 * The volume slot input becomes `newsCountForScoring * factorVolume`, and the
 * momentum denominator becomes `news7dForScoring * factorMomentumDenom`. Since
 * the corrected 24h value also feeds the momentum numerator, the momentum
 * ratio collapses (by construction) to the supply-corrected double ratio
 * `(person 24h / person 7d) / (cohort 24h / cohort 7d)` — i.e. "did this
 * person gain attention relative to everyone else", not "did the news industry
 * publish more today".
 *
 * Properties:
 *  - Cross-person ordering within a tick is unchanged (uniform scalar).
 *  - In a supply-stable week both factors are ~1.0, so enabling the flag causes
 *    a negligible instantaneous level shift (safe to flip at a week boundary).
 *  - The persisted `news_count` stays RAW — this only rescales the values fed
 *    to `computeTrendScore`, so rollback is a clean flag flip.
 *  - Clamped to [MIN, MAX] so a catastrophic supply collapse can't blow the
 *    score up; that regime is additionally covered by the baseline cohort
 *    guard and the provider-dark ops alert.
 */

import { sql } from "drizzle-orm";
import { getRollingWindowDaysNews } from "./normalize";

function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function envNumber(value: string | undefined, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : fallback;
}

/** Master switch. Default OFF — set NEWS_SOV_ENABLED=true to enable. */
export const NEWS_SOV_ENABLED =
  process.env.NEWS_SOV_ENABLED === undefined
    ? false
    : envFlag(process.env.NEWS_SOV_ENABLED);

/** Lower/upper clamp on the supply correction factor. */
export const NEWS_SOV_MIN_FACTOR = envNumber(process.env.NEWS_SOV_MIN_FACTOR, 0.5);
export const NEWS_SOV_MAX_FACTOR = envNumber(process.env.NEWS_SOV_MAX_FACTOR, 2.5);

/**
 * Minimum cohort size for the correction to run. Below this the cohort mean is
 * too noisy to trust as a supply estimate, so we no-op (factors = 1).
 */
export const NEWS_SOV_MIN_COHORT = Math.max(
  1,
  Math.floor(envNumber(process.env.NEWS_SOV_MIN_COHORT, 20)),
);

export type NewsSupplyFactorInputs = {
  /** S_now — cohort mean per-person 24h news count this tick. */
  supplyNow: number;
  /** S_avg7d — cohort mean per-person 7d-average news count this tick. */
  supply7d: number;
  /** S_ref — reference cohort news level (trailing news-window mean). */
  supplyRef: number;
  /** Number of people contributing to the cohort means. */
  cohortSize: number;
};

export type NewsSupplyFactorReason =
  | "disabled"
  | "cohort_too_small"
  | "no_reference"
  | "no_current_supply"
  | "applied";

export type NewsSupplyFactorResult = {
  enabled: boolean;
  /** True only when a real (non-1) correction was computed and should apply. */
  applied: boolean;
  reason: NewsSupplyFactorReason;
  factorVolume: number;
  factorMomentumDenom: number;
  supplyNow: number;
  supply7d: number;
  supplyRef: number;
  cohortSize: number;
};

export type NewsSupplyThresholds = {
  enabled?: boolean;
  minFactor?: number;
  maxFactor?: number;
  minCohort?: number;
};

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/** Mean of the finite values (zeros included — they are real low supply). */
export function cohortMean(values: number[]): number {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Pure factor computation — no DB access. Returns `applied: false` with both
 * factors pinned to 1 whenever the correction should be a no-op (disabled,
 * cohort too small, or a degenerate supply estimate).
 */
export function computeNewsSupplyFactors(
  inputs: NewsSupplyFactorInputs,
  thresholds: NewsSupplyThresholds = {},
): NewsSupplyFactorResult {
  const enabled = thresholds.enabled ?? NEWS_SOV_ENABLED;
  const minFactor = thresholds.minFactor ?? NEWS_SOV_MIN_FACTOR;
  const maxFactor = thresholds.maxFactor ?? NEWS_SOV_MAX_FACTOR;
  const minCohort = thresholds.minCohort ?? NEWS_SOV_MIN_COHORT;

  const base = {
    enabled,
    factorVolume: 1,
    factorMomentumDenom: 1,
    supplyNow: inputs.supplyNow,
    supply7d: inputs.supply7d,
    supplyRef: inputs.supplyRef,
    cohortSize: inputs.cohortSize,
  };

  if (!enabled) {
    return { ...base, applied: false, reason: "disabled" };
  }
  if (inputs.cohortSize < minCohort) {
    return { ...base, applied: false, reason: "cohort_too_small" };
  }
  if (!Number.isFinite(inputs.supplyRef) || inputs.supplyRef <= 0) {
    return { ...base, applied: false, reason: "no_reference" };
  }
  if (!Number.isFinite(inputs.supplyNow) || inputs.supplyNow <= 0) {
    return { ...base, applied: false, reason: "no_current_supply" };
  }

  const factorVolume = clamp(inputs.supplyRef / inputs.supplyNow, minFactor, maxFactor);
  const factorMomentumDenom =
    Number.isFinite(inputs.supply7d) && inputs.supply7d > 0
      ? clamp(inputs.supplyRef / inputs.supply7d, minFactor, maxFactor)
      : 1;

  return {
    ...base,
    applied: true,
    reason: "applied",
    factorVolume,
    factorMomentumDenom,
  };
}

/**
 * Reference cohort news supply level: the mean of the persisted
 * `trend_snapshots.news_count` over the trailing news window (hourly ingest
 * snapshots only). This is the same population + window that anchors the news
 * percentile stats, so the correction rescales onto the exact count scale the
 * velocity slot already expects. Returns 0 when there is no history.
 */
export async function queryReferenceNewsSupply(windowDays?: number): Promise<number> {
  const days = windowDays ?? getRollingWindowDaysNews();
  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    // Lazy import keeps the pure factor math importable without a live DB
    // (unit tests, audit tooling) — db.ts throws at import when DATABASE_URL
    // is unset.
    const { db } = await import("../db");
    const result = await db.execute(sql`
      SELECT AVG(news_count)::float AS ref
      FROM trend_snapshots
      WHERE snapshot_origin = 'ingest'
        AND timestamp = date_trunc('hour', timestamp)
        AND news_count IS NOT NULL
        AND timestamp >= ${windowStart}
    `);
    const row = (result.rows ?? [])[0] as { ref?: number | null } | undefined;
    return row && row.ref != null && Number.isFinite(Number(row.ref)) ? Number(row.ref) : 0;
  } catch {
    return 0;
  }
}

export function formatNewsSupplyLogLine(result: NewsSupplyFactorResult): string {
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "n/a");
  return (
    `[NewsSupplySoV] enabled=${result.enabled} applied=${result.applied} ` +
    `reason=${result.reason} factorVolume=${f(result.factorVolume)} ` +
    `factorMomentumDenom=${f(result.factorMomentumDenom)} ` +
    `supplyNow=${f(result.supplyNow)} supply7d=${f(result.supply7d)} ` +
    `supplyRef=${f(result.supplyRef)} cohort=${result.cohortSize}`
  );
}
