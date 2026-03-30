import test from "node:test";
import assert from "node:assert/strict";
import { getCanonicalNativeCycle } from "../client/src/lib/nativeMarketLifecycle";

test("canonical cycle prefers fresh resolution deadline over stale rows", () => {
  const now = Date.now();
  const staleResolution = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const freshResolution = new Date(now + 6 * 24 * 60 * 60 * 1000).toISOString();
  const freshCutoff = new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString();

  const cycle = getCanonicalNativeCycle([
    { bettingCutoff: staleResolution, resolutionDeadline: staleResolution },
    { bettingCutoff: freshCutoff, resolutionDeadline: freshResolution },
  ]);

  assert.equal(cycle.resolutionDeadline, freshResolution);
  assert.equal(cycle.bettingCutoff, freshCutoff);
});

test("canonical cycle falls back to latest available when all rows are stale", () => {
  const now = Date.now();
  const staleA = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
  const staleB = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

  const cycle = getCanonicalNativeCycle([
    { bettingCutoff: staleA, resolutionDeadline: staleA },
    { bettingCutoff: staleB, resolutionDeadline: staleB },
  ]);

  assert.equal(cycle.resolutionDeadline, staleB);
  assert.equal(cycle.bettingCutoff, staleB);
});
