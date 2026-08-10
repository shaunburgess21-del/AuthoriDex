/**
 * Unit tests for Brier predicted-probability resolution.
 * Pins the Phase 1 preference: agent confidence over LMSR price.
 */
import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { resolvePredictedProbability } = await import(
  "../server/agents/performanceUpdater"
);

test("resolvePredictedProbability: prefers confidence over pricePerShare", () => {
  assert.equal(
    resolvePredictedProbability({ confidence: 0.72, pricePerShare: 0.41 }),
    0.72,
  );
});

test("resolvePredictedProbability: falls back to pricePerShare when confidence missing", () => {
  assert.equal(
    resolvePredictedProbability({ confidence: null, pricePerShare: 0.41 }),
    0.41,
  );
});

test("resolvePredictedProbability: falls back to 0.5 when both missing", () => {
  assert.equal(resolvePredictedProbability({}), 0.5);
  assert.equal(
    resolvePredictedProbability({ confidence: null, pricePerShare: null }),
    0.5,
  );
});

test("resolvePredictedProbability: treats exact 0 as present (not missing)", () => {
  assert.equal(
    resolvePredictedProbability({ confidence: 0, pricePerShare: 0.9 }),
    0,
  );
});

test("resolvePredictedProbability: clamps to [0, 1]", () => {
  assert.equal(resolvePredictedProbability({ confidence: 1.5 }), 1);
  assert.equal(resolvePredictedProbability({ confidence: -0.2 }), 0);
});

test("resolvePredictedProbability: non-finite falls back to 0.5", () => {
  assert.equal(resolvePredictedProbability({ confidence: "nope" }), 0.5);
  assert.equal(resolvePredictedProbability({ confidence: Number.NaN }), 0.5);
});
