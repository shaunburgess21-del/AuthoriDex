/**
 * LMSR — Logarithmic Market Scoring Rule pricing engine.
 *
 * Pure functions, zero I/O. Imported by both the server (bet placement,
 * settlement, agents) and the client (live quote display) so that the math
 * lives in exactly one place — see plan in
 * `.cursor/plans/lmsr_pricing_engine_*.plan.md`.
 *
 * --------------------------------------------------------------------------
 * The math in one paragraph
 * --------------------------------------------------------------------------
 * For an N-outcome market with `q[i]` shares outstanding of outcome i and
 * a liquidity parameter `b > 0`, the LMSR cost function is
 *
 *     C(q) = b · ln( Σᵢ exp(qᵢ / b) )
 *
 * The marginal price of outcome i (interpreted as the market's implied
 * probability) is the softmax
 *
 *     pᵢ(q) = exp(qᵢ/b) / Σⱼ exp(qⱼ/b)
 *
 * which always lies in (0, 1) and sums to 1 across outcomes. The cost of
 * buying Δ shares of outcome i is `C(q + Δ·eᵢ) − C(q)`; selling Δ shares
 * pays `C(q) − C(q − Δ·eᵢ)`. Worst-case house loss is bounded by `b·ln(N)`
 * (every outcome being bought to infinity, only one of them winning).
 *
 * --------------------------------------------------------------------------
 * Numerical stability
 * --------------------------------------------------------------------------
 * Naive `exp(qᵢ/b)` overflows JS Number for `qᵢ/b ≳ 700`. Every function
 * below uses the standard log-sum-exp shift (subtract max(q) before the
 * exp) so q values up to ~1e308·b are safe. `buyCost` / `sellProceeds`
 * additionally use `log1p` + `expm1` to retain precision when the trade
 * size Δ is small compared to b.
 *
 * --------------------------------------------------------------------------
 * Precision conventions for callers
 * --------------------------------------------------------------------------
 * Shares are fractional (JS Number, ~15 significant digits). Costs returned
 * here are also full-precision Numbers; the route layer (Phase 3) is
 * responsible for rounding cost UP to the nearest integer credit at the
 * debit boundary (favours house, prevents free-money exploits via dust).
 */

const SHARES_TOLERANCE = 1e-6;
const MAX_BISECTION_ITERATIONS = 100;
const MAX_UPPER_BOUND_DOUBLINGS = 50;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateB(b: number): void {
  if (!Number.isFinite(b) || b <= 0) {
    throw new Error(`LMSR: liquidity parameter b must be a positive finite number, got ${b}`);
  }
}

function validateQ(q: number[]): void {
  if (!Array.isArray(q) || q.length < 2) {
    throw new Error(
      `LMSR: q must be an array of at least 2 outcomes, got length ${Array.isArray(q) ? q.length : "non-array"}`,
    );
  }
  for (let i = 0; i < q.length; i++) {
    if (!Number.isFinite(q[i])) {
      throw new Error(`LMSR: q[${i}] must be a finite number, got ${q[i]}`);
    }
  }
}

function validateOutcomeIdx(q: number[], idx: number, name = "outcomeIdx"): void {
  if (!Number.isInteger(idx) || idx < 0 || idx >= q.length) {
    throw new Error(`LMSR: ${name} ${idx} out of range [0, ${q.length})`);
  }
}

function validateNonNegFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`LMSR: ${name} must be a non-negative finite number, got ${value}`);
  }
}

function validateNumOutcomes(numOutcomes: number): void {
  if (!Number.isInteger(numOutcomes) || numOutcomes < 2) {
    throw new Error(`LMSR: numOutcomes must be an integer >= 2, got ${numOutcomes}`);
  }
}

// ---------------------------------------------------------------------------
// Core math (internal)
// ---------------------------------------------------------------------------

/**
 * Numerically-stable log-sum-exp of (q / b). Returns
 *   lse = ln( Σ exp(qᵢ/b) ) = (max/b) + ln( Σ exp((qᵢ − max)/b) )
 * along with the max so callers can reuse the shift if they want softmax.
 */
function logSumExpScaled(q: number[], b: number): { lse: number; max: number } {
  let max = q[0];
  for (let i = 1; i < q.length; i++) {
    if (q[i] > max) max = q[i];
  }
  let sum = 0;
  for (let i = 0; i < q.length; i++) {
    sum += Math.exp((q[i] - max) / b);
  }
  return { lse: max / b + Math.log(sum), max };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Total cost function `C(q) = b · ln(Σ exp(qᵢ/b))`. Numerically stable for
 * any finite q via the log-sum-exp shift.
 */
export function cost(q: number[], b: number): number {
  validateB(b);
  validateQ(q);
  const { lse } = logSumExpScaled(q, b);
  return b * lse;
}

/**
 * Marginal prices for every outcome, returned in input order. Always sums
 * to exactly 1 (within floating-point rounding) and every entry is in
 * (0, 1). Computed via softmax with the same max-shift trick.
 */
export function pricesAll(q: number[], b: number): number[] {
  validateB(b);
  validateQ(q);
  let max = q[0];
  for (let i = 1; i < q.length; i++) {
    if (q[i] > max) max = q[i];
  }
  const expScaled: number[] = new Array(q.length);
  let sum = 0;
  for (let i = 0; i < q.length; i++) {
    const e = Math.exp((q[i] - max) / b);
    expScaled[i] = e;
    sum += e;
  }
  const out: number[] = new Array(q.length);
  for (let i = 0; i < q.length; i++) {
    out[i] = expScaled[i] / sum;
  }
  return out;
}

/**
 * Marginal price of a single outcome. Equivalent to `pricesAll(q,b)[i]`
 * but exposes a per-outcome shape that the route / UI layers prefer.
 */
export function pricePerShare(q: number[], outcomeIdx: number, b: number): number {
  validateB(b);
  validateQ(q);
  validateOutcomeIdx(q, outcomeIdx);
  return pricesAll(q, b)[outcomeIdx];
}

/**
 * Cost in credits to buy `shares` of outcome i right now. Always positive
 * for `shares > 0`; returns 0 for `shares = 0`.
 *
 * Uses the closed-form identity
 *
 *     C(q + Δ·eᵢ) − C(q) = b · ln(1 + pᵢ · (exp(Δ/b) − 1))
 *
 * with `log1p` / `expm1` so we retain precision when Δ << b (small trades
 * relative to liquidity), where the naive `cost(...) − cost(...)` form
 * would lose digits to subtraction.
 */
export function buyCost(q: number[], outcomeIdx: number, shares: number, b: number): number {
  validateB(b);
  validateQ(q);
  validateOutcomeIdx(q, outcomeIdx);
  validateNonNegFinite(shares, "shares");
  if (shares === 0) return 0;
  const p = pricePerShare(q, outcomeIdx, b);
  return b * Math.log1p(p * Math.expm1(shares / b));
}

/**
 * Inverse of `buyCost`: how many shares of outcome i a `creditBudget` will
 * buy at the current state. Solved by bisection because the LMSR cost
 * function is strictly monotonic in shares but has no clean closed-form
 * inverse for arbitrary q.
 *
 * Returns the conservative lower-bound estimate so the caller charging
 * `buyCost(result)` is guaranteed `<= creditBudget` (no accidental
 * over-debit when the route layer rounds up).
 *
 * Converges in <= ~30 iterations for any realistic input. Tolerance is
 * 1e-6 shares — well below the precision of any reasonable per-share
 * price (a 1e-6 share at price 0.99 is worth ~1e-6 credits, far below
 * the integer-credit accounting boundary).
 */
export function sharesForCost(
  q: number[],
  outcomeIdx: number,
  creditBudget: number,
  b: number,
): number {
  validateB(b);
  validateQ(q);
  validateOutcomeIdx(q, outcomeIdx);
  validateNonNegFinite(creditBudget, "creditBudget");
  if (creditBudget === 0) return 0;

  // Initial upper bound: budget / current marginal price · 4. Marginal
  // price <= 1, so this overshoots by at least 4x — usually plenty.
  // We grow geometrically below if the price climbs faster than expected.
  const currentPrice = pricePerShare(q, outcomeIdx, b);
  let lo = 0;
  let hi = (creditBudget / Math.max(currentPrice, 1e-12)) * 4;
  if (!Number.isFinite(hi) || hi <= 0) hi = creditBudget * 4;

  let doublings = MAX_UPPER_BOUND_DOUBLINGS;
  while (buyCost(q, outcomeIdx, hi, b) < creditBudget && doublings-- > 0) {
    hi *= 2;
  }

  let iters = MAX_BISECTION_ITERATIONS;
  while (hi - lo > SHARES_TOLERANCE && iters-- > 0) {
    const mid = (lo + hi) / 2;
    const c = buyCost(q, outcomeIdx, mid, b);
    if (c > creditBudget) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return lo;
}

/**
 * Proceeds in credits from selling `shares` of outcome i right now. Always
 * positive for `shares > 0`; returns 0 for `shares = 0`.
 *
 * Caller is responsible for ensuring `shares <= holdings` — the math
 * itself doesn't track per-user ownership and will happily compute a
 * "short" trade past zero outstanding shares.
 *
 * Uses the symmetric closed form
 *
 *     C(q) − C(q − Δ·eᵢ) = −b · ln(1 + pᵢ · (exp(−Δ/b) − 1))
 *
 * for the same numerical-stability reasons as `buyCost`.
 */
export function sellProceeds(q: number[], outcomeIdx: number, shares: number, b: number): number {
  validateB(b);
  validateQ(q);
  validateOutcomeIdx(q, outcomeIdx);
  validateNonNegFinite(shares, "shares");
  if (shares === 0) return 0;
  const p = pricePerShare(q, outcomeIdx, b);
  return -b * Math.log1p(p * Math.expm1(-shares / b));
}

/**
 * House net P&L for a settled market.
 *
 *   = totalUserCreditsIn − q[winnerIdx]
 *
 * Derivation: the AMM holds (seed + totalUserCreditsIn) at settlement
 * time, where `seed = b·ln(N)` and `totalUserCreditsIn` is the running
 * net of buy costs minus sell proceeds. It pays out exactly 1 credit
 * per outstanding share of the winning outcome (`q[winnerIdx]`) and
 * returns the rest to the house. The seed cancels out, leaving
 * `totalUserCreditsIn − q[winnerIdx]` as the net P&L.
 *
 * Positive = house profit; negative = house loss (bounded by `b·ln(N)`
 * minus whatever credits users paid in).
 *
 * Pure function on purpose: the math layer doesn't read the credit
 * ledger. Caller passes in the running net so refunds, voids, and
 * mid-flight sells are all handled correctly upstream.
 */
export function housePnL(
  q: number[],
  b: number,
  winnerIdx: number,
  totalUserCreditsIn: number,
): number {
  validateB(b);
  validateQ(q);
  validateOutcomeIdx(q, winnerIdx, "winnerIdx");
  if (!Number.isFinite(totalUserCreditsIn)) {
    throw new Error(`LMSR: totalUserCreditsIn must be a finite number, got ${totalUserCreditsIn}`);
  }
  return totalUserCreditsIn - q[winnerIdx];
}

/**
 * Pick the liquidity parameter `b` so worst-case house loss for an
 * N-outcome market is exactly `targetMaxLoss` credits.
 *
 *   b = targetMaxLoss / ln(N)
 *
 * Worst case is "everyone keeps buying outcome i to infinity, outcome i
 * wins" — bounded by `b·ln(N)`. The market generator (Phase 2) calls
 * this to pick a per-market b at creation time.
 */
export function seedB(numOutcomes: number, targetMaxLoss: number): number {
  validateNumOutcomes(numOutcomes);
  if (!Number.isFinite(targetMaxLoss) || targetMaxLoss <= 0) {
    throw new Error(`LMSR: targetMaxLoss must be a positive finite number, got ${targetMaxLoss}`);
  }
  return targetMaxLoss / Math.log(numOutcomes);
}

/**
 * What the house must deposit to bootstrap a fresh market at q = 0:
 *
 *   C(0) = b · ln(N)
 *
 * Phase 2's market generator debits this from the house account and
 * credits it to the AMM at market open.
 */
export function initialSeedCost(numOutcomes: number, b: number): number {
  validateNumOutcomes(numOutcomes);
  validateB(b);
  return b * Math.log(numOutcomes);
}
