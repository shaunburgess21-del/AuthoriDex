/**
 * Unit tests for score-aware conviction follow-ups.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createPRNG } from "../server/agents/prng";
import {
  computeConvictionFollowUp,
  _scoreFavouredEntryIdForTesting,
} from "../server/agents/convictionEngine";

const UP = "up-id";
const DOWN = "down-id";

function baseInput(
  overrides: Partial<{
    anchorEntryId: string;
    pctChangeVsOpen: number;
    contrarianism: number;
  }> = {},
) {
  return {
    anchorEntryId: UP,
    upEntryId: UP,
    downEntryId: DOWN,
    pctChangeVsOpen: -0.13,
    contrarianism: 0.5,
    ...overrides,
  };
}

test("flat zone returns null when |pct| < 5%", () => {
  assert.equal(
    computeConvictionFollowUp(baseInput({ pctChangeVsOpen: 0.03 }), createPRNG(1)),
    null,
  );
  assert.equal(
    computeConvictionFollowUp(baseInput({ pctChangeVsOpen: -0.04 }), createPRNG(1)),
    null,
  );
});

test("scoreFavouredEntryId maps sign to entries", () => {
  assert.equal(_scoreFavouredEntryIdForTesting(0.08, UP, DOWN), UP);
  assert.equal(_scoreFavouredEntryIdForTesting(-0.08, UP, DOWN), DOWN);
  assert.equal(_scoreFavouredEntryIdForTesting(0.02, UP, DOWN), null);
});

test("score agrees with UP hold -> double down by default", () => {
  const rng = createPRNG(42);
  let doubles = 0;
  for (let i = 0; i < 200; i++) {
    const r = computeConvictionFollowUp(
      baseInput({ pctChangeVsOpen: 0.12, anchorEntryId: UP }),
      createPRNG(42 + i),
    );
    assert.ok(r);
    if (r!.doubled) doubles++;
  }
  assert.ok(doubles > 150, `expected mostly double-down when score agrees; got ${doubles}/200`);
});

test("score disagrees with UP hold -> flip toward DOWN by default", () => {
  let flips = 0;
  for (let i = 0; i < 200; i++) {
    const r = computeConvictionFollowUp(
      baseInput({ pctChangeVsOpen: -0.13, anchorEntryId: UP }),
      createPRNG(100 + i),
    );
    assert.ok(r);
    assert.equal(r!.scoreAgreesWithHold, false);
    if (r!.chosenEntryId === DOWN) flips++;
  }
  assert.ok(flips > 100, `expected majority flip to DOWN; got ${flips}/200`);
});

test("confidence scales with |pctChangeVsOpen|", () => {
  const r = computeConvictionFollowUp(
    baseInput({ pctChangeVsOpen: -0.13 }),
    createPRNG(1),
  );
  assert.ok(r);
  assert.equal(r!.confidence, 0.73);
});
