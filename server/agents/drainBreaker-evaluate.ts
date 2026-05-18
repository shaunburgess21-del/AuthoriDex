/**
 * Pure decision helper for the drain breaker. Lives in its own module
 * with NO side-effect imports (no `../db`, no `../sentry`, no schema)
 * so unit tests can import the math without the rest of the app
 * dragging in a DB connection attempt at module-load time.
 *
 * See `drainBreaker.ts` for the live DB-reading shell that consumes
 * this helper.
 */

export interface DrainBreakerThresholds {
  /** Absolute 24h loss in credits beyond which the breaker trips
   *  regardless of relative size. */
  absoluteLossCapCredits: number;
  /** Fractional 24h loss vs. current house balance (0..1) beyond
   *  which the breaker trips regardless of absolute size. */
  pctLossCap: number;
}

export interface EvaluateDrainBreakerInput {
  /** Net house P&L over the past 24h. Negative = the house lost
   *  credits; positive = the house gained. */
  houseDelta24h: number;
  /** House wallet balance at evaluation time. */
  houseBalance: number;
  thresholds: DrainBreakerThresholds;
}

export interface EvaluateDrainBreakerOutput {
  trip: boolean;
  /** The applied trip threshold: `min(absCap, balance * pctCap)`
   *  with the pct half collapsed to +Infinity when balance == 0 (so
   *  the abs cap is the only constraint in that edge case). */
  thresholdApplied: number;
}

/**
 * Decide whether the drain breaker should trip.
 *
 * Strategy: take the SMALLER of the two thresholds so the breaker
 * fires on whichever guard is tighter:
 *
 *   - With an empty house balance the pct threshold collapses to 0;
 *     we widen it to +Infinity so the abs threshold carries the load.
 *   - With a huge house balance the pct expands above the abs cap,
 *     so the abs threshold carries the load.
 *   - In between, the tighter guard wins, which is exactly the
 *     defensive behaviour we want.
 *
 * Pure / deterministic / side-effect-free.
 */
export function evaluateDrainBreaker(
  input: EvaluateDrainBreakerInput,
): EvaluateDrainBreakerOutput {
  const { houseDelta24h, houseBalance, thresholds } = input;
  const pctThreshold = Math.max(0, houseBalance * thresholds.pctLossCap);
  const thresholdApplied = Math.min(
    thresholds.absoluteLossCapCredits,
    pctThreshold > 0 ? pctThreshold : Number.POSITIVE_INFINITY,
  );
  const lossMagnitude = -houseDelta24h;
  return {
    trip: lossMagnitude >= thresholdApplied,
    thresholdApplied,
  };
}
