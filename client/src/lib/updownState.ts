/**
 * Single source of truth for "is the user winning right now?" on Up/Down
 * markets. Aligned with the server-side resolver in
 * `server/jobs/market-resolver.ts` (`resolveUpDown`):
 *
 *   1. baseline := the market's open snapshot (== `baselineScore` on the
 *      client). Server compares `closeSnap.score` vs `openSnap.score`;
 *      we mirror that as `currentScore` vs `baselineScore`.
 *   2. closeSnap > openSnap  → UP wins.
 *   3. closeSnap < openSnap  → DOWN wins.
 *   4. closeSnap === openSnap → tieRule decides:
 *         "up_wins"   → UP wins
 *         "down_wins" → DOWN wins
 *         "refund"    → market voids (neither side is "winning")
 *
 * Three components used to disagree on this rule (sticky bar in
 * `UpDownDetailPage`, `UpDownBody` in `MyPositionCard`, and
 * `WhatNeedsToHappen`). They now all funnel through these helpers so the
 * UI never tells the user three different things at once.
 */

export type UpDownPick = "up" | "down";
export type UpDownTieRule = "refund" | "up_wins" | "down_wins" | string;
export type UpDownState = "winning" | "tied" | "behind";

export interface UpDownStateInput {
  pick: UpDownPick;
  currentScore: number;
  baselineScore: number;
  tieRule?: UpDownTieRule | null;
}

export type UpDownLeader = "up_leads" | "tied" | "down_leads";

export function getUpDownLeader(
  currentScore: number,
  baselineScore: number,
): UpDownLeader {
  if (currentScore > baselineScore) return "up_leads";
  if (currentScore < baselineScore) return "down_leads";
  return "tied";
}

export function getUpDownWinningState({
  pick,
  currentScore,
  baselineScore,
  tieRule = "refund",
}: UpDownStateInput): UpDownState {
  const leader = getUpDownLeader(currentScore, baselineScore);

  if (leader === "tied") {
    if (tieRule === "up_wins") return pick === "up" ? "winning" : "behind";
    if (tieRule === "down_wins") return pick === "down" ? "winning" : "behind";
    // "refund" (or unknown) → market would void at tie. Neither side is
    // currently winning, so we surface a dedicated "tied" state instead
    // of pretending one side is ahead.
    return "tied";
  }

  const leadingPick: UpDownPick = leader === "up_leads" ? "up" : "down";
  return leadingPick === pick ? "winning" : "behind";
}

export const UP_DOWN_STATE_LABELS: Record<UpDownState, string> = {
  winning: "Winning",
  tied: "Tied",
  behind: "Behind",
};
