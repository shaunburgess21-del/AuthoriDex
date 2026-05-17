/**
 * Unit tests for the gainer (race) tie predicate.
 *
 * `pctChange` is computed as `((closeScore - openScore) / openScore) * 100`,
 * so the threshold is in **percentage points** — i.e. `0.01` means
 * "two entries whose pctChange agrees to two decimal places are tied."
 *
 * Two-decimal precision matches what we display everywhere in the UI
 * (the `pctChange.toFixed(2) + "%"` evidence in `resolution_notes`,
 * leaderboard cells, share cards). The previous `0.001` was so tight
 * it would only fire on an effectively literal floating-point match —
 * a real-world tie at 5.12% vs 5.13% would have arbitrarily picked
 * one side as the winner instead of voiding.
 *
 * These tests pin the helper so a future refactor can't quietly
 * regress the threshold or the predicate's NaN-safety.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const { GAINER_TIE_EPSILON_PCT, isGainerTie } = await import(
  "../server/jobs/market-resolver"
);

test("gainer tie threshold: constant is 0.01 pct (two-decimal display precision)", () => {
  assert.equal(GAINER_TIE_EPSILON_PCT, 0.01);
});

test("gainer tie: pair inside threshold is a tie", () => {
  // 5.123% vs 5.124%, gap = 0.001 → well inside 0.01 → tie.
  assert.equal(isGainerTie(5.123, 5.124), true);
  // 5.12% vs 5.125%, gap = 0.005 → still inside → tie.
  assert.equal(isGainerTie(5.12, 5.125), true);
  // Identical values are obviously tied.
  assert.equal(isGainerTie(5.12, 5.12), true);
  // Order-independence.
  assert.equal(isGainerTie(5.124, 5.123), true);
  // Negative values can also tie (both lost ground).
  assert.equal(isGainerTie(-2.005, -2.0), true);
  // Nominal 0.01 gap: IEEE-754 gives `5.12 - 5.13 ≈ -0.00999...`,
  // which still satisfies the strict-less-than. Locked in as a tie
  // because an exactly-0.01-pct gap is operationally noise — voiding
  // is the safe call. (See helper docstring.)
  assert.equal(isGainerTie(5.12, 5.13), true);
});

test("gainer tie: pair clearly outside threshold is NOT a tie", () => {
  // 5.12% vs 5.14%, gap = 0.02 → clearly outside → winner picked.
  assert.equal(isGainerTie(5.12, 5.14), false);
  // 5.10% vs 5.15%, gap = 0.05 → comfortably outside.
  assert.equal(isGainerTie(5.1, 5.15), false);
  // Wide real-world margin.
  assert.equal(isGainerTie(12.34, 8.91), false);
  // Cross-zero (a winner vs a loser) is never a tie unless both are
  // genuinely flat (covered by the inside-threshold test above).
  assert.equal(isGainerTie(0.5, -0.5), false);
});

test("gainer tie: NaN / Infinity inputs return false (fall through to winner pick)", () => {
  // A NaN race can't sensibly be tied — the resolver should fall
  // through to the normal winner-pick path so an upstream snapshot
  // bug doesn't accidentally void every market.
  assert.equal(isGainerTie(Number.NaN, 5.0), false);
  assert.equal(isGainerTie(5.0, Number.NaN), false);
  assert.equal(isGainerTie(Number.NaN, Number.NaN), false);
  assert.equal(isGainerTie(Number.POSITIVE_INFINITY, 5.0), false);
  assert.equal(isGainerTie(5.0, Number.NEGATIVE_INFINITY), false);
});
