/**
 * Unit tests for the conviction-times-edge stake curve in
 * `computeAgentStakeAmount` (Agent v2).
 *
 * The curve replaces the old `edgeBoost * wide-random-variance` formula:
 *
 *   smartness = convictionFactor * edgeFactor      // 0..1.5
 *   stake     = base(confidence) * stakeMultiplier
 *               * (1 + 0.6 * smartness)             // up to ~1.9x floor
 *               * narrowVariance(0.85..1.15)        // ±15%
 *
 * These tests pin three things:
 *   1. High conviction + high edge sizes UP relative to a baseline pick.
 *   2. Low conviction (or no pick) sizes near base — the LLM hasn't
 *      authorised a stretch.
 *   3. Persona min / softMax caps still bound the output.
 *
 * We use Math.random() seeding to control the variance; `node:test` runs
 * deterministically per file so we monkey-patch Math.random for the
 * narrow-variance multiplier and softMax jitter.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const { _computeAgentStakeAmountForTesting: computeAgentStakeAmount } =
  await import("../server/agents/agentRunner");
import type { AgentConfigData, PredictionDecision } from "../server/agents/types";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function sharpAgent(): AgentConfigData {
  return {
    id: "agent-1",
    userId: "user-1",
    displayName: "Sharp Sam",
    username: "sharp_sam",
    bio: "",
    archetype: "domain_specialist",
    specialties: ["sport"],
    boldness: 0.5,
    contrarianism: 0.3,
    recencyWeight: 0.5,
    prestigeBias: 0.5,
    confidenceCal: 0.7,
    riskAppetite: 0.5,
    consensusSensitivity: 0.5,
    activityRate: 0.6,
    simulationProfile: {
      schemaVersion: 2,
      cohortId: "v2-2026-prelaunch",
      personaBand: "sharp",
      skillTier: 0.85,
      favoriteCategories: [],
      edgeThreshold: 0.02,
      publicConfidenceRate: 0.4,
      stakeMultiplier: 1.0,
      minStake: 100,
      maxStake: 500,
      weeklyVoteCap: 3,
      weeklyCommentCap: 2,
      dailyVoteChance: 0.18,
      dailyCommentChance: 0.026,
      commentStyle: "analytical",
      bankrollProfile: "normal",
    },
    isActive: true,
  };
}

function decision(confidence: number, edge: number): PredictionDecision {
  return {
    abstain: false,
    entryId: "e-1",
    direction: "yes",
    confidence,
    edge,
    impliedProbability: 0.5,
    rawProbability: 0.5,
    source: "deterministic",
  };
}

/**
 * Drive Math.random to a fixed value so the narrow-variance multiplier
 * and softMax jitter are deterministic. `seq` lets us return different
 * values on successive calls when the function reads it more than once
 * (which `computeAgentStakeAmount` does: variance, then capJitter).
 */
function withFixedRandom<T>(values: number[], fn: () => T): T {
  const real = Math.random;
  let i = 0;
  Math.random = () => values[Math.min(i++, values.length - 1)];
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

// ---------------------------------------------------------------------------
// Conviction × edge sizes up vs no pick
// ---------------------------------------------------------------------------

test("high conviction + high edge sizes meaningfully UP vs the no-pick baseline", () => {
  const agent = sharpAgent();
  // Use the SAME random sequence for both calls so any size difference is
  // attributable to the smartness multiplier, not RNG.
  const baseline = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0)),
  );
  const conviction = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0), { conviction: 0.9, edge: 0.15 }),
  );
  // smartness = 0.9 * 1.5 = 1.35 → 1 + 0.6 * 1.35 = 1.81x (vs baseline 1 + 0.6 * 0.6 * 0.0 = 1.0x)
  // So conviction stake should be ~1.8x baseline, give or take rounding.
  assert.ok(
    conviction > baseline * 1.5,
    `conviction(${conviction}) should be > baseline(${baseline}) * 1.5`,
  );
  assert.ok(
    conviction < baseline * 2.2,
    `conviction(${conviction}) should be < baseline(${baseline}) * 2.2 (cap is 1.9x curve)`,
  );
});

test("low conviction (0.2) sizes near the base, not above", () => {
  const agent = sharpAgent();
  // A reasonable confidence/edge but weak conviction → smartness near 0
  // → multiplier near 1.0.
  // smartness = 0.2 * (0.05/0.10) = 0.10 → 1 + 0.6 * 0.10 = 1.06x
  const stake = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0.05), { conviction: 0.2, edge: 0.05 }),
  );
  const flat = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0)),
  );
  // The 0.2 conviction stake should sit in a tight band around flat:
  // 1.06x curve vs 1.0x baseline curve, both with same variance/cap RNG.
  // Ratio cap 1.15 because variance is ±15% but the random is fixed here.
  assert.ok(
    stake >= flat,
    `low conviction should not size below flat (${stake} vs ${flat})`,
  );
  assert.ok(stake <= flat * 1.15, `low conviction should not stretch (${stake} vs ${flat})`);
});

test("no pick (null) falls back to deterministic decision.edge", () => {
  // Sharp with deterministic edge=0.10 and no LLM pick should still
  // size up (fallback conviction 0.6 × edgeFactor 1.0 = 0.6 smartness).
  const agent = sharpAgent();
  const baseline = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0)),
  );
  const fallback = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0.10), null),
  );
  // smartness = 0.6 * 1.0 = 0.6 → 1.36x vs 1.0x baseline
  assert.ok(
    fallback > baseline * 1.2,
    `fallback(${fallback}) should be > baseline(${baseline}) * 1.2`,
  );
});

// ---------------------------------------------------------------------------
// Persona caps still hold
// ---------------------------------------------------------------------------

test("output is clamped to >= simulation.minStake even with low confidence", () => {
  const agent = sharpAgent(); // minStake=100
  const stake = withFixedRandom([0.0, 0.0], () =>
    computeAgentStakeAmount(agent, decision(0.5, 0)),
  );
  assert.ok(stake >= 100, `stake ${stake} should be >= minStake 100`);
});

test("output is clamped to <= simulation.maxStake * (1 ± 0.08) even with max smartness", () => {
  const agent = sharpAgent(); // maxStake=500
  // Force minimum cap jitter (0.92) and max variance (1.0 - boundary).
  // We expect the cap clamp to kick in when smartness is huge.
  const stake = withFixedRandom([1.0, 0.0], () =>
    computeAgentStakeAmount(agent, decision(0.95, 0), { conviction: 1.0, edge: 0.5 }),
  );
  // With capJitter at 0.92, softMax = round(500 * 0.92) = 460.
  assert.ok(stake <= 460, `stake ${stake} should be clamped to ~maxStake-jitter`);
});

// ---------------------------------------------------------------------------
// Edge magnitude: signed pick edge uses |.|
// ---------------------------------------------------------------------------

test("negative pick edge uses absolute magnitude (DOWN bets size like UP)", () => {
  const agent = sharpAgent();
  const upPick = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0), { conviction: 0.8, edge: 0.15 }),
  );
  const downPick = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0), { conviction: 0.8, edge: -0.15 }),
  );
  assert.equal(upPick, downPick, "signed edge should not affect stake size");
});

// ---------------------------------------------------------------------------
// Edge factor cap at 1.5 (10% edge = full size, anything beyond stretches)
// ---------------------------------------------------------------------------

test("edge beyond 15% does not keep stretching size unboundedly", () => {
  const agent = sharpAgent();
  const at10 = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0), { conviction: 0.8, edge: 0.10 }),
  );
  const at15 = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0), { conviction: 0.8, edge: 0.15 }),
  );
  const at50 = withFixedRandom([0.5, 0.5], () =>
    computeAgentStakeAmount(agent, decision(0.7, 0), { conviction: 0.8, edge: 0.50 }),
  );
  // 10% edge → edgeFactor=1.0; 15% → 1.5 (cap); 50% → still 1.5 (capped)
  assert.ok(at15 >= at10, `at15(${at15}) >= at10(${at10})`);
  assert.equal(at50, at15, `at50(${at50}) should equal at15(${at15}) — cap holds`);
});
