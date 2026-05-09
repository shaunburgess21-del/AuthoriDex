import test from "node:test";
import assert from "node:assert/strict";

import {
  cost,
  pricePerShare,
  pricesAll,
  buyCost,
  sharesForCost,
  sellProceeds,
  housePnL,
  seedB,
  initialSeedCost,
} from "../shared/lib/amm/lmsr";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function approxEqual(actual: number, expected: number, tol: number, msg?: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? "approxEqual"}: |${actual} − ${expected}| = ${Math.abs(actual - expected)} > tol ${tol}`,
  );
}

// ===========================================================================
// CORRECTNESS
// ===========================================================================

test("pricesAll: prices sum to 1 across 2-, 3-, 5-, and 10-outcome markets", () => {
  const cases: Array<{ q: number[]; b: number }> = [
    { q: [0, 0], b: 100 },
    { q: [50, -30], b: 100 },
    { q: [0, 0, 0], b: 50 },
    { q: [10, 5, 1], b: 25 },
    { q: [0, 0, 0, 0, 0], b: 200 },
    { q: [40, 20, 80, 5, 60], b: 200 },
    { q: new Array(10).fill(0), b: 100 },
    { q: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], b: 100 },
  ];
  for (const { q, b } of cases) {
    const ps = pricesAll(q, b);
    const sum = ps.reduce((acc, p) => acc + p, 0);
    approxEqual(sum, 1, 1e-12, `prices for q=${JSON.stringify(q)} sum`);
    for (const p of ps) {
      assert.ok(p > 0 && p < 1, `each price strictly in (0,1), got ${p}`);
    }
  }
});

test("cost: a fresh N-outcome market at q=0 costs exactly b·ln(N) — matches initialSeedCost", () => {
  for (const N of [2, 3, 5, 10]) {
    const b = 100;
    const q = new Array(N).fill(0);
    approxEqual(cost(q, b), b * Math.log(N), 1e-12, `cost(0..., N=${N})`);
    approxEqual(initialSeedCost(N, b), b * Math.log(N), 1e-12, `initialSeedCost(N=${N})`);
    approxEqual(cost(q, b), initialSeedCost(N, b), 1e-12, `cost(0...) === initialSeedCost (N=${N})`);
  }
});

test("pricesAll: a fresh market starts at uniform 1/N for every outcome", () => {
  for (const N of [2, 3, 5, 10]) {
    const ps = pricesAll(new Array(N).fill(0), 50);
    for (const p of ps) approxEqual(p, 1 / N, 1e-12, `uniform start price for N=${N}`);
  }
});

test("pricePerShare: matches pricesAll[outcomeIdx] for every index", () => {
  const q = [12, -3, 47, 5, 28];
  const b = 80;
  const all = pricesAll(q, b);
  for (let i = 0; i < q.length; i++) {
    approxEqual(pricePerShare(q, i, b), all[i], 1e-15, `pricePerShare[${i}] vs pricesAll[${i}]`);
  }
});

test("buy then sell exact same shares: round-trip net cost ≈ 0 within rounding", () => {
  const q = [40, 60, 20];
  const b = 100;
  const i = 1;
  const delta = 50;
  const paid = buyCost(q, i, delta, b);
  const qAfterBuy = q.slice();
  qAfterBuy[i] += delta;
  const refund = sellProceeds(qAfterBuy, i, delta, b);
  approxEqual(paid - refund, 0, 1e-9, "buy-then-sell round trip is conservative");
});

test("buyCost monotonicity: more shares always cost strictly more", () => {
  const q = [10, 20, 5];
  const b = 50;
  let last = -Infinity;
  for (const delta of [1, 5, 25, 100, 500]) {
    const c = buyCost(q, 0, delta, b);
    assert.ok(c > last, `buyCost should increase with shares; got ${c} after ${last}`);
    last = c;
  }
});

test("buying outcome i raises pᵢ and lowers all others", () => {
  const q = [0, 0, 0];
  const b = 100;
  const before = pricesAll(q, b);
  const after = pricesAll([100, 0, 0], b);
  assert.ok(after[0] > before[0], "p0 should rise after buying outcome 0");
  assert.ok(after[1] < before[1], "p1 should fall");
  assert.ok(after[2] < before[2], "p2 should fall");
});

test("sharesForCost ↔ buyCost round trip: budget→shares→cost ≈ budget (within tolerance)", () => {
  const q = [0, 0, 0];
  const b = 200;
  for (const budget of [1, 10, 50, 250, 1000]) {
    const shares = sharesForCost(q, 1, budget, b);
    const c = buyCost(q, 1, shares, b);
    assert.ok(c <= budget + 1e-6, `cost ${c} should not exceed budget ${budget}`);
    approxEqual(c, budget, 1e-3, `cost(sharesForCost(${budget})) ≈ ${budget}`);
  }
});

test("buyCost for tiny share amount ≈ marginalPrice · shares (linear regime)", () => {
  const q = [50, 30, 20];
  const b = 200;
  const i = 0;
  const p = pricePerShare(q, i, b);
  const tiny = 0.01;
  const c = buyCost(q, i, tiny, b);
  approxEqual(c, p * tiny, 1e-7, "small-trade cost ≈ price × shares");
});

// ===========================================================================
// NUMERICAL STABILITY
// ===========================================================================

test("cost([10000, 0], b=100) does not overflow (naive impl would)", () => {
  const c = cost([10000, 0], 100);
  assert.ok(Number.isFinite(c), `cost should be finite, got ${c}`);
  // C(q) ≈ max(qᵢ) when one entry dominates; specifically max + b·ln(1 + tinies)
  approxEqual(c, 10000, 1e-3, "cost should be ≈ max share count when one dominates");
});

test("pricesAll([10000, 0], b=100) returns [≈1, ≈0] not NaN", () => {
  const ps = pricesAll([10000, 0], 100);
  assert.ok(Number.isFinite(ps[0]) && Number.isFinite(ps[1]), "no NaN");
  approxEqual(ps[0], 1, 1e-9, "p0 → 1 when q0 dominates");
  approxEqual(ps[1], 0, 1e-9, "p1 → 0");
  approxEqual(ps[0] + ps[1], 1, 1e-15, "still sums to 1");
});

test("symmetry: pricesAll([5,5], b=10) = [0.5, 0.5]", () => {
  const ps = pricesAll([5, 5], 10);
  approxEqual(ps[0], 0.5, 1e-15, "p0");
  approxEqual(ps[1], 0.5, 1e-15, "p1");
});

test("pricesAll handles tiny b on balanced q without NaN", () => {
  const ps = pricesAll([1, 1, 1], 0.01);
  approxEqual(ps[0], 1 / 3, 1e-12);
  approxEqual(ps[1], 1 / 3, 1e-12);
  approxEqual(ps[2], 1 / 3, 1e-12);
});

test("pricesAll on extreme imbalance with small b → near-degenerate but finite", () => {
  // q0 dominates by 5b → softmax exp(5)/(exp(5)+2) ≈ 0.987 (not literally 1,
  // because LMSR softmax never quite saturates at finite q). Just verify
  // that p0 is heavily dominant, that everything's finite, and that
  // probabilities sum to 1.
  const ps = pricesAll([10, 0, 0], 2);
  assert.ok(Number.isFinite(ps[0]) && Number.isFinite(ps[1]) && Number.isFinite(ps[2]));
  approxEqual(ps[0] + ps[1] + ps[2], 1, 1e-15);
  assert.ok(ps[0] > 0.98, `p0 should dominate, got ${ps[0]}`);
  assert.ok(ps[1] < 0.01 && ps[2] < 0.01, `losers should be near-zero`);
});

test("buyCost stays finite and monotonic even when shares >> b", () => {
  const q = [0, 0];
  const b = 10;
  const c1 = buyCost(q, 0, 1000, b); // 100x b
  const c2 = buyCost(q, 0, 5000, b); // 500x b
  assert.ok(Number.isFinite(c1) && Number.isFinite(c2));
  assert.ok(c2 > c1, "more shares cost more even at large scale");
  // Asymptotically the average price per share approaches 1 as Δ→∞, with
  // residual `b·ln(2)/Δ` from the initial 50/50 state. For Δ=5000, b=10,
  // residual ≈ 0.00139, so a 2e-3 tolerance is correct here.
  approxEqual(c2 / 5000, 1, 2e-3, "asymptotic price → 1 at extreme buys");
});

test("buyCost asymptotic fallback handles ratios > 500 without overflow", () => {
  // Above the SHARES_RATIO_OVERFLOW_THRESHOLD = 500, buyCost switches to
  // `Δ + b·ln(p)` to avoid `Math.expm1` overflowing to Infinity around
  // ratio ≈ 709.78. Verify all of: finite, monotonic, and matches the
  // closed-form within ~1e-216 at the boundary.
  const q = [0, 0]; // p[0] = 0.5
  const b = 1;
  const huge1 = buyCost(q, 0, 600, b);    // ratio 600
  const huger = buyCost(q, 0, 1000, b);   // ratio 1000
  const enormous = buyCost(q, 0, 100000, b); // ratio 100k
  assert.ok(
    Number.isFinite(huge1) && Number.isFinite(huger) && Number.isFinite(enormous),
    `all three should be finite, got ${huge1}, ${huger}, ${enormous}`,
  );
  assert.ok(huge1 < huger && huger < enormous, "monotonic in shares");
  // At ratio = 1000, p = 0.5, expected = 1000 + ln(0.5) ≈ 999.307
  approxEqual(huger, 1000 + Math.log(0.5), 1e-9, "asymptotic form is exact");
  // At ratio 100k the closed form would have returned Infinity. Ours
  // returns the asymptote.
  approxEqual(enormous, 100000 + Math.log(0.5), 1e-9);
});

test("buyCost is continuous at the asymptotic switch point", () => {
  // ratio = 500 (just below threshold) should give nearly the same
  // result as ratio = 500.0001 (just above) — both forms must agree
  // to within Number precision at the switch.
  const q = [0, 0];
  const b = 1;
  const justBelow = buyCost(q, 0, 500, b);          // closed form
  const justAbove = buyCost(q, 0, 500.0001, b);     // asymptotic
  // Difference should be utterly negligible (< 1e-100 in theory; allow
  // 1e-3 for the 0.0001 share gap).
  assert.ok(
    Math.abs(justBelow - justAbove) < 1e-3,
    `discontinuity at switch point: ${justBelow} vs ${justAbove}`,
  );
});

// ===========================================================================
// SETTLEMENT / HOUSE PNL
// ===========================================================================

test("housePnL: all-on-winner — house pays out roughly what users paid in (small AMM premium kept)", () => {
  // Start at q=0, three users each buy 100 shares of outcome 0. Then 0 wins.
  const N = 2;
  const b = 100;
  let q = new Array(N).fill(0);
  let totalCreditsIn = 0;
  for (let i = 0; i < 3; i++) {
    const c = buyCost(q, 0, 100, b);
    totalCreditsIn += c;
    q[0] += 100;
  }
  // Outcome 0 wins; payout liability = q[0] = 300 shares × 1 credit.
  const pnl = housePnL(q, b, 0, totalCreditsIn);
  // House has a small loss: liability 300 vs credits-in (~mid-200s),
  // but bounded above by b·ln(N) = 100·ln(2) ≈ 69.3.
  assert.ok(pnl < 0, `house should lose modestly, got ${pnl}`);
  assert.ok(pnl > -b * Math.log(N) - 1e-9, `loss is bounded by b·ln(N), got ${pnl}`);
});

test("housePnL: all-on-loser — house keeps all credits paid in", () => {
  // Users buy outcome 0; outcome 1 wins. Payout liability = q[1] = 0.
  const b = 100;
  const q = [200, 0];
  const totalCreditsIn = 150; // doesn't matter what, just plug it through
  const pnl = housePnL(q, b, 1, totalCreditsIn);
  approxEqual(pnl, 150, 1e-12, "all credits-in flow back to house when winner has zero shares");
});

test("housePnL: empty market settles with zero net (house seed returns intact)", () => {
  // q=0 means no trades happened. totalCreditsIn = 0, q[winner] = 0 → pnl = 0.
  const pnl = housePnL([0, 0, 0], 50, 1, 0);
  assert.equal(pnl, 0);
});

test("housePnL conservation: userPayout + housePnL = totalUserCreditsIn", () => {
  // Whatever the trades, settlement always conserves credits.
  const q = [120, 80, 40];
  const b = 75;
  const totalCreditsIn = 175.42;
  for (let winner = 0; winner < q.length; winner++) {
    const userPayout = q[winner]; // 1 credit per outstanding winning share
    const pnl = housePnL(q, b, winner, totalCreditsIn);
    approxEqual(userPayout + pnl, totalCreditsIn, 1e-12, `conservation for winner=${winner}`);
  }
});

test("seedB: b = targetMaxLoss / ln(N) and initialSeedCost(N, b) = targetMaxLoss", () => {
  for (const N of [2, 3, 5, 10]) {
    for (const targetLoss of [50, 500, 5000]) {
      const b = seedB(N, targetLoss);
      approxEqual(b, targetLoss / Math.log(N), 1e-12, `seedB(N=${N}, loss=${targetLoss})`);
      approxEqual(
        initialSeedCost(N, b),
        targetLoss,
        1e-9,
        `seed cost matches target max loss (N=${N}, loss=${targetLoss})`,
      );
    }
  }
});

// ===========================================================================
// EDGE CASES
// ===========================================================================

test("buying or selling 0 shares costs / pays exactly 0", () => {
  const q = [10, 20];
  const b = 50;
  assert.equal(buyCost(q, 0, 0, b), 0);
  assert.equal(buyCost(q, 1, 0, b), 0);
  assert.equal(sellProceeds(q, 0, 0, b), 0);
  assert.equal(sellProceeds(q, 1, 0, b), 0);
});

test("sharesForCost with budget=0 returns 0", () => {
  assert.equal(sharesForCost([0, 0], 0, 0, 100), 0);
});

test("validation: throws on b <= 0, b non-finite", () => {
  assert.throws(() => cost([0, 0], 0), /b must be a positive/);
  assert.throws(() => cost([0, 0], -5), /b must be a positive/);
  assert.throws(() => cost([0, 0], NaN), /b must be a positive/);
  assert.throws(() => cost([0, 0], Infinity), /b must be a positive/);
});

test("validation: throws on empty / single-outcome q and on non-finite entries", () => {
  assert.throws(() => cost([], 100), /at least 2 outcomes/);
  assert.throws(() => cost([1], 100), /at least 2 outcomes/);
  assert.throws(() => cost([1, NaN], 100), /must be a finite number/);
  assert.throws(() => cost([1, Infinity], 100), /must be a finite number/);
});

test("validation: throws on out-of-range outcome index for every consuming function", () => {
  const q = [0, 0];
  const b = 100;
  assert.throws(() => pricePerShare(q, -1, b), /out of range/);
  assert.throws(() => pricePerShare(q, 2, b), /out of range/);
  assert.throws(() => pricePerShare(q, 1.5, b), /out of range/);
  assert.throws(() => buyCost(q, 99, 10, b), /out of range/);
  assert.throws(() => sellProceeds(q, 99, 10, b), /out of range/);
  assert.throws(() => sharesForCost(q, 99, 10, b), /out of range/);
  assert.throws(() => housePnL(q, b, 99, 0), /out of range/);
});

test("validation: throws on negative shares / negative budget", () => {
  const q = [0, 0];
  const b = 100;
  assert.throws(() => buyCost(q, 0, -1, b), /non-negative/);
  assert.throws(() => sellProceeds(q, 0, -1, b), /non-negative/);
  assert.throws(() => sharesForCost(q, 0, -1, b), /non-negative/);
});

test("validation: seedB and initialSeedCost reject bad N / bad targetMaxLoss", () => {
  assert.throws(() => seedB(1, 100), /numOutcomes must be an integer >= 2/);
  assert.throws(() => seedB(2.5, 100), /numOutcomes must be an integer >= 2/);
  assert.throws(() => seedB(3, 0), /targetMaxLoss must be a positive/);
  assert.throws(() => seedB(3, -10), /targetMaxLoss must be a positive/);
  assert.throws(() => initialSeedCost(1, 50), /numOutcomes must be an integer >= 2/);
  assert.throws(() => initialSeedCost(3, 0), /b must be a positive/);
});
