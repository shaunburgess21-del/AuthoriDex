import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  isFeatureOverDailyCap,
  resolveFeatureCapUsd,
  _resetBudgetGuardForTesting,
  _seedSpendForTesting,
} from "../server/config/ai-budget-guard";

describe("resolveFeatureCapUsd", () => {
  it("reads a positive numeric cap", () => {
    assert.equal(resolveFeatureCapUsd("5"), 5);
    assert.equal(resolveFeatureCapUsd("0.25"), 0.25);
    assert.equal(resolveFeatureCapUsd(" 12.5 "), 12.5);
  });

  it("treats unset / blank as no cap", () => {
    assert.equal(resolveFeatureCapUsd(undefined), null);
    assert.equal(resolveFeatureCapUsd(""), null);
  });

  it("treats non-numeric and non-positive values as no cap", () => {
    // A typo'd env var must not silently disable the feature it guards.
    assert.equal(resolveFeatureCapUsd("abc"), null);
    assert.equal(resolveFeatureCapUsd("0"), null);
    assert.equal(resolveFeatureCapUsd("-3"), null);
    assert.equal(resolveFeatureCapUsd("NaN"), null);
  });
});

describe("isFeatureOverDailyCap", () => {
  beforeEach(() => {
    _resetBudgetGuardForTesting();
  });

  it("never blocks when no cap is configured", async () => {
    // Must also avoid touching the DB — this test runs without DATABASE_URL,
    // so a regression that removed the short-circuit would throw here rather
    // than return a value.
    assert.equal(await isFeatureOverDailyCap("sharp_ranker", null), false);
  });

  it("fails open when the spend table is unreadable", async () => {
    // No DATABASE_URL in the test env, so the dynamic import of llmSpendStore
    // throws. A billing-observability outage must not disable the feature.
    assert.equal(await isFeatureOverDailyCap("sharp_ranker", 5), false);
  });

  it("allows calls while today's spend is under the cap", async () => {
    _seedSpendForTesting("sharp_ranker", 0.8);
    assert.equal(await isFeatureOverDailyCap("sharp_ranker", 5), false);
  });

  it("blocks once spend reaches the cap", async () => {
    // Boundary is inclusive: at exactly the cap the budget is spent.
    _seedSpendForTesting("sharp_ranker", 5);
    assert.equal(await isFeatureOverDailyCap("sharp_ranker", 5), true);

    _seedSpendForTesting("sharp_ranker", 7.25);
    assert.equal(await isFeatureOverDailyCap("sharp_ranker", 5), true);
  });

  it("keeps caps independent per feature", async () => {
    // One runaway feature must not starve the others.
    _seedSpendForTesting("sharp_ranker", 9);
    _seedSpendForTesting("why_trending", 0.1);
    assert.equal(await isFeatureOverDailyCap("sharp_ranker", 5), true);
    assert.equal(await isFeatureOverDailyCap("why_trending", 5), false);
  });

  it("does not trust a reading from a previous UTC day", async () => {
    // A cap must reset at midnight. The stale reading is discarded, which
    // forces a re-read; with no DATABASE_URL that fails open to false —
    // the point is that yesterday's exhausted budget does not carry over.
    _seedSpendForTesting("sharp_ranker", 99, "2020-01-01");
    assert.equal(await isFeatureOverDailyCap("sharp_ranker", 5), false);
  });

  it("still short-circuits without a cap even when spend is huge", async () => {
    _seedSpendForTesting("sharp_ranker", 1000);
    assert.equal(await isFeatureOverDailyCap("sharp_ranker", null), false);
  });
});
