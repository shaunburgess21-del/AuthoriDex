/**
 * Unit tests for `computeJackpotPrediction` — the weekly-jackpot exact-score
 * guess.
 *
 * Background: the archetype drift terms consume `scoreDelta7d` / `change24h`,
 * which are PERCENTAGES (e.g. -3.3 for -3.3%). They used to be added straight
 * onto a `fameIndex` anchor in the hundreds of thousands, so every drift was
 * worth a handful of points (~0.0005% of anchor). The practical effect was that
 * all archetypes collapsed onto the same guess and only the ±2% noise term did
 * any work. The drifts are now converted to points against the anchor, with a
 * ±40% bound so a 100% weekly mover can't be driven into the
 * `JACKPOT_MAX_PREDICTED_SCORE` ceiling (where every agent would collide on the
 * identical number).
 *
 * Determinism: `computeJackpotPrediction` pulls four floats from the RNG — the
 * activity gate, the domain skip, the random abstain, then the noise term. A
 * constant 0.5 stub clears all three gates (0.5 is above every skip threshold
 * and below no abstain threshold) and makes the noise exactly zero, since noise
 * is `(nextFloat() * 2 - 1) * scale`. That leaves `predictedScore` equal to
 * `anchor + drift`, so the arithmetic can be asserted exactly rather than
 * within a tolerance.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { computeJackpotPrediction } from "../server/agents/decisionEngine";
import { JACKPOT_AGENT_COLLISION_RANGE } from "../server/agents/constants";
import { JACKPOT_MAX_PREDICTED_SCORE } from "../server/config/constants";
import { SIMULATION_V2_COHORT_ID } from "../server/agents/simulationProfile";
import type { RNG } from "../server/agents/prng";
import type { AgentConfigData, TrendSignals } from "../server/agents/types";

/** Clears every abstain gate and zeroes the noise term. See file header. */
const STEADY_RNG: RNG = { nextFloat: () => 0.5 };

const ANCHOR = 700_000;
const CATEGORY = "politics";

function makeAgent(overrides: Partial<AgentConfigData> = {}): AgentConfigData {
  return {
    id: "agent-1",
    userId: "user-1",
    displayName: "Test Agent",
    username: "test-agent",
    bio: "",
    archetype: "conservative",
    specialties: [CATEGORY],
    boldness: 0.5,
    contrarianism: 0.5,
    recencyWeight: 1.0,
    prestigeBias: 0.5,
    confidenceCal: 1.0,
    riskAppetite: 0.5,
    consensusSensitivity: 0.0,
    activityRate: 1.0,
    simulationProfile: {
      schemaVersion: 2,
      cohortId: SIMULATION_V2_COHORT_ID,
      personaBand: "sharp",
    },
    isActive: true,
    ...overrides,
  };
}

function makeSignals(overrides: Partial<TrendSignals> = {}): TrendSignals {
  return {
    trendScore: 0,
    fameIndex: ANCHOR,
    scoreBaseline: ANCHOR,
    scoreDelta7d: 0,
    change24h: 0,
    momentum: "Stable",
    trendDirection: "FLAT",
    ...overrides,
  };
}

/** Runs the engine and asserts it produced a guess rather than abstaining. */
function predict(
  agent: AgentConfigData,
  signals: TrendSignals,
  taken: Set<number> = new Set(),
): number {
  const decision = computeJackpotPrediction(agent, signals, taken, CATEGORY, STEADY_RNG);
  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.ok(decision.predictedScore != null, "expected a predictedScore");
  return decision.predictedScore as number;
}

// ---------------------------------------------------------------------------
// Percentage → points conversion
// ---------------------------------------------------------------------------

test("7d percentage drift scales with the anchor, not raw percentage points", () => {
  // -10% week, momentum_chaser extrapolates it at 1.5x with recencyWeight 1.0:
  // 700_000 * -0.10 * 1.5 = -105_000.
  const score = predict(
    makeAgent({ archetype: "momentum_chaser" }),
    makeSignals({ scoreDelta7d: -10 }),
  );

  assert.equal(score, 595_000);
});

test("a double-digit weekly move shifts the guess materially, not by a few points", () => {
  // Regression guard for the original bug: adding the raw percentage produced
  // a drift of ~15 points on a 700k anchor, i.e. no drift at all.
  const score = predict(
    makeAgent({ archetype: "recency_bias" }),
    makeSignals({ scoreDelta7d: -10 }),
  );

  assert.ok(
    Math.abs(score - ANCHOR) > ANCHOR * 0.01,
    `expected a drift over 1% of anchor, got ${Math.abs(score - ANCHOR)}`,
  );
});

test("archetypes reach materially different guesses from identical signals", () => {
  const signals = makeSignals({ scoreDelta7d: -10 });

  const conservative = predict(makeAgent({ archetype: "conservative" }), signals);
  const recencyBias = predict(makeAgent({ archetype: "recency_bias" }), signals);
  const longHorizon = predict(makeAgent({ archetype: "long_horizon" }), signals);

  // -70_000 raw move: conservative takes 0.15 of it, recency_bias 2.0.
  assert.equal(conservative, 689_500);
  assert.equal(recencyBias, 560_000);

  const spread = Math.max(conservative, recencyBias, longHorizon)
    - Math.min(conservative, recencyBias, longHorizon);
  assert.ok(
    spread > ANCHOR * 0.05,
    `expected archetypes to spread over 5% of anchor, got ${spread}`,
  );
});

test("news_reactive reads the 24h move in points without the legacy 30x coefficient", () => {
  // 700_000 * 0.05 * recencyWeight 1.0 = +35_000. The old code produced
  // 5 * 1.0 * 30 = 150 points, which was invisible at this anchor.
  const score = predict(
    makeAgent({ archetype: "news_reactive" }),
    makeSignals({ change24h: 5 }),
  );

  assert.equal(score, 735_000);
});

test("culture_tracker direction boost is anchor-relative and keeps its up/down asymmetry", () => {
  const up = predict(
    makeAgent({ archetype: "culture_tracker" }),
    makeSignals({ trendDirection: "UP" }),
  );
  const down = predict(
    makeAgent({ archetype: "culture_tracker" }),
    makeSignals({ trendDirection: "DOWN" }),
  );
  const flat = predict(
    makeAgent({ archetype: "culture_tracker" }),
    makeSignals({ trendDirection: "FLAT" }),
  );

  assert.equal(up, 704_200); // +0.6% of anchor
  assert.equal(down, 697_200); // -0.4% of anchor
  assert.equal(flat, ANCHOR);
  assert.ok(up - ANCHOR > ANCHOR - down, "UP nudge should exceed the DOWN nudge");
});

// ---------------------------------------------------------------------------
// Drift bound
// ---------------------------------------------------------------------------

test("extreme weekly movers are bounded to ±40% instead of hitting the score ceiling", () => {
  // A +100% week is real — it has been observed on the live roster. Unbounded,
  // recency_bias would compute 700_000 + (700_000 * 1.0 * 2.0) = 2_100_000 and
  // clamp to JACKPOT_MAX_PREDICTED_SCORE, putting every such agent on the exact
  // same number.
  const surging = predict(
    makeAgent({ archetype: "recency_bias" }),
    makeSignals({ scoreDelta7d: 100 }),
  );
  const collapsing = predict(
    makeAgent({ archetype: "recency_bias" }),
    makeSignals({ scoreDelta7d: -100 }),
  );

  assert.equal(surging, 980_000); // anchor + 40%
  assert.equal(collapsing, 420_000); // anchor - 40%
  assert.ok(surging < JACKPOT_MAX_PREDICTED_SCORE, "must not reach the score ceiling");
  assert.ok(collapsing > 1, "must not reach the score floor");
});

test("ordinary weekly moves are left untouched by the drift bound", () => {
  // A 5% week through recency_bias drifts 10% — comfortably inside the bound.
  const score = predict(
    makeAgent({ archetype: "recency_bias" }),
    makeSignals({ scoreDelta7d: 5 }),
  );

  assert.equal(score, 770_000);
});

// ---------------------------------------------------------------------------
// Already point-based archetypes must NOT be rescaled
// ---------------------------------------------------------------------------

test("baseline-relative archetypes keep operating on raw point differences", () => {
  // prestige_maximiser and contrarian derive their drift from
  // (scoreBaseline - anchor), which is already a point delta. Converting these
  // would have double-scaled them.
  const signals = makeSignals({ scoreBaseline: 750_000 });

  // (750_000 - 700_000) * prestigeBias 0.5 * 0.4 = +10_000
  assert.equal(predict(makeAgent({ archetype: "prestige_maximiser" }), signals), 710_000);
  // -(700_000 - 750_000) * contrarianism 0.5 * 0.5 = +12_500
  assert.equal(predict(makeAgent({ archetype: "contrarian" }), signals), 712_500);
});

// ---------------------------------------------------------------------------
// Collision handling
// ---------------------------------------------------------------------------

test("a taken number is nudged to a nearby free one", () => {
  const agent = makeAgent({ archetype: "conservative" });
  const signals = makeSignals({ scoreDelta7d: -10 });

  const natural = predict(agent, signals);
  const nudged = predict(agent, signals, new Set([natural]));

  assert.notEqual(nudged, natural);
  assert.ok(
    Math.abs(nudged - natural) <= JACKPOT_AGENT_COLLISION_RANGE,
    `expected a nudge within ±${JACKPOT_AGENT_COLLISION_RANGE}, got ${nudged - natural}`,
  );
});

test("abstains when the whole collision window is taken", () => {
  const agent = makeAgent({ archetype: "conservative" });
  const signals = makeSignals({ scoreDelta7d: -10 });

  const natural = predict(agent, signals);
  const blocked = new Set<number>();
  for (let offset = -JACKPOT_AGENT_COLLISION_RANGE; offset <= JACKPOT_AGENT_COLLISION_RANGE; offset++) {
    blocked.add(natural + offset);
  }

  const decision = computeJackpotPrediction(agent, signals, blocked, CATEGORY, STEADY_RNG);
  assert.equal(decision.abstain, true);
  assert.equal(decision.abstainReason, "low_edge");
});
