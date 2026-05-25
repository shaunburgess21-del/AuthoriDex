import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const {
  buildCalibrationHistogram,
  getNativeLlmStatus,
} = await import("../server/services/native-markets-calibration");
import type { NativeCalibrationRow } from "../server/services/native-markets-calibration";

test("buildCalibrationHistogram buckets pctVsOpen and averages ammUpPct", () => {
  const rows: NativeCalibrationRow[] = [
    {
      marketId: "a",
      personName: "A",
      category: "music",
      marketType: "updown",
      pctVsOpen: 0.04,
      ammUpPct: 0.62,
      compositeImpliedPct: 0.58,
      llmProbability: null,
      llmDirection: null,
      mispricingVsComposite: 0.04,
      disagreementDelta: null,
      rationale: null,
      lastAssessedAt: null,
      openingScore: 100,
      currentScore: 104,
    },
    {
      marketId: "b",
      personName: "B",
      category: "music",
      marketType: "updown",
      pctVsOpen: 0.06,
      ammUpPct: 0.66,
      compositeImpliedPct: 0.6,
      llmProbability: null,
      llmDirection: null,
      mispricingVsComposite: 0.06,
      disagreementDelta: null,
      rationale: null,
      lastAssessedAt: null,
      openingScore: 100,
      currentScore: 106,
    },
  ];
  const { buckets } = buildCalibrationHistogram(rows);
  assert.ok(buckets.length >= 1);
  assert.ok(buckets.every((b) => b.count > 0 && b.avgAmmUpPct > 0));
});

test("getNativeLlmStatus exposes flag, model, and budget snapshot fields", () => {
  const status = getNativeLlmStatus();
  assert.equal(typeof status.enabled, "boolean");
  assert.equal(typeof status.model, "string");
  assert.equal(typeof status.budget.spendUsd, "number");
  assert.equal(typeof status.budget.capUsd, "number");
  assert.equal(typeof status.callsToday, "number");
});
