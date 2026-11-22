/**
 * Newly settled bets for the vote-strip reveal. Parses the same
 * /api/me/predictions payload the strip already caches.
 */

import { settledAfterLastSeen, type SettledPredictionRow } from "@/lib/returningUserStrip";
import type { SettledBetAmounts } from "@/lib/resolvedBetCopy";

export interface ResolvedRevealRow extends SettledBetAmounts, SettledPredictionRow {
  betId: string;
  marketTitle: string;
  marketSlug: string;
  entryLabel: string;
  personName: string | null;
  personAvatar: string | null;
  baselineScore: number;
  currentScore: number;
  marketCategory: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Accepts `{ predictions }` and a legacy bare array. Drops rows with no id. */
export function revealRowsFromPredictionsResponse(data: unknown): ResolvedRevealRow[] {
  const list = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        "predictions" in data &&
        Array.isArray((data as { predictions: unknown }).predictions)
      ? (data as { predictions: unknown[] }).predictions
      : [];
  const rows: ResolvedRevealRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const betId = str(row.betId);
    if (!betId) continue;
    rows.push({
      betId,
      result: str(row.result),
      settledAt: typeof row.settledAt === "string" ? row.settledAt : null,
      stakeAmount: num(row.stakeAmount),
      payout: num(row.payout),
      marketTitle: str(row.marketTitle) || "Prediction",
      marketSlug: str(row.marketSlug),
      entryLabel: str(row.entryLabel),
      personName: nullableStr(row.personName),
      personAvatar: nullableStr(row.personAvatar),
      baselineScore: num(row.baselineScore),
      currentScore: num(row.currentScore),
      marketCategory: str(row.marketCategory),
    });
  }
  return rows;
}

export function newlyResolvedRevealRows(
  rows: readonly ResolvedRevealRow[],
  lastSeenAtMs: number | null,
): ResolvedRevealRow[] {
  return rows.filter((row) => settledAfterLastSeen(row, lastSeenAtMs));
}
