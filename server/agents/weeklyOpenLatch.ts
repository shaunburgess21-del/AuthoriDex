/**
 * Weekly open decisive latch — read path + trailing-median trigger helpers.
 *
 * The latch disables contrarianism / weighted-random on up/down markets once
 * a person moves >= DECISIVE_WEEKLY_MOVE_PCT vs their 7d-median open baseline.
 * Revert-aware disarm (LATCH_REVERT_ENABLED) re-enables variance when the move
 * evaporates without mutating metadata.
 */

import {
  DECISIVE_WEEKLY_MOVE_PCT,
  DECISIVE_REVERT_PCT,
  isLatchRevertEnabled,
} from "./constants";

export type WeeklyOpenMetadata = {
  decisiveLatched?: boolean;
  peakAbsPctChangeVsOpen?: number;
};

export function readWeeklyOpen(
  meta: Record<string, unknown> | null | undefined,
): WeeklyOpenMetadata {
  const weeklyOpen = meta?.weeklyOpen;
  if (!weeklyOpen || typeof weeklyOpen !== "object") return {};
  return weeklyOpen as WeeklyOpenMetadata;
}

/** True when a previously latched market has reverted near flat. */
export function wouldDisarmLatch(
  meta: Record<string, unknown> | null | undefined,
  pctChangeVsOpen: number | undefined,
  revertPct = DECISIVE_REVERT_PCT,
): boolean {
  const weekly = readWeeklyOpen(meta);
  if (!weekly.decisiveLatched) return false;
  if (pctChangeVsOpen == null || !Number.isFinite(pctChangeVsOpen)) return false;
  return Math.abs(pctChangeVsOpen) < revertPct;
}

/**
 * Whether the market should be treated as having a decisive weekly move for
 * agent variance suppression (contrarianism / weighted-random skip).
 */
export function resolveDecisiveLatched(
  meta: Record<string, unknown> | null | undefined,
  pctChangeVsOpen: number | undefined,
  options?: { latchRevertEnabled?: boolean; revertPct?: number },
): boolean {
  const latchRevertEnabled = options?.latchRevertEnabled ?? isLatchRevertEnabled();
  const revertPct = options?.revertPct ?? DECISIVE_REVERT_PCT;

  if (latchRevertEnabled && wouldDisarmLatch(meta, pctChangeVsOpen, revertPct)) {
    return false;
  }

  const weekly = readWeeklyOpen(meta);
  if (weekly.decisiveLatched === true) return true;
  const peak = weekly.peakAbsPctChangeVsOpen ?? 0;
  if (peak >= DECISIVE_WEEKLY_MOVE_PCT) return true;
  if (
    pctChangeVsOpen != null &&
    Number.isFinite(pctChangeVsOpen) &&
    Math.abs(pctChangeVsOpen) >= DECISIVE_WEEKLY_MOVE_PCT
  ) {
    return true;
  }
  return false;
}

export function pctChangeVsOpenFromFame(
  fameIndex: number,
  openingScore: number,
): number | null {
  if (!Number.isFinite(fameIndex) || !Number.isFinite(openingScore) || openingScore <= 0) {
    return null;
  }
  return (fameIndex - openingScore) / openingScore;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function medianTrailingLatchPct(
  fameSamples: number[],
  openingScore: number,
): number | null {
  const pcts: number[] = [];
  for (const fame of fameSamples) {
    const pct = pctChangeVsOpenFromFame(fame, openingScore);
    if (pct != null) pcts.push(pct);
  }
  return median(pcts);
}

export function shouldLatchFromTrailingMedian(
  fameSamples: number[],
  openingScore: number,
  decisivePct = DECISIVE_WEEKLY_MOVE_PCT,
): { latch: boolean; medianPct: number | null } {
  const medianPct = medianTrailingLatchPct(fameSamples, openingScore);
  if (medianPct == null) return { latch: false, medianPct: null };
  return { latch: Math.abs(medianPct) >= decisivePct, medianPct };
}
