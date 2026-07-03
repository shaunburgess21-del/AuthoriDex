import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL set BEFORE any import that transitively loads
// server/db.ts (amm-house imports `db` for the seed/return helpers
// even though the pure helpers tested here don't touch it). Same
// pattern as tests/amm-house.test.ts.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const {
  cost,
  pricesAll,
  seedB,
  normalizeSeedPrices,
  seedBFromPrices,
  seedQFromPrices,
  SEED_PRICE_MIN,
  SEED_PRICE_MAX,
} = await import("../shared/lib/amm/lmsr");
const { pickSeedState, pickB, readPricesAtImport, entriesMatchImportMapping } = await import("../server/services/amm-house");

// ---------------------------------------------------------------------------
// normalizeSeedPrices
// ---------------------------------------------------------------------------

test("normalizeSeedPrices returns a probability vector summing to 1", () => {
  const norm = normalizeSeedPrices([0.7, 0.2, 0.1], 3)!;
  assert.ok(norm);
  const sum = norm.reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
});

test("normalizeSeedPrices clamps extreme longshots to the floor", () => {
  const norm = normalizeSeedPrices([0.997, 0.002, 0.001], 3)!;
  assert.ok(norm);
  // Raw min 0.001 clamps to SEED_PRICE_MIN before renormalizing, so no
  // normalized price can be below SEED_PRICE_MIN / (sum of clamped).
  const rawClampedSum = SEED_PRICE_MAX + SEED_PRICE_MIN + SEED_PRICE_MIN;
  assert.ok(Math.min(...norm) >= SEED_PRICE_MIN / rawClampedSum - 1e-12);
});

test("normalizeSeedPrices rejects bad input shapes", () => {
  assert.equal(normalizeSeedPrices(null, 2), null);
  assert.equal(normalizeSeedPrices(undefined, 2), null);
  assert.equal(normalizeSeedPrices([0.5], 2), null); // wrong length
  assert.equal(normalizeSeedPrices([0.5, NaN], 2), null);
  assert.equal(normalizeSeedPrices([0.5, -0.1], 2), null);
  assert.equal(normalizeSeedPrices([0.5, Infinity], 2), null);
});

// ---------------------------------------------------------------------------
// seedBFromPrices / seedQFromPrices
// ---------------------------------------------------------------------------

test("uniform prices recover the classic seedB", () => {
  const prices = normalizeSeedPrices([0.5, 0.5], 2)!;
  const b = seedBFromPrices(prices, 2000);
  assert.ok(Math.abs(b - seedB(2, 2000)) < 1e-9);
});

test("seedQFromPrices opens the market at the target prices", () => {
  const prices = normalizeSeedPrices([0.92, 0.08], 2)!;
  const b = seedBFromPrices(prices, 5000);
  const q0 = seedQFromPrices(prices, b);
  assert.equal(Math.min(...q0), 0); // shifted so min = 0
  const opening = pricesAll(q0, b);
  for (let i = 0; i < prices.length; i++) {
    assert.ok(
      Math.abs(opening[i] - prices[i]) < 1e-9,
      `price[${i}] ${opening[i]} != target ${prices[i]}`,
    );
  }
});

test("worst-case house loss is exactly targetMaxLoss for any winner", () => {
  const target = 5000;
  const prices = normalizeSeedPrices([0.55, 0.25, 0.12, 0.05, 0.03], 5)!;
  const b = seedBFromPrices(prices, target);
  const q0 = seedQFromPrices(prices, b);
  // Loss if outcome i wins (adversarial trading) = C(q0) − q0[i].
  // Max over i (at min q0 = 0) must equal targetMaxLoss.
  const c0 = cost(q0, b);
  const worst = Math.max(...q0.map((qi) => c0 - qi));
  assert.ok(Math.abs(worst - target) < 1e-6, `worst-case ${worst} != ${target}`);
  // Every other outcome's loss must be <= target.
  for (const qi of q0) {
    assert.ok(c0 - qi <= target + 1e-6);
  }
});

// ---------------------------------------------------------------------------
// pickSeedState
// ---------------------------------------------------------------------------

test("pickSeedState without prices matches the uniform pickB path", () => {
  const ids = ["a", "b", "c"];
  const state = pickSeedState(ids, "community");
  const uniform = pickB(3, "community");
  assert.equal(state.priceMatched, false);
  assert.equal(state.liquidityB, uniform.liquidityB);
  assert.equal(state.houseSeedAmount, uniform.houseSeedAmount);
  assert.deepEqual(state.shareQuantities, { a: 0, b: 0, c: 0 });
});

test("pickSeedState with invalid prices falls back to uniform", () => {
  const ids = ["a", "b"];
  const state = pickSeedState(ids, "community", null, [0.5]); // wrong length
  assert.equal(state.priceMatched, false);
  assert.deepEqual(state.shareQuantities, { a: 0, b: 0 });
});

test("pickSeedState with valid prices opens price-matched", () => {
  const ids = ["yes", "no"];
  const state = pickSeedState(ids, "community", null, [0.92, 0.08]);
  assert.equal(state.priceMatched, true);
  assert.equal(state.targetMaxLoss, 5000); // community default

  const q0 = state.outcomeOrder.map((id) => state.shareQuantities[id]);
  assert.equal(Math.min(...q0), 0);

  const opening = pricesAll(q0, state.liquidityB);
  const norm = normalizeSeedPrices([0.92, 0.08], 2)!;
  assert.ok(Math.abs(opening[0] - norm[0]) < 1e-9);
  assert.ok(Math.abs(opening[1] - norm[1]) < 1e-9);

  // Seed = ceil(C(q0)) and covers the worst case.
  const c0 = cost(q0, state.liquidityB);
  assert.equal(state.houseSeedAmount, Math.ceil(c0));
  assert.ok(state.houseSeedAmount >= state.targetMaxLoss - 1);
  assert.ok(state.houseSeedAmount <= state.targetMaxLoss + 1);
});

test("pickSeedState price-matched seed never exceeds uniform seed guarantee semantics", () => {
  // Skewed 5-outcome market: seed equals targetMaxLoss (+1 for ceil),
  // exactly the same worst-case guarantee as the uniform path.
  const ids = ["a", "b", "c", "d", "e"];
  const state = pickSeedState(ids, "community", null, [0.9, 0.05, 0.03, 0.01, 0.01]);
  assert.equal(state.priceMatched, true);
  assert.ok(Math.abs(state.houseSeedAmount - state.targetMaxLoss) <= 1);
});

// ---------------------------------------------------------------------------
// readPricesAtImport
// ---------------------------------------------------------------------------

test("readPricesAtImport extracts the scout price vector", () => {
  const metadata = {
    source: { provider: "polymarket", pricesAtImport: [0.7, 0.2, 0.1] },
  };
  assert.deepEqual(readPricesAtImport(metadata), [0.7, 0.2, 0.1]);
});

test("readPricesAtImport rejects malformed metadata", () => {
  assert.equal(readPricesAtImport(null), null);
  assert.equal(readPricesAtImport({}), null);
  assert.equal(readPricesAtImport({ source: {} }), null);
  assert.equal(readPricesAtImport({ source: { pricesAtImport: [0.5] } }), null); // < 2
  assert.equal(readPricesAtImport({ source: { pricesAtImport: [0.5, "x"] } }), null);
  assert.equal(readPricesAtImport({ source: { pricesAtImport: [0.5, NaN] } }), null);
});

// ---------------------------------------------------------------------------
// entriesMatchImportMapping — alignment guard before applying import prices
// ---------------------------------------------------------------------------

const mappingMeta = {
  source: {
    provider: "polymarket",
    outcomeMapping: [
      { entryLabel: "Yes", sourceLabel: "Yes" },
      { entryLabel: "No", sourceLabel: "No" },
    ],
  },
};

test("entriesMatchImportMapping passes for untouched entries", () => {
  assert.equal(entriesMatchImportMapping(mappingMeta, ["Yes", "No"]), true);
  // Case-insensitive.
  assert.equal(entriesMatchImportMapping(mappingMeta, ["yes", "NO"]), true);
});

test("entriesMatchImportMapping matches on sourceLabel when entryLabel was polished", () => {
  const meta = {
    source: {
      outcomeMapping: [
        { entryLabel: "USA", sourceLabel: "United States" },
        { entryLabel: "Belgium", sourceLabel: "Belgium" },
      ],
    },
  };
  // Current labels reverted to the source wording — still aligned.
  assert.equal(entriesMatchImportMapping(meta, ["United States", "Belgium"]), true);
});

test("entriesMatchImportMapping fails on reordered entries", () => {
  assert.equal(entriesMatchImportMapping(mappingMeta, ["No", "Yes"]), false);
});

test("entriesMatchImportMapping fails on renamed / added / removed entries", () => {
  assert.equal(entriesMatchImportMapping(mappingMeta, ["Definitely", "No"]), false);
  assert.equal(entriesMatchImportMapping(mappingMeta, ["Yes"]), false);
  assert.equal(entriesMatchImportMapping(mappingMeta, ["Yes", "No", "Maybe"]), false);
  assert.equal(entriesMatchImportMapping({}, ["Yes", "No"]), false);
  assert.equal(entriesMatchImportMapping(null, ["Yes", "No"]), false);
});
