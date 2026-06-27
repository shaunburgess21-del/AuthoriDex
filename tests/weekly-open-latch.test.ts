import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveDecisiveLatched,
  wouldDisarmLatch,
  median,
  medianTrailingLatchPct,
  shouldLatchFromTrailingMedian,
  pctChangeVsOpenFromFame,
} from "../server/agents/weeklyOpenLatch";

const latchedMeta = {
  weeklyOpen: {
    decisiveLatched: true,
    peakAbsPctChangeVsOpen: 0.28,
  },
};

test("resolveDecisiveLatched stays true when latched and move still decisive", () => {
  assert.equal(
    resolveDecisiveLatched(latchedMeta, 0.15, { latchRevertEnabled: true }),
    true,
  );
});

test("resolveDecisiveLatched disarms when latched and score reverts near flat", () => {
  assert.equal(
    resolveDecisiveLatched(latchedMeta, 0.003, { latchRevertEnabled: true }),
    false,
  );
});

test("resolveDecisiveLatched ignores revert guard when latch revert disabled", () => {
  assert.equal(
    resolveDecisiveLatched(latchedMeta, 0.003, { latchRevertEnabled: false }),
    true,
  );
});

test("wouldDisarmLatch false when not previously latched", () => {
  assert.equal(wouldDisarmLatch({}, 0.01), false);
});

test("median returns middle value for odd-length arrays", () => {
  assert.equal(median([0.1, 0.3, 0.2]), 0.2);
});

test("medianTrailingLatchPct ignores single-hour outlier when median stays below threshold", () => {
  const opening = 400_000;
  const samples = [
    410_000, // +2.5%
    405_000, // +1.25%
    311_938, // -22% glitch — should not drive latch alone
  ];
  const medianPct = medianTrailingLatchPct(samples, opening);
  assert.ok(medianPct != null);
  assert.ok(Math.abs(medianPct!) < 0.1);

  const { latch } = shouldLatchFromTrailingMedian(samples, opening, 0.1);
  assert.equal(latch, false);
});

test("shouldLatchFromTrailingMedian latches when median move is decisive", () => {
  const opening = 400_000;
  const samples = [520_000, 515_000, 510_000];
  const { latch, medianPct } = shouldLatchFromTrailingMedian(samples, opening, 0.1);
  assert.equal(latch, true);
  assert.ok(medianPct != null && medianPct > 0.25);
});

test("pctChangeVsOpenFromFame guards zero opening score", () => {
  assert.equal(pctChangeVsOpenFromFame(500_000, 0), null);
});
