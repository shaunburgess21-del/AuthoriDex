/**
 * Phase 10 — agent sizing for AMM markets.
 *
 * Translates a `PredictionDecision` confidence (target probability for the
 * chosen outcome) into a credit budget that walks the AMM price toward
 * confidence and stops there. The output is fed straight into
 * `executeBuy({creditBudget})` from `server/services/amm-trades.ts`.
 *
 * Sizing rules (in order):
 *   1. If current price is already at/above confidence → 0 (no edge,
 *      agent abstains). One human heuristic: real traders don't take
 *      a position at the equilibrium price they themselves believe in.
 *   2. Compute targetPrice = min(confidence, currentPrice + EDGE_BAND).
 *      EDGE_BAND caps the per-trade move so a single agent can never
 *      lift price by more than ~10pp on a fresh market — important for
 *      Phase 10 where the whole cohort wakes simultaneously.
 *   3. Binary-search the integer credit budget in [minBudget, maxBudget]
 *      using `quoteBuy` to find the largest budget whose post-trade
 *      price stays at or below targetPrice.
 *
 * Pure function — caller passes the live AmmStateSnapshot. Tested against
 * the same `quoteBuy` semantics the worker uses, so what we size for is
 * what we get charged.
 */

import {
  type AmmStateSnapshot,
  currentPrices,
  quoteBuy,
} from "@shared/lib/amm/positions";

/** Maximum probability move a single agent trade may produce. Keeps the
 *  cohort wake (Phase 10) from immediately pushing every binary market
 *  to 90/10 in the first sweep. Tunable later if we want sharper sharps. */
export const DEFAULT_AGENT_EDGE_BAND = 0.10;

/** Tiny slop on the "no edge" comparison — protects against rounding
 *  artifacts where current price is already 0.4999... and confidence is
 *  0.5. Below this delta we treat the bet as no-EV and return 0. */
const EDGE_EPSILON = 0.005;

export interface SizeAmmBudgetInput {
  state: AmmStateSnapshot;
  entryId: string;
  /** Agent's predicted probability for `entryId` winning, in [0, 1]. */
  confidence: number;
  /** Upper bound on the trade size, in integer credits. Comes from the
   *  existing `computeAgentStakeAmount` so persona caps still apply. */
  maxBudget: number;
  /** Lower bound on a viable trade. Defaults to `MIN_AMM_BUY_CREDITS`
   *  so we never schedule a trade the trade endpoint would reject. */
  minBudget?: number;
  /** Override the default per-trade price-move cap (mostly for tests). */
  edgeBand?: number;
}

export interface SizeAmmBudgetResult {
  /** Integer credit budget to pass into `executeBuy`. 0 means "skip". */
  creditBudget: number;
  /** The current price observed when sizing — useful for logging. */
  currentPrice: number;
  /** The targetPrice (capped by edgeBand) we sized toward. */
  targetPrice: number;
  /** Why we returned 0 (when we did). undefined on a sized trade. */
  abstainReason?: "no_edge" | "below_min_budget" | "invalid_confidence";
}

/**
 * Pick the credit budget that walks the AMM price for `entryId` toward
 * `confidence` and stops there. Returns 0 with a reason when no viable
 * trade exists.
 */
export function sizeAmmBudget(input: SizeAmmBudgetInput): SizeAmmBudgetResult {
  const {
    state,
    entryId,
    confidence,
    maxBudget,
    minBudget = 5,
    edgeBand = DEFAULT_AGENT_EDGE_BAND,
  } = input;

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return {
      creditBudget: 0,
      currentPrice: 0,
      targetPrice: 0,
      abstainReason: "invalid_confidence",
    };
  }

  const cur = currentPrices(state)[entryId] ?? 0;

  if (confidence <= cur + EDGE_EPSILON) {
    return {
      creditBudget: 0,
      currentPrice: cur,
      targetPrice: cur,
      abstainReason: "no_edge",
    };
  }

  const targetPrice = Math.min(confidence, cur + edgeBand);

  if (
    !Number.isInteger(maxBudget) ||
    maxBudget < minBudget ||
    !Number.isInteger(minBudget) ||
    minBudget < 1
  ) {
    return {
      creditBudget: 0,
      currentPrice: cur,
      targetPrice,
      abstainReason: "below_min_budget",
    };
  }

  // Fast path: if dumping the full budget still leaves us at or below
  // targetPrice, we're confidence-limited not edge-limited — use it all.
  const fullQuote = quoteBuy(state, entryId, maxBudget);
  if (fullQuote.shares === 0) {
    return {
      creditBudget: 0,
      currentPrice: cur,
      targetPrice,
      abstainReason: "below_min_budget",
    };
  }
  const fullNewPrice = fullQuote.newPrices[entryId] ?? 0;
  if (fullNewPrice <= targetPrice) {
    return { creditBudget: maxBudget, currentPrice: cur, targetPrice };
  }

  // Binary search the largest integer budget that keeps post-trade
  // price <= targetPrice. ~24 iterations is overkill for an integer
  // search across [5, 300] but it's <0.1ms total and future-proofs
  // against larger maxBudget caps.
  let lo = minBudget;
  let hi = maxBudget;
  let best = 0;
  for (let i = 0; i < 24 && lo <= hi; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const q = quoteBuy(state, entryId, mid);
    if (q.shares === 0) {
      lo = mid + 1;
      continue;
    }
    const np = q.newPrices[entryId] ?? 0;
    if (np <= targetPrice) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best < minBudget) {
    return {
      creditBudget: 0,
      currentPrice: cur,
      targetPrice,
      abstainReason: "below_min_budget",
    };
  }
  return { creditBudget: best, currentPrice: cur, targetPrice };
}
