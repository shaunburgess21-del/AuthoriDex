import { formatMarketLead, resolvePickContextLabel } from "./notification-market-labels";

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
 * The deriver loads open AMM positions, calls `evaluatePositionMove`
 * for each row, and (if the result is non-null) fires a notification
 * built by `buildPositionMoveNotification`.
 */

/**
 * Minimum absolute % move (|currentValue - netCreditsIn| / netCreditsIn)
 * required before we surface the alert. Conservative by design — moves
 * happen all day and we don't want the panel turning into a stock
 * ticker. Tunable per-deploy via the constant in the deriver file.
 */
export const POSITION_MOVE_PCT_THRESHOLD_DEFAULT = 15;

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
  pctThreshold?: number;
  minNotional?: number;
}

export interface PositionMoveEvaluationOutput {
  /** Direction relative to the user's entry. */
  direction: "up" | "down";
  /** Signed percentage move, e.g. +18.5 or -22.0. Rounded to 1 dp. */
  pctMove: number;
  /** Floored credit values for display. */
  netCreditsIn: number;
  currentValue: number;
}

/**
 * Decide whether a single (user, market, entry) position qualifies for
 * a move-alert notification. Returns `null` to mean "no notification" —
 * either the move is below threshold, the position is dust, or the
 * inputs are degenerate (e.g. zero cost basis from a fully-sold-out
 * row that somehow stayed in the open set).
 */
export function evaluatePositionMove(
  input: PositionMoveEvaluationInput,
): PositionMoveEvaluationOutput | null {
  const pctThreshold = input.pctThreshold ?? POSITION_MOVE_PCT_THRESHOLD_DEFAULT;
  const minNotional = input.minNotional ?? POSITION_MOVE_MIN_NOTIONAL_DEFAULT;
  const { netCreditsIn, currentValue } = input;

  if (!Number.isFinite(netCreditsIn) || !Number.isFinite(currentValue)) return null;
  if (netCreditsIn < minNotional) return null;
  if (netCreditsIn <= 0) return null;

  const rawPct = ((currentValue - netCreditsIn) / netCreditsIn) * 100;
  const pctMove = Math.round(rawPct * 10) / 10;

  if (Math.abs(pctMove) < pctThreshold) return null;

  return {
    direction: pctMove >= 0 ? "up" : "down",
    pctMove,
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
 * market and stake → current sell value with an unrealized hint.
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
    `${marketLead} · Staked ${netCreditsIn.toLocaleString("en-US")} cr, ` +
    `worth ${currentValue.toLocaleString("en-US")} cr now (unrealized). Tap to review.`;

  return { title, body };
}
