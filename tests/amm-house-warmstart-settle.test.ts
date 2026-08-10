/**
 * Unit tests for the AMM house settle residual and the warm-start
 * settle arithmetic (Phase 1 fix).
 *
 * Pins `computeCreditedToHouse` so the pot residual matches the
 * seed-return drift audit:
 *   credited = seed + warmStart + totalIn − payoutLiability
 *
 * Cases:
 *   - winner path, warm-start present (prior side won or lost)
 *   - void path with house warm-start stake inside payoutLiability
 *   - non-warm-started market (warmStart=0)
 */
import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { computeCreditedToHouse } = await import("../server/services/amm-house");

test("computeCreditedToHouse: non-warm-started market recovers seed when payout = totalIn", () => {
  // Classic void / break-even: users put 1000 in, get 1000 back → house keeps seed.
  const credited = computeCreditedToHouse({
    houseSeedAmount: 2000,
    warmStartCost: 0,
    totalUserCreditsIn: 1000,
    payoutLiability: 1000,
  });
  assert.equal(credited, 2000);
});

test("computeCreditedToHouse: winner path with warm-start includes the cost in the residual", () => {
  // Pot = 2000 seed + 644 warm + 10000 userIn. Winners take 8000.
  // House residual = 2000 + 644 + 10000 − 8000 = 4644.
  const credited = computeCreditedToHouse({
    houseSeedAmount: 2000,
    warmStartCost: 644,
    totalUserCreditsIn: 10000,
    payoutLiability: 8000,
  });
  assert.equal(credited, 4644);
});

test("computeCreditedToHouse: omitting warmStart under-credits by exactly the warm-start cost (the historical bug)", () => {
  const withWarm = computeCreditedToHouse({
    houseSeedAmount: 2000,
    warmStartCost: 644,
    totalUserCreditsIn: 18667,
    payoutLiability: 15794,
  });
  const withoutWarm = computeCreditedToHouse({
    houseSeedAmount: 2000,
    warmStartCost: 0,
    totalUserCreditsIn: 18667,
    payoutLiability: 15794,
  });
  // Matches the live health-check sample (Bezos updown drift = −644).
  assert.equal(withWarm - withoutWarm, 644);
  assert.equal(withoutWarm, 4873);
  assert.equal(withWarm, 5517);
});

test("computeCreditedToHouse: void path — warm-start stake in payoutLiability cancels, house recovers seed", () => {
  // Void refunds every market_bets owner including HOUSE. totalRefund =
  // totalIn + warmStart. Residual must still equal seed.
  const seed = 2000;
  const warm = 644;
  const totalIn = 5000;
  const totalRefund = totalIn + warm; // includes house warm-start stake
  const credited = computeCreditedToHouse({
    houseSeedAmount: seed,
    warmStartCost: warm,
    totalUserCreditsIn: totalIn,
    payoutLiability: totalRefund,
  });
  assert.equal(credited, seed);
});

test("computeCreditedToHouse: void without warmStartCost under-credits (double-count trap inverted)", () => {
  // If we wrongly omit warmStart on void while totalRefund includes it,
  // house is short by warm — the historical leak.
  const seed = 2000;
  const warm = 644;
  const totalIn = 5000;
  const totalRefund = totalIn + warm;
  const leaked = computeCreditedToHouse({
    houseSeedAmount: seed,
    warmStartCost: 0,
    totalUserCreditsIn: totalIn,
    payoutLiability: totalRefund,
  });
  assert.equal(leaked, seed - warm);
});

test("computeCreditedToHouse: undefined warmStartCost treated as 0", () => {
  const credited = computeCreditedToHouse({
    houseSeedAmount: 2000,
    totalUserCreditsIn: 100,
    payoutLiability: 100,
  });
  assert.equal(credited, 2000);
});

test("computeCreditedToHouse: negative warmStartCost clamped to 0 (pure helper)", () => {
  // The DB path throws on negative warmStartCost; the pure helper clamps
  // so call-site math stays total-defined for exploratory scripts.
  const credited = computeCreditedToHouse({
    houseSeedAmount: 2000,
    warmStartCost: -50,
    totalUserCreditsIn: 0,
    payoutLiability: 0,
  });
  assert.equal(credited, 2000);
});

test("computeCreditedToHouse: house loss when payout exceeds seed+warm+in is negative", () => {
  const credited = computeCreditedToHouse({
    houseSeedAmount: 2000,
    warmStartCost: 500,
    totalUserCreditsIn: 1000,
    payoutLiability: 5000,
  });
  assert.equal(credited, -1500);
});
