import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldApplyNews24hDecayFloor,
  shouldUseRawNewsCountForScoring,
} from "../server/scoring/news-smoothing";

test("shouldUseRawNewsCountForScoring: true when HEALTHY and no fallback", () => {
  assert.equal(
    shouldUseRawNewsCountForScoring({
      newsHealthState: "HEALTHY",
      newsUsedFallback: false,
      newsNeedsOutageFallback: false,
    }),
    true,
  );
});

test("shouldUseRawNewsCountForScoring: false when DEGRADED", () => {
  assert.equal(
    shouldUseRawNewsCountForScoring({
      newsHealthState: "DEGRADED",
      newsUsedFallback: false,
      newsNeedsOutageFallback: false,
    }),
    false,
  );
});

test("shouldApplyNews24hDecayFloor: false on healthy path", () => {
  assert.equal(
    shouldApplyNews24hDecayFloor({
      newsNeedsOutageFallback: false,
      newsUsedFallback: false,
      newsHealthState: "HEALTHY",
    }),
    false,
  );
});

test("shouldApplyNews24hDecayFloor: true when DEGRADED", () => {
  assert.equal(
    shouldApplyNews24hDecayFloor({
      newsNeedsOutageFallback: false,
      newsUsedFallback: false,
      newsHealthState: "DEGRADED",
    }),
    true,
  );
});
