import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { evaluateAutoResolveEligibility } = await import(
  "../server/jobs/auto-resolve-shadow"
);

type Signal = Parameters<typeof evaluateAutoResolveEligibility>[0];

function baseSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    marketId: "m1",
    title: "How big will Moana's 2026 opening weekend be?",
    slug: "moana-2026-opening-weekend",
    marketType: "community",
    openMarketType: "multi",
    signalSource: "source_watch",
    stage: "met",
    recommendedAction: "resolve_now",
    confidence: 0.99,
    proposedWinnerEntryId: "e-3944",
    proposedWinnerLabel: "39-44m",
    entryCount: 5,
    isResidualOther: false,
    isKnockoutSingleWinner: false,
    upstreamResolved: true,
    ...overrides,
  };
}

test("clean deterministic single-winner World Market clears the gate", () => {
  const v = evaluateAutoResolveEligibility(baseSignal());
  assert.equal(v.wouldAutoResolve, true);
  assert.deepEqual(v.holdReasons, []);
});

test("LLM-only signal is always held", () => {
  const v = evaluateAutoResolveEligibility(baseSignal({ signalSource: "llm_scout" }));
  assert.equal(v.wouldAutoResolve, false);
  assert.ok(v.holdReasons.includes("llm_only_signal"));
});

test("near-certain / resolve-soon is held (only met + resolve_now clears)", () => {
  const v = evaluateAutoResolveEligibility(
    baseSignal({ stage: "near_certain", recommendedAction: "resolve_soon" }),
  );
  assert.equal(v.wouldAutoResolve, false);
  assert.ok(v.holdReasons.includes("not_met_resolve_now"));
});

test("no mapped winner (void/unmappable) is held", () => {
  const v = evaluateAutoResolveEligibility(
    baseSignal({ proposedWinnerEntryId: null, proposedWinnerLabel: "Void / review" }),
  );
  assert.equal(v.wouldAutoResolve, false);
  assert.ok(v.holdReasons.includes("no_single_winner"));
});

test("knockout single-winner is held (needs advancing team)", () => {
  const v = evaluateAutoResolveEligibility(baseSignal({ isKnockoutSingleWinner: true }));
  assert.equal(v.wouldAutoResolve, false);
  assert.ok(v.holdReasons.includes("knockout_needs_advancer"));
});

test("residual Other winner is held in v1", () => {
  const v = evaluateAutoResolveEligibility(
    baseSignal({ isResidualOther: true, proposedWinnerLabel: "Other" }),
  );
  assert.equal(v.wouldAutoResolve, false);
  assert.ok(v.holdReasons.includes("residual_other_unproven"));
});

test("low confidence is held", () => {
  const v = evaluateAutoResolveEligibility(baseSignal({ confidence: 0.8 }));
  assert.equal(v.wouldAutoResolve, false);
  assert.ok(v.holdReasons.includes("low_confidence"));
});

test("non-World-Market type is held (v1 scope)", () => {
  const v = evaluateAutoResolveEligibility(baseSignal({ marketType: "updown" }));
  assert.equal(v.wouldAutoResolve, false);
  assert.ok(v.holdReasons.includes("not_world_market"));
});

test("upstream not resolved is held", () => {
  const v = evaluateAutoResolveEligibility(baseSignal({ upstreamResolved: false }));
  assert.equal(v.wouldAutoResolve, false);
  assert.ok(v.holdReasons.includes("upstream_not_resolved"));
});

test("multiple failing gates accumulate reasons", () => {
  const v = evaluateAutoResolveEligibility(
    baseSignal({
      signalSource: "llm_scout",
      stage: "watch",
      recommendedAction: "watch",
      proposedWinnerEntryId: null,
      confidence: 0.5,
    }),
  );
  assert.equal(v.wouldAutoResolve, false);
  assert.ok(v.holdReasons.length >= 4);
});
