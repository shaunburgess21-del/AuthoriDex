import { formatMarketLead, resolvePickContextLabel } from "./notification-market-labels";
import { formatVox } from "@shared/currency";

/** @deprecated Use resolvePickContextLabel from notification-market-labels. */
export { resolvePickContextLabel as resolvePositionMoveContextLabel };

/**
 * Pure helpers for the `position_move_alert` deriver.
 *
 * Extracted from `notifications-derivation.ts` so the threshold +
 * dust-position math and the user-facing wording can be exercised by
 * unit tests without touching the DB. Mirrors the pattern used by
 * `amm-resolver-notifications.ts`.
 *
 * Alerts fire on milestone crosses (20 / 50 / 100% |move|), not on a
 * timer while a position hovers above a single threshold.
 */

/** @deprecated Use POSITION_MOVE_MILESTONES — smallest milestone is 20%. */
export const POSITION_MOVE_PCT_THRESHOLD_DEFAULT = 20;

/** Absolute % move milestones; highest crossed milestone wins per tick. */
export const POSITION_MOVE_MILESTONES = [20, 50, 100] as const;

/**
 * Skip positions where the user's net credits in is less than this.
 * A 10-credit position swinging ±50% is statistical noise; surfacing
 * it just trains users to ignore the kind. The dust gate keeps every
 * surfaced alert worth reading.
 */
export const POSITION_MOVE_MIN_NOTIONAL_DEFAULT = 100;

export interface PositionMoveEvaluationInput {
  netCreditsIn: number;
  currentValue: number;
  minNotional?: number;
}

export interface PositionMoveEvaluationOutput {
  /** Direction relative to the user's entry. */
  direction: "up" | "down";
  /** Signed percentage move, e.g. +18.5 or -22.0. Rounded to 1 dp. */
  pctMove: number;
  /** Highest |pctMove| milestone in POSITION_MOVE_MILESTONES that was crossed. */
  milestone: number;
  /** Floored credit values for display. */
  netCreditsIn: number;
  currentValue: number;
}

/**
 * Returns the highest milestone in POSITION_MOVE_MILESTONES that
 * |pctMove| has reached, or null when below the smallest milestone.
 */
export function pickPositionMoveMilestone(pctMove: number): number | null {
  if (!Number.isFinite(pctMove)) return null;
  const abs = Math.abs(pctMove);
  let crossed: number | null = null;
  for (const m of POSITION_MOVE_MILESTONES) {
    if (abs >= m) crossed = m;
  }
  return crossed;
}

/**
 * Decide whether a single (user, market, entry) position qualifies for
 * a move-alert notification. Returns `null` when no milestone is
 * crossed, the position is dust, or inputs are degenerate.
 */
export function evaluatePositionMove(
  input: PositionMoveEvaluationInput,
): PositionMoveEvaluationOutput | null {
  const minNotional = input.minNotional ?? POSITION_MOVE_MIN_NOTIONAL_DEFAULT;
  const { netCreditsIn, currentValue } = input;

  if (!Number.isFinite(netCreditsIn) || !Number.isFinite(currentValue)) return null;
  if (netCreditsIn < minNotional) return null;
  if (netCreditsIn <= 0) return null;

  const rawPct = ((currentValue - netCreditsIn) / netCreditsIn) * 100;
  const pctMove = Math.round(rawPct * 10) / 10;
  const milestone = pickPositionMoveMilestone(pctMove);
  if (milestone === null) return null;

  return {
    direction: pctMove >= 0 ? "up" : "down",
    pctMove,
    milestone,
    netCreditsIn: Math.floor(netCreditsIn),
    currentValue: Math.floor(currentValue),
  };
}

export interface PositionMoveNotificationInput {
  /** Market title shown in the notification body. */
  marketTitle: string;
  /** Person name or entry side (e.g. UP) when it adds context beyond marketTitle. */
  contextLabel?: string | null;
  evaluation: PositionMoveEvaluationOutput;
}

export interface PositionMoveNotificationOutput {
  title: string;
  body: string;
}

/**
 * User-facing copy for an open-position move alert. Titles lead with
 * "Your position" so users read P&L first, not a celebrity name
 * (which would be confused with trend-score alerts). Body names the
 * market and stake → current sell value. Shows actual pctMove, not
 * the milestone bucket.
 */
export function buildPositionMoveNotification(
  input: PositionMoveNotificationInput,
): PositionMoveNotificationOutput {
  const { marketTitle, contextLabel, evaluation } = input;
  const { direction, pctMove, netCreditsIn, currentValue } = evaluation;

  const absPct = Math.abs(pctMove).toFixed(1);
  const title =
    direction === "up"
      ? `Your position is up +${absPct}%`
      : `Your position is down ${absPct}%`;

  const marketLead = formatMarketLead(marketTitle, contextLabel);
  const body =
    `${marketLead} · Staked ${formatVox(netCreditsIn)}, ` +
    `worth ${formatVox(currentValue)} now. Tap to review.`;

  return { title, body };
}
