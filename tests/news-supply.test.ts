/**
 * Unit tests for the News Share-of-Voice supply correction factor math.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  cohortMean,
  computeNewsSupplyFactors,
  getNewsSovActivation,
  parseNewsSovEnableFrom,
} from "../server/scoring/news-supply";

const ENABLED = { enabled: true, minFactor: 0.5, maxFactor: 2.5, minCohort: 20 };

test("cohortMean averages finite values, ignoring non-finite", () => {
  assert.equal(cohortMean([2, 4, 6]), 4);
  assert.equal(cohortMean([]), 0);
  assert.equal(cohortMean([1, NaN, 3, Infinity]), 2);
});

test("disabled → no-op factors of 1", () => {
  const r = computeNewsSupplyFactors(
    { supplyNow: 5, supply7d: 10, supplyRef: 20, cohortSize: 100 },
    { enabled: false },
  );
  assert.equal(r.applied, false);
  assert.equal(r.reason, "disabled");
  assert.equal(r.factorVolume, 1);
  assert.equal(r.factorMomentumDenom, 1);
});

test("cohort too small → no-op", () => {
  const r = computeNewsSupplyFactors(
    { supplyNow: 5, supply7d: 10, supplyRef: 20, cohortSize: 5 },
    ENABLED,
  );
  assert.equal(r.applied, false);
  assert.equal(r.reason, "cohort_too_small");
  assert.equal(r.factorVolume, 1);
});

test("zero reference → no-op", () => {
  const r = computeNewsSupplyFactors(
    { supplyNow: 5, supply7d: 10, supplyRef: 0, cohortSize: 100 },
    ENABLED,
  );
  assert.equal(r.applied, false);
  assert.equal(r.reason, "no_reference");
});

test("zero current supply → no-op (avoids divide-by-zero blow-up)", () => {
  const r = computeNewsSupplyFactors(
    { supplyNow: 0, supply7d: 10, supplyRef: 20, cohortSize: 100 },
    ENABLED,
  );
  assert.equal(r.applied, false);
  assert.equal(r.reason, "no_current_supply");
  assert.equal(r.factorVolume, 1);
});

test("stable week → factor ~1.0 (safe enable)", () => {
  const r = computeNewsSupplyFactors(
    { supplyNow: 10, supply7d: 10, supplyRef: 10, cohortSize: 150 },
    ENABLED,
  );
  assert.equal(r.applied, true);
  assert.equal(r.factorVolume, 1);
  assert.equal(r.factorMomentumDenom, 1);
});

test("supply drop (outage) → volume factor scales up, clamped at max", () => {
  // Cohort supply collapsed to 1/10th of reference → raw ratio 10, clamped 2.5.
  const r = computeNewsSupplyFactors(
    { supplyNow: 2, supply7d: 2, supplyRef: 20, cohortSize: 150 },
    ENABLED,
  );
  assert.equal(r.applied, true);
  assert.equal(r.factorVolume, 2.5);
  assert.equal(r.factorMomentumDenom, 2.5);
});

test("supply spike (flood) → volume factor scales down, clamped at min", () => {
  const r = computeNewsSupplyFactors(
    { supplyNow: 40, supply7d: 40, supplyRef: 10, cohortSize: 150 },
    ENABLED,
  );
  assert.equal(r.applied, true);
  assert.equal(r.factorVolume, 0.5);
});

test("moderate drop → un-clamped proportional factor", () => {
  const r = computeNewsSupplyFactors(
    { supplyNow: 8, supply7d: 8, supplyRef: 12, cohortSize: 150 },
    ENABLED,
  );
  assert.equal(r.applied, true);
  assert.equal(r.factorVolume, 1.5);
});

test("momentum double-ratio: corrected ratio = (person 24h/7d) / (cohort 24h/7d)", () => {
  // Cohort: 24h mean = 6 (S_now), 7d mean = 10 (S_avg7d), reference = 10.
  const S_now = 6;
  const S_avg7d = 10;
  const S_ref = 10;
  const r = computeNewsSupplyFactors(
    { supplyNow: S_now, supply7d: S_avg7d, supplyRef: S_ref, cohortSize: 150 },
    ENABLED,
  );
  // A person with 24h=12, 7d=10 (raw ratio 1.2).
  const person24h = 12;
  const person7d = 10;
  const correctedRatio =
    (person24h * r.factorVolume) / (person7d * r.factorMomentumDenom);
  const expected = (person24h / person7d) / (S_now / S_avg7d);
  assert.ok(
    Math.abs(correctedRatio - expected) < 1e-9,
    `expected ${expected}, got ${correctedRatio}`,
  );
});

test("uniform per-tick factor preserves cross-person ordering", () => {
  const r = computeNewsSupplyFactors(
    { supplyNow: 5, supply7d: 5, supplyRef: 10, cohortSize: 150 },
    ENABLED,
  );
  const people = [3, 1, 9, 4];
  const corrected = people.map((v) => v * r.factorVolume);
  const rankRaw = [...people.keys()].sort((a, b) => people[b] - people[a]);
  const rankCorr = [...corrected.keys()].sort((a, b) => corrected[b] - corrected[a]);
  assert.deepEqual(rankCorr, rankRaw);
});

// ── Scheduled activation (NEWS_SOV_ENABLE_FROM) ─────────────────────────────

test("parseNewsSovEnableFrom: empty/missing → no schedule, not invalid", () => {
  assert.deepEqual(parseNewsSovEnableFrom(undefined), { date: null, invalid: false });
  assert.deepEqual(parseNewsSovEnableFrom("  "), { date: null, invalid: false });
});

test("parseNewsSovEnableFrom: garbage → invalid (fail-safe)", () => {
  const r = parseNewsSovEnableFrom("13-07-2026");
  assert.equal(r.invalid, true);
  assert.equal(r.date, null);
});

test("activation: disabled flag → inactive regardless of schedule", () => {
  const r = getNewsSovActivation(new Date("2026-07-20T12:00:00Z"), {
    enabled: false,
    enableFromRaw: "2026-07-13",
  });
  assert.equal(r.active, false);
  assert.equal(r.reason, "disabled");
});

test("activation: enabled with no enable-from → active immediately", () => {
  const r = getNewsSovActivation(new Date("2026-07-09T18:00:00Z"), {
    enabled: true,
    enableFromRaw: undefined,
  });
  assert.equal(r.active, true);
  assert.equal(r.reason, "active");
});

test("activation: date-only enable-from = Monday 00:00 UTC boundary", () => {
  const opts = { enabled: true, enableFromRaw: "2026-07-13" };
  // Sunday 23:59 UTC — still scheduled, inert.
  const before = getNewsSovActivation(new Date("2026-07-12T23:59:59Z"), opts);
  assert.equal(before.active, false);
  assert.equal(before.reason, "scheduled");
  assert.equal(before.enableFrom?.toISOString(), "2026-07-13T00:00:00.000Z");
  // Monday 00:00:00 UTC exactly — active.
  const atBoundary = getNewsSovActivation(new Date("2026-07-13T00:00:00Z"), opts);
  assert.equal(atBoundary.active, true);
  assert.equal(atBoundary.reason, "active");
  // Later in the week / weeks later — stays active (variable can be left set).
  const later = getNewsSovActivation(new Date("2026-08-01T09:00:00Z"), opts);
  assert.equal(later.active, true);
});

test("activation: invalid enable-from blocks activation (never a mid-week surprise)", () => {
  const r = getNewsSovActivation(new Date("2026-07-20T12:00:00Z"), {
    enabled: true,
    enableFromRaw: "next monday",
  });
  assert.equal(r.active, false);
  assert.equal(r.reason, "invalid_enable_from");
});
