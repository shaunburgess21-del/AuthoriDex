import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL set BEFORE any dynamic import that transitively
// loads server/db.ts. Static imports are hoisted in ESM, so for
// anything that touches `db` we go through `await import(...)`. pg.Pool
// is lazy, so a dummy URL only fails if we issue a query — we never
// do in this test file.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

// rankingConfig has no DB dependency, so a static import is fine and
// lets us keep the top-level test declarations tidy.
import {
  readNumberEnv,
  decayFactor,
  behaviourRampProgress,
  stakeBetWeight,
  statedWeightAtDays,
  PREDICTION_STAKE_WEIGHT_CAP,
  BEHAVIOUR_HALF_LIFE_DAYS,
} from "../server/lib/rankingConfig";

// engagementWriter pulls in server/db.ts → dynamic import so the
// DATABASE_URL guard above runs first.
const {
  isCanonicalCategoryId,
  normaliseCategoryId,
  upsertEngagement,
} = await import("../server/lib/engagementWriter");

// ── rankingConfig.readNumberEnv ────────────────────────────────────

test("readNumberEnv returns fallback when unset", () => {
  delete process.env.__RANK_TEST_UNSET;
  assert.equal(readNumberEnv("__RANK_TEST_UNSET", 14), 14);
});

test("readNumberEnv parses a valid numeric override", () => {
  process.env.__RANK_TEST_OVERRIDE = "42";
  assert.equal(readNumberEnv("__RANK_TEST_OVERRIDE", 14), 42);
  delete process.env.__RANK_TEST_OVERRIDE;
});

test("readNumberEnv falls back on non-numeric value", () => {
  process.env.__RANK_TEST_BAD = "not-a-number";
  // Exercises the warn branch — we don't assert on console output,
  // just that the fallback is returned and no throw escapes.
  assert.equal(readNumberEnv("__RANK_TEST_BAD", 7), 7);
  delete process.env.__RANK_TEST_BAD;
});

test("readNumberEnv treats empty string as unset", () => {
  process.env.__RANK_TEST_EMPTY = "";
  assert.equal(readNumberEnv("__RANK_TEST_EMPTY", 3), 3);
  delete process.env.__RANK_TEST_EMPTY;
});

// ── rankingConfig.decayFactor ──────────────────────────────────────

test("decayFactor is 1 at 0 days", () => {
  assert.equal(decayFactor(0), 1);
});

test("decayFactor halves after one half-life", () => {
  const v = decayFactor(BEHAVIOUR_HALF_LIFE_DAYS);
  assert.ok(Math.abs(v - 0.5) < 1e-9, `expected ~0.5, got ${v}`);
});

test("decayFactor is ~0.25 at two half-lives", () => {
  const v = decayFactor(BEHAVIOUR_HALF_LIFE_DAYS * 2);
  assert.ok(Math.abs(v - 0.25) < 1e-9, `expected ~0.25, got ${v}`);
});

test("decayFactor is ~0.125 at three half-lives", () => {
  const v = decayFactor(BEHAVIOUR_HALF_LIFE_DAYS * 3);
  assert.ok(Math.abs(v - 0.125) < 1e-9, `expected ~0.125, got ${v}`);
});

test("decayFactor clamps to 1 for negative / non-finite input", () => {
  assert.equal(decayFactor(-5), 1);
  assert.equal(decayFactor(Number.NaN), 1);
});

// ── rankingConfig.behaviourRampProgress ────────────────────────────

test("behaviourRampProgress is 0 below the min threshold", () => {
  assert.equal(behaviourRampProgress(0), 0);
  assert.equal(behaviourRampProgress(3), 0);
  assert.equal(behaviourRampProgress(4), 0);
});

test("behaviourRampProgress is 1 at or above full threshold", () => {
  assert.equal(behaviourRampProgress(8), 1);
  assert.equal(behaviourRampProgress(12), 1);
});

test("behaviourRampProgress is linear in the middle", () => {
  // Defaults min=4 full=8 → midpoint 6 = 0.5, 5 = 0.25.
  assert.ok(Math.abs(behaviourRampProgress(6) - 0.5) < 1e-9);
  assert.ok(Math.abs(behaviourRampProgress(5) - 0.25) < 1e-9);
});

// ── rankingConfig.stakeBetWeight ───────────────────────────────────

test("stakeBetWeight is 0 for zero or negative stakes", () => {
  assert.equal(stakeBetWeight(0), 0);
  assert.equal(stakeBetWeight(-50), 0);
  assert.equal(stakeBetWeight(Number.NaN), 0);
});

test("stakeBetWeight grows logarithmically for small stakes", () => {
  // 3 * log1p(1) ≈ 2.079
  const v1 = stakeBetWeight(1);
  assert.ok(Math.abs(v1 - 3 * Math.log1p(1)) < 1e-9, `expected ~${3 * Math.log1p(1)}, got ${v1}`);
  assert.ok(v1 < PREDICTION_STAKE_WEIGHT_CAP);
});

test("stakeBetWeight hits the cap at large stakes", () => {
  const v = stakeBetWeight(10_000);
  assert.equal(v, PREDICTION_STAKE_WEIGHT_CAP);
});

test("stakeBetWeight is monotonically non-decreasing", () => {
  const samples = [1, 10, 100, 500, 1000, 5000, 10000];
  let last = 0;
  for (const s of samples) {
    const v = stakeBetWeight(s);
    assert.ok(v >= last, `expected monotonic: ${last} → ${v} at stake ${s}`);
    last = v;
  }
});

// ── rankingConfig.statedWeightAtDays ───────────────────────────────

test("statedWeightAtDays clamps to week-1 anchor early on", () => {
  assert.equal(statedWeightAtDays(0), 0.7);
  assert.equal(statedWeightAtDays(7), 0.7);
});

test("statedWeightAtDays clamps to week-4 anchor after 4 weeks", () => {
  assert.equal(statedWeightAtDays(28), 0.3);
  assert.equal(statedWeightAtDays(60), 0.3);
});

test("statedWeightAtDays interpolates linearly between weeks 1 and 4", () => {
  // Midpoint ~17.5 days → ~0.5.
  const mid = statedWeightAtDays(17.5);
  assert.ok(Math.abs(mid - 0.5) < 1e-9, `expected ~0.5, got ${mid}`);
});

// ── engagementWriter.isCanonicalCategoryId ─────────────────────────

test("isCanonicalCategoryId accepts all 12 canonical ids", () => {
  const valid = [
    "tech","politics","business","music","sports","film-tv",
    "gaming","creator","comedy","food-drink","lifestyle","misc",
  ];
  for (const id of valid) {
    assert.ok(isCanonicalCategoryId(id), `${id} should be canonical`);
  }
});

test("isCanonicalCategoryId rejects non-canonical inputs", () => {
  assert.equal(isCanonicalCategoryId("Tech"), false);
  assert.equal(isCanonicalCategoryId("filmTV"), false);
  assert.equal(isCanonicalCategoryId(""), false);
  assert.equal(isCanonicalCategoryId(null), false);
  assert.equal(isCanonicalCategoryId(undefined), false);
  assert.equal(isCanonicalCategoryId(42 as unknown as string), false);
});

// ── engagementWriter.normaliseCategoryId ───────────────────────────

test("normaliseCategoryId lowercases and trims", () => {
  assert.equal(normaliseCategoryId(" Tech "), "tech");
  assert.equal(normaliseCategoryId("FILM-TV"), "film-tv");
});

test("normaliseCategoryId returns null for empty / invalid", () => {
  assert.equal(normaliseCategoryId(""), null);
  assert.equal(normaliseCategoryId("   "), null);
  assert.equal(normaliseCategoryId(null), null);
  assert.equal(normaliseCategoryId(undefined), null);
  assert.equal(normaliseCategoryId("nonsense-category"), null);
});

// ── engagementWriter.upsertEngagement (short-circuit contract) ─────
//
// These exercise the pre-DB short-circuit paths so the fire-and-forget
// contract is asserted without a live database. The try/catch around
// the DB insert is covered structurally — any failure path there
// returns false and logs to console.warn rather than throwing.

test("upsertEngagement returns false without throwing when userId is empty", async () => {
  const ok = await upsertEngagement({
    userId: "",
    categoryId: "tech",
    voteDelta: 1,
    source: "test-no-user",
  });
  assert.equal(ok, false);
});

test("upsertEngagement returns false without throwing for an unknown category", async () => {
  const ok = await upsertEngagement({
    userId: "user-1",
    categoryId: "not-a-real-category",
    voteDelta: 1,
    source: "test-bad-category",
  });
  assert.equal(ok, false);
});

test("upsertEngagement returns false when both deltas are zero", async () => {
  const ok = await upsertEngagement({
    userId: "user-1",
    categoryId: "tech",
    voteDelta: 0,
    source: "test-zero-delta",
  });
  assert.equal(ok, false);
});
