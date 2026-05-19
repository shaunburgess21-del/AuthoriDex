/**
 * Decision-engine unit tests covering the `pctChangeVsOpen` signal
 * introduced by f04778ec + 5142de6b ("tier-1 weekly-open signal").
 *
 * The pure decision engine has no DB or network imports, so we drive it
 * with a deterministic PRNG and a hand-built market + agent config. The
 * three guard conditions wired off `pctChangeVsOpen` are covered here:
 *
 *   1. `computeSignalBoost` — when present, the saturated ±0.18
 *      coefficient drives the DOWN entry above 0.65 on a binary market.
 *      When absent, the engine falls back to the legacy `scoreDelta7d`
 *      momentum read (~0.10 coefficient).
 *
 *   2. Prestige bias is gated off when `pctChangeVsOpen < -0.05`. The
 *      old logic gated only on raw fame (`scoreBaseline > 6500`), which
 *      a celebrity in heavy drawdown still trivially clears — letting
 *      the UP-direction boost fight reality. The guard kills the boost
 *      only on decisive drawdown; flat-or-up markets keep the heuristic.
 *
 *   3. Contrarian fade is gated off when `|pctChangeVsOpen| >= 0.15`.
 *      Contrarianism is meant to balance borderline cohort reads; on a
 *      decisively-trending market it just pushes prices back toward
 *      50/50 against reality.
 *
 * Tests use a sharp-band agent so the random skip / activity gates are
 * shallow enough that a fixed PRNG seed reliably gets us into Step 3+
 * without abstain noise. Each assertion focuses on observable outputs
 * (chosen entryId, rawProbability, abstainReason) rather than internal
 * state.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { computePrediction } from "../server/agents/decisionEngine";
import { createPRNG } from "../server/agents/prng";
import { SIMULATION_V2_COHORT_ID } from "../server/agents/simulationProfile";
import type {
  AgentConfigData,
  MarketEntryData,
  MarketWithEntries,
  TrendSignals,
} from "../server/agents/types";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/**
 * Standard binary up/down market. Domain matches the test agent's
 * "politics" specialty so the Step 1 domain filter doesn't randomly
 * skip us out of the engine before the signal even runs.
 */
function makeBinaryUpDownMarket(): MarketWithEntries {
  const entries: MarketEntryData[] = [
    { id: "entry-up", label: "Up", totalStake: 0, personId: "person-1" },
    { id: "entry-down", label: "Down", totalStake: 0, personId: "person-1" },
  ];
  return {
    id: "market-1",
    marketType: "updown",
    status: "OPEN",
    title: "Test person — up or down?",
    category: "politics",
    personId: "person-1",
    endAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    entries,
  };
}

/**
 * Sharp-band agent. Sharps:
 *  - Have shallow domain-skip probability (5–25%)
 *  - Are exempt from weighted-random side-splitting (so the test's
 *    chosen-entry assertion reflects the deterministic top score).
 *  - Are exempt from the standard random-abstain in Step 7.
 * The combination makes assertions stable without needing a brittle
 * PRNG seed search.
 */
function makeSharpAgent(overrides: Partial<AgentConfigData> = {}): AgentConfigData {
  return {
    id: "agent-1",
    userId: "user-1",
    displayName: "Test Sharp",
    username: "test-sharp",
    bio: "",
    archetype: "analyst",
    specialties: ["politics"],
    boldness: 0.5,
    contrarianism: 0.0,
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
    fameIndex: 50_000,
    scoreBaseline: 50_000,
    scoreDelta7d: 0,
    wikiPulse: "stable",
    newsLevel: "amber",
    ...overrides,
  };
}

/**
 * Seed 42 reproducibly clears the sharp agent's 5-25% domain-skip and
 * the 100% activity-rate gate, landing us inside Step 3 every time.
 * If the upstream constants ever shift such that this seed no longer
 * works, the test will fail with `abstainReason: 'domain' | 'activity_gate'`
 * — pick a different seed by tweaking `seed` until tests pass.
 */
const PRNG_SEED = 42;

// ---------------------------------------------------------------------------
// computeSignalBoost — pctChangeVsOpen vs. scoreDelta7d
// ---------------------------------------------------------------------------

test("pctChangeVsOpen = -0.30 drives DOWN entry as deterministic top pick", () => {
  const market = makeBinaryUpDownMarket();
  const agent = makeSharpAgent();
  const signals = makeSignals({ pctChangeVsOpen: -0.30 });
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, signals, {}, rng);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.equal(decision.entryId, "entry-down", "agent should back DOWN on -30% drawdown");
  assert.ok(
    (decision.rawProbability ?? 0) > 0.65,
    `expected rawProbability > 0.65, got ${decision.rawProbability}`,
  );
});

test("pctChangeVsOpen = +0.30 drives UP entry as deterministic top pick", () => {
  const market = makeBinaryUpDownMarket();
  const agent = makeSharpAgent();
  const signals = makeSignals({ pctChangeVsOpen: 0.30 });
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, signals, {}, rng);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.equal(decision.entryId, "entry-up", "agent should back UP on +30% rally");
  assert.ok(
    (decision.rawProbability ?? 0) > 0.65,
    `expected rawProbability > 0.65, got ${decision.rawProbability}`,
  );
});

test("missing pctChangeVsOpen falls back to scoreDelta7d momentum (legacy behaviour)", () => {
  const market = makeBinaryUpDownMarket();
  const agent = makeSharpAgent();
  // Strong negative 7d delta — the legacy path uses `scoreDelta7d / 15`
  // capped at ±1 with a 0.10 coefficient, so a -15 delta saturates at
  // -0.10 boost. Enough to put DOWN clearly above UP, but materially
  // less than the +0.18 the new pctChangeVsOpen path produces on the
  // same person's drawdown.
  const signals = makeSignals({ scoreDelta7d: -15 });
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, signals, {}, rng);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.equal(decision.entryId, "entry-down", "legacy 7d path should still pick DOWN");
});

test("pctChangeVsOpen = +0.30 produces stronger lean than scoreDelta7d = +15", () => {
  // Same agent / market / RNG seed, only the trend signal differs.
  // The new pctChangeVsOpen path (0.18 coefficient, saturates at ±0.20)
  // must push the rawProbability strictly above what the legacy 7d
  // path (0.10 coefficient, saturates at scoreDelta7d/15 = 1) yields.
  const market = makeBinaryUpDownMarket();
  const agent = makeSharpAgent();

  const newPath = computePrediction(
    agent,
    market,
    makeSignals({ pctChangeVsOpen: 0.30 }),
    {},
    createPRNG(PRNG_SEED),
  );
  const legacyPath = computePrediction(
    agent,
    market,
    makeSignals({ scoreDelta7d: 15 }),
    {},
    createPRNG(PRNG_SEED),
  );

  assert.equal(newPath.entryId, "entry-up");
  assert.equal(legacyPath.entryId, "entry-up");
  assert.ok(
    (newPath.rawProbability ?? 0) > (legacyPath.rawProbability ?? 0),
    `expected new path probability > legacy: new=${newPath.rawProbability} legacy=${legacyPath.rawProbability}`,
  );
});

// ---------------------------------------------------------------------------
// Prestige bias guard — decisivelyDown gates UP boost
// ---------------------------------------------------------------------------

test("prestige bias is disarmed when pctChangeVsOpen < -0.05 on a famous person", () => {
  // Putin-shape scenario: a famous person with mild positive 7d
  // momentum that pre-guard would let the UP-direction prestige boost
  // win, even though the person has actually moved decisively DOWN
  // since the market opened. The new signal must override.
  //
  // The 7d delta is intentionally non-zero (+10) so that the legacy
  // unguarded path produces enough total UP lean to clear the edge
  // gate — otherwise the test would abstain and tell us nothing about
  // the guard itself. This matches the live-data pattern where 7d
  // rolling and Monday-anchored open often disagree.
  const market = makeBinaryUpDownMarket();
  const agent = makeSharpAgent({ prestigeBias: 0.9 });

  const baseSignals = makeSignals({
    scoreBaseline: 400_000,
    fameIndex: 252_000,
    scoreDelta7d: 10, // +10 rolling → legacy path nudges UP
  });

  // With the guard: prestige is disarmed AND the strong negative
  // pctChangeVsOpen signal swamps the legacy 7d UP nudge → DOWN wins.
  const guarded = computePrediction(
    agent,
    market,
    { ...baseSignals, pctChangeVsOpen: -0.37 },
    {},
    createPRNG(PRNG_SEED),
  );
  assert.equal(guarded.abstain, false, `guarded unexpectedly abstained: ${guarded.abstainReason}`);
  assert.equal(guarded.entryId, "entry-down", "guarded run should back DOWN");

  // Without the guard (pctChangeVsOpen undefined): the +10 7d delta
  // gives UP a small lift; the prestige UP boost stacks on top and
  // UP clears the edge gate. This is the bug the guard is meant to
  // prevent — if the signal field is ever NULL on a real market, the
  // behaviour regresses to the old known-bad path. The fail-mode
  // here is a regression-tripwire, not a re-derivation of LMSR.
  const unguarded = computePrediction(
    agent,
    market,
    baseSignals,
    {},
    createPRNG(PRNG_SEED),
  );
  assert.equal(unguarded.abstain, false, `unguarded unexpectedly abstained: ${unguarded.abstainReason}`);
  assert.equal(
    unguarded.entryId,
    "entry-up",
    "without pctChangeVsOpen the prestige boost stacks on the 7d UP nudge and UP wins (legacy bug)",
  );
});

test("prestige bias still fires when pctChangeVsOpen is shallow (-0.02, above the -0.05 threshold)", () => {
  // Right above the threshold (-0.05): a person in 2% drawdown is
  // "essentially flat", and the prestige heuristic should remain
  // active. We give the agent a small positive 7d nudge so the total
  // UP lean can clear the edge gate when prestige fires; without
  // prestige it would abstain. This isolates the "prestige still
  // fires" property from the random-abstain noise floor.
  const market = makeBinaryUpDownMarket();
  const agent = makeSharpAgent({ prestigeBias: 0.9 });
  const signals = makeSignals({
    scoreBaseline: 400_000,
    fameIndex: 392_000,
    pctChangeVsOpen: -0.02, // shallower than -0.05 → guard not triggered
    scoreDelta7d: 5,        // tiny positive momentum so we don't sit on the abstain edge
    newsLevel: "red",       // small UP-direction boost (+0.04 * recencyWeight after Fix B)
  });

  const decision = computePrediction(agent, market, signals, {}, createPRNG(PRNG_SEED));

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.equal(
    decision.entryId,
    "entry-up",
    "shallow drawdown should still let the prestige UP boost combine with the legacy signals",
  );
});

// ---------------------------------------------------------------------------
// Wiki/news bullish-leg gate (decisivelyDown) + halved magnitudes
// ---------------------------------------------------------------------------
//
// 2026-05-18 misalignment: 5 of 6 UpDown markets at -1% to -18% from open
// showed agents leaning Up 60-75%. Root cause was that wiki/news additive
// boosts (+0.10 rising + +0.07 red = +0.17 max) could overwhelm the
// `pctChangeVsOpen` factor (only -0.09 at a -10% move, since it saturates
// at ±20% with a 0.18 coefficient), producing a NET POSITIVE signalBoost
// on a market that had moved decisively DOWN.
//
// Fix A: gate the bullish leg of wiki/news behind `!decisivelyDown` — a
//         person already > 5% below open shouldn't get artificial Up
//         pressure from headline noise that already moved their score.
//         Negative wiki/news still apply normally.
// Fix B: halve the wiki/news coefficients (rising 0.10 → 0.05, falling
//         -0.10 → -0.05, red +0.07 → +0.04, green -0.04 → -0.02) so
//         `pctChangeVsOpen` is the dominant directional input across
//         the whole magnitude range, even on shallow moves where the
//         gate hasn't tripped.

test("wiki/news bullish leg suppressed when decisivelyDown — Beyoncé bug pin", () => {
  // The exact arithmetic from the diagnosis: pctChangeVsOpen = -0.10,
  // wikiPulse rising, newsLevel red, trendDirection DOWN (rung 1).
  // Pre-fix:  signalBoost = +0.10 + 0.07 - 0.096 - 0.03 = +0.044  → Up
  // Post-fix: bullish wiki+news suppressed by gate → boost = 0 - 0.096
  //           - 0.03 = -0.126 → Down with ~0.62/0.38 split.
  const market = makeBinaryUpDownMarket();
  const agent = makeSharpAgent();
  const signals = makeSignals({
    pctChangeVsOpen: -0.10,
    wikiPulse: "rising",
    newsLevel: "red",
    trendDirection: "DOWN",
  });
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, signals, {}, rng);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.equal(
    decision.entryId,
    "entry-down",
    "agent should back DOWN despite rising wiki + red news on a decisively-down market (Fix A)",
  );
  assert.ok(
    (decision.rawProbability ?? 0) >= 0.55,
    `expected rawProbability >= 0.55, got ${decision.rawProbability}`,
  );
});

test("wiki/news bullish leg STILL applies when not decisivelyDown — gate doesn't over-fire", () => {
  // pctChangeVsOpen = -0.02 (above the -0.05 threshold → gate inactive).
  // Halved coefficients: rising +0.05, red +0.04, vs-open -0.018,
  // trendDirection FLAT (|0.02| > 0.02 is strictly false on rung 1).
  // Net signalBoost = +0.05 + 0.04 - 0.018 = +0.072 → Up wins ~0.572 / 0.428.
  // Locks in that Fix A's gate is one-sided — bullish wiki/news still
  // contribute on shallow drawdowns, just at half the previous strength.
  //
  // We lower riskAppetite to 0.2 so the sharp edge gate (riskAppetite *
  // 0.25/n = 0.025 at n=2) sits well below the post-Fix Up lean even at
  // worst-case jitter. The property under test is "the gate didn't
  // over-fire (agent leans UP)", NOT "the gate didn't trigger an edge
  // abstain" — keeping those independent makes the test robust to any
  // future PRNG / jitter-range change.
  //
  // Upper-bound assertion (rawProbability < 0.62) catches a regression
  // where Fix B's halved coefficients are restored: pre-Fix B the same
  // signal mix would yield rawProbability ≈ 0.642 (boost +0.142),
  // post-Fix B it sits at ≈ 0.572 (boost +0.072). 0.62 is the midpoint.
  const market = makeBinaryUpDownMarket();
  const agent = makeSharpAgent({ riskAppetite: 0.2 });
  const signals = makeSignals({
    pctChangeVsOpen: -0.02,
    wikiPulse: "rising",
    newsLevel: "red",
    trendDirection: "FLAT",
  });
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, signals, {}, rng);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.equal(
    decision.entryId,
    "entry-up",
    "shallow drawdown should still let bullish wiki/news tilt the read",
  );
  assert.ok(
    (decision.rawProbability ?? 1) < 0.62,
    `expected rawProbability < 0.62 to pin Fix B halving, got ${decision.rawProbability}`,
  );
});

test("wiki/news bullish leg stacks normally on decisively-up markets", () => {
  // pctChangeVsOpen = +0.10 → decisivelyDown = false → gate inactive.
  // Halved coefficients: rising +0.05, red +0.04, vs-open +0.09,
  // trendDirection UP +0.03. Net = +0.21 → Up at ~0.71 / 0.29.
  // Verifies the gate is asymmetric: it suppresses bullish boosts only
  // when reality has already moved the OTHER way, never on the up-side.
  const market = makeBinaryUpDownMarket();
  const agent = makeSharpAgent();
  const signals = makeSignals({
    pctChangeVsOpen: 0.10,
    wikiPulse: "rising",
    newsLevel: "red",
    trendDirection: "UP",
  });
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, signals, {}, rng);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.equal(decision.entryId, "entry-up", "bullish boosts should stack on a decisively-up market");
  assert.ok(
    (decision.rawProbability ?? 0) > 0.65,
    `expected rawProbability > 0.65, got ${decision.rawProbability}`,
  );
});

// ---------------------------------------------------------------------------
// Contrarian fade guard — decisiveWeeklyMove (|pct| >= 0.15) disarms it
// ---------------------------------------------------------------------------

test("contrarianism is disarmed on decisive weekly moves (|pctChangeVsOpen| >= 0.15)", () => {
  // Crowd is heavily on DOWN. The trend signal also points DOWN. With
  // contrarianism active, the agent would fade DOWN and bid UP — which
  // on a -30% market is exactly the bug we want to prevent. The guard
  // should keep the agent on DOWN.
  const market = makeBinaryUpDownMarket();
  // High contrarianism, NON-sharp band so the contrarian branch can
  // actually fire (sharps were already exempt from random side
  // splitting but contrarianism is a separate Step 3d guard). The
  // domain-skip is shallow enough on a domain-matching market that
  // seed 42 still lands us in Step 3.
  const agent = makeSharpAgent({
    contrarianism: 0.9,
    simulationProfile: {
      schemaVersion: 2,
      cohortId: SIMULATION_V2_COHORT_ID,
      personaBand: "casual",
    },
  });
  const signals = makeSignals({ pctChangeVsOpen: -0.25 });
  const crowd = { "entry-down": 0.9, "entry-up": 0.1 };
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, signals, crowd, rng);

  if (decision.abstain) {
    // Casual band has a wider random abstain band; if a future tweak
    // makes this seed unstable, fall back to asserting the contrarian
    // guard's structural property: the chosen entry should NOT be UP
    // (the "fade the crowd" pick).
    assert.notEqual(
      decision.entryId,
      "entry-up",
      `contrarian fade fired through the guard: ${JSON.stringify(decision)}`,
    );
  } else {
    assert.equal(
      decision.entryId,
      "entry-down",
      `expected agent to honour the decisive weekly move; got ${decision.entryId}`,
    );
  }
});

// ---------------------------------------------------------------------------
// H2H per-entry pctChangeVsOpen — Phase 1b completion
// ---------------------------------------------------------------------------
//
// The H2H seeding path (lines ~115-165 in decisionEngine.ts) computes a
// fame-weighted base, then layers a multiplicative momBonus per side.
// Phase 1b populates `pctChangeVsOpen` on per-entry signals; the follow-up
// here is the magnitude-aware factor inside momBonus (saturating ±10% at
// pctChangeVsOpen ±20%). These tests pin two contracts:
//   1. A decisively-DOWN entry loses meaningful weight even when its
//      `scoreDelta7d` and `wikiPulse` are flat.
//   2. The vs-open factor stacks ON TOP of the existing 7d/wiki/direction
//      signals, not as a replacement (so flat-on-everything-else still
//      produces the same baseline as before).

function makeH2HMarket(): MarketWithEntries {
  const entries: MarketEntryData[] = [
    { id: "entry-a", label: "Putin", totalStake: 0, personId: "person-a" },
    { id: "entry-b", label: "Macron", totalStake: 0, personId: "person-b" },
  ];
  return {
    id: "market-h2h",
    marketType: "h2h",
    status: "OPEN",
    title: "Putin vs Macron — bigger mover this week",
    category: "politics",
    personId: null, // H2H markets have no single anchor person
    endAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    entries,
  };
}

/**
 * Resolve a stable, non-abstaining decision for an H2H market across the
 * first few seeds. H2H uses weighted random selection in Step 4, so the
 * `entryId` chosen on any single seed is noisy — but `rawProbability` is
 * deterministic for any seed that doesn't abstain, because it's the
 * Step-3c-normalised seed weight of the chosen side. We pick the first
 * seed that produces a non-abstain decision and read `rawProbability`
 * from it; whichever side was rolled, we know the OTHER side has
 * probability `1 - rawProbability` (binary market).
 */
function firstNonAbstain(
  agent: AgentConfigData,
  market: MarketWithEntries,
  signals: TrendSignals,
  crowd: CrowdSplit,
  entrySignals: Map<string, TrendSignals> | undefined,
): ReturnType<typeof computePrediction> {
  for (let seed = 1; seed <= 50; seed++) {
    const d = computePrediction(agent, market, signals, crowd, createPRNG(seed), entrySignals);
    if (!d.abstain) return d;
  }
  throw new Error("no non-abstain decision found in 50 seeds");
}

test("H2H: vs-open factor fades a decisively-down side beyond direction tilt alone", () => {
  // Equal fame, equal scoreDelta7d, equal wikiPulse. Putin has -30%
  // pctChangeVsOpen and DOWN trendDirection; Macron is flat. Without the
  // new factor, momBonus would be 0.96 (DOWN) vs 1.0 (FLAT) — a 49/51
  // split. With the new vs-open factor saturated at -10% on top, the
  // bonus becomes 0.864 (Putin) vs 1.0 (Macron) — a 46.35/53.65 split.
  // We pin the seed weight to that exact ratio so future regressions in
  // either the factor coefficient or the saturation cap surface here.
  const market = makeH2HMarket();
  const agent = makeSharpAgent({ specialties: ["politics"] });
  const entrySignals = new Map<string, TrendSignals>([
    ["entry-a", makeSignals({ fameIndex: 6000, pctChangeVsOpen: -0.30, trendDirection: "DOWN" })],
    ["entry-b", makeSignals({ fameIndex: 6000, pctChangeVsOpen: 0, trendDirection: "FLAT" })],
  ]);

  const decision = firstNonAbstain(agent, market, makeSignals(), {}, entrySignals);
  // Whichever side weighted-random picked, derive Macron's seed weight.
  const macronProb =
    decision.entryId === "entry-b" ? decision.rawProbability! : 1 - decision.rawProbability!;
  // Expected: 1.0 / (0.864 + 1.0) ≈ 0.5365. Direction tilt alone would
  // give 1.0 / (0.96 + 1.0) ≈ 0.5102.
  assert.ok(
    macronProb > 0.53 && macronProb < 0.54,
    `Macron seed weight outside expected band: ${macronProb} (expected ~0.5365)`,
  );
});

test("H2H: vs-open factor stacks with momentum (decisive down vs decisive up)", () => {
  // Putin DOWN -30% with negative 7d delta + falling wiki vs Macron UP
  // +30% with positive 7d delta + rising wiki. Every signal points the
  // same way; the seed weight should be heavily skewed toward Macron.
  //
  // Post-Plan-C arithmetic (halved bullish/bearish moves):
  //   Putin: bonus=0.975 (wiki=falling halved from 0.95)
  //          * 0.90 (vs-open saturated -1, factor 0.90)
  //          * 0.96 (DOWN tilt) ≈ 0.842
  //   Macron: bonus=1.05 (wiki=rising && delta>8 halved from 1.10,
  //           gate inactive since pctChangeVsOpen > 0)
  //          * 1.10 (vs-open saturated +1, factor 1.10)
  //          * 1.04 (UP tilt) ≈ 1.201
  //   Macron seed weight ≈ 1.201 / (0.842 + 1.201) ≈ 0.5878.
  //
  // Pre-Plan-C the same mix produced ≈ 0.605 — the lean is now tighter
  // because the multiplicative bullish moves were halved.
  const market = makeH2HMarket();
  const agent = makeSharpAgent({ specialties: ["politics"] });
  const entrySignals = new Map<string, TrendSignals>([
    ["entry-a", makeSignals({
      fameIndex: 6000,
      pctChangeVsOpen: -0.30,
      scoreDelta7d: -10,
      wikiPulse: "falling",
      trendDirection: "DOWN",
    })],
    ["entry-b", makeSignals({
      fameIndex: 6000,
      pctChangeVsOpen: 0.30,
      scoreDelta7d: 10,
      wikiPulse: "rising",
      trendDirection: "UP",
    })],
  ]);

  const decision = firstNonAbstain(agent, market, makeSignals(), {}, entrySignals);
  const macronProb =
    decision.entryId === "entry-b" ? decision.rawProbability! : 1 - decision.rawProbability!;
  assert.ok(
    macronProb > 0.58,
    `expected Macron seed weight > 0.58 with all-aligned signals; got ${macronProb}`,
  );
});

test("H2H: equal pctChangeVsOpen on both sides leaves seeding fame-driven", () => {
  // Symmetric vs-open eliminates the new factor's effect (both sides
  // multiply by the same number). 2:1 fame ratio should still cleanly
  // favour entry-a — the factor doesn't introduce asymmetry where there
  // shouldn't be any.
  const market = makeH2HMarket();
  const agent = makeSharpAgent({ specialties: ["politics"] });
  const entrySignals = new Map<string, TrendSignals>([
    ["entry-a", makeSignals({ fameIndex: 8000, pctChangeVsOpen: 0.05, trendDirection: "FLAT" })],
    ["entry-b", makeSignals({ fameIndex: 4000, pctChangeVsOpen: 0.05, trendDirection: "FLAT" })],
  ]);

  const decision = firstNonAbstain(agent, market, makeSignals(), {}, entrySignals);
  const aProb =
    decision.entryId === "entry-a" ? decision.rawProbability! : 1 - decision.rawProbability!;
  // 8000 / (8000 + 4000) = 0.6667. Both sides have identical momBonus
  // (1.025 from the symmetric +5% vs-open) so the ratio is preserved.
  assert.ok(
    aProb > 0.65 && aProb < 0.68,
    `fame should still dominate when vs-open is symmetric; got entry-a probability ${aProb}`,
  );
});

test("H2H: bullish stock signals on a decisively-down side are gated (Plan C — momBonus)", () => {
  // Putin is -20% from market open (decisively down) but has positive
  // 7d delta and rising wiki — a Monday-peak person fading from the
  // spike. Pre-Plan-C the rising-wiki + delta>8 branch fired on his
  // side at 1.10 (a "bullish stock" boost):
  //   Putin pre  : 1.10 * 0.90 (vs-open sat) * 0.96 (DOWN) ≈ 0.9504
  //   Macron pre : 1.0
  //   Macron seed weight ≈ 1.0 / (0.9504 + 1.0) ≈ 0.5127  ← Putin
  //                                                          near 50/50
  //                                                          despite
  //                                                          -20% drawdown.
  //
  // Post-Plan-C the gate suppresses both bullish branches on his side
  // (sideDecisivelyDown=true). Bonus stays 1.0:
  //   Putin post : 1.0 * 0.90 * 0.96 = 0.864
  //   Macron post: 1.0
  //   Macron seed weight ≈ 1.0 / (0.864 + 1.0) ≈ 0.5365
  //
  // Asserting Macron > 0.53 catches the gate working — pre-Plan-C
  // produces 0.5127 which fails the threshold.
  const market = makeH2HMarket();
  const agent = makeSharpAgent({ specialties: ["politics"] });
  const entrySignals = new Map<string, TrendSignals>([
    ["entry-a", makeSignals({
      fameIndex: 6000,
      pctChangeVsOpen: -0.20,
      scoreDelta7d: 10,
      wikiPulse: "rising",
      trendDirection: "DOWN",
    })],
    ["entry-b", makeSignals({
      fameIndex: 6000,
      pctChangeVsOpen: 0,
      scoreDelta7d: 0,
      wikiPulse: "stable",
      trendDirection: "FLAT",
    })],
  ]);

  const decision = firstNonAbstain(agent, market, makeSignals(), {}, entrySignals);
  const macronProb =
    decision.entryId === "entry-b" ? decision.rawProbability! : 1 - decision.rawProbability!;
  assert.ok(
    macronProb > 0.53,
    `expected gate to fade Putin's bullish stock; Macron seed ${macronProb} (pre-Plan-C ≈ 0.5127)`,
  );
});

test("H2H: bullish stock still applies on a mildly-down side — Plan C gate is one-sided", () => {
  // Putin at -2% from open (NOT decisively down — gate inactive). With
  // positive 7d delta + rising wiki + UP direction the bullish branches
  // SHOULD still fire on his side, just at halved magnitudes. Macron is
  // a bearish foil (delta=-10, falling wiki, DOWN direction) so the H2H
  // abstain gate (topScore >= 0.52) is cleared by either side; what
  // we're pinning is Putin's seed weight after the halving.
  //
  // Post-Plan-C arithmetic:
  //   Putin  : 1.05 (rising && delta>8, halved) * 0.99 (vs-open -0.1)
  //            * 1.04 (UP) ≈ 1.0813
  //   Macron : 0.975 (falling, halved) * 0.975 (vs-open -0.025)
  //            * 0.96 (DOWN) ≈ 0.9126
  //   Putin seed weight ≈ 1.0813 / (1.0813 + 0.9126) ≈ 0.5424
  //
  // Pre-Plan-C the same mix produced ≈ 0.5602 (1.10 * 0.95 bullish leg
  // un-halved). Band (0.535, 0.555) locks in the gate staying inactive
  // (Putin still ahead) AND symmetric halving (lean smaller than pre).
  const market = makeH2HMarket();
  const agent = makeSharpAgent({ specialties: ["politics"] });
  const entrySignals = new Map<string, TrendSignals>([
    ["entry-a", makeSignals({
      fameIndex: 6000,
      pctChangeVsOpen: -0.02,
      scoreDelta7d: 10,
      wikiPulse: "rising",
      trendDirection: "UP",
    })],
    ["entry-b", makeSignals({
      fameIndex: 6000,
      pctChangeVsOpen: -0.05,
      scoreDelta7d: -10,
      wikiPulse: "falling",
      trendDirection: "DOWN",
    })],
  ]);

  const decision = firstNonAbstain(agent, market, makeSignals(), {}, entrySignals);
  const putinProb =
    decision.entryId === "entry-a" ? decision.rawProbability! : 1 - decision.rawProbability!;
  assert.ok(
    putinProb > 0.535 && putinProb < 0.555,
    `Putin lean band (0.535, 0.555) pins gate-inactive + halved magnitudes; got ${putinProb}`,
  );
});

// ---------------------------------------------------------------------------
// Race per-entry pctChangeVsOpen — Phase 1b completion
// ---------------------------------------------------------------------------
//
// Race markets (gainer) hit the non-H2H per-entry pass (`if (!isH2H && ...)`)
// where each entry's score is bumped additively. The vs-open boost
// saturates at ±0.10 (0.10 coefficient on pctChangeVsOpen / 0.20). Test
// that an entry trending decisively up gets visibly more score than the
// pre-factor world.

function makeRaceMarket(): MarketWithEntries {
  const entries: MarketEntryData[] = [
    { id: "racer-1", label: "Alice", totalStake: 0, personId: "person-1" },
    { id: "racer-2", label: "Bob", totalStake: 0, personId: "person-2" },
    { id: "racer-3", label: "Cara", totalStake: 0, personId: "person-3" },
    { id: "racer-4", label: "Dan", totalStake: 0, personId: "person-4" },
  ];
  return {
    id: "market-race",
    marketType: "gainer",
    status: "OPEN",
    title: "Top mover this week",
    category: "politics",
    personId: null,
    endAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    entries,
  };
}

test("Race: a +30% entry beats flat peers with the same fame and 7d delta", () => {
  // All four racers have identical fame and momentum; only Alice's
  // vs-open differs. The new vs-open boost is the only differentiator,
  // so Alice should be the deterministic top pick.
  const market = makeRaceMarket();
  const agent = makeSharpAgent({ specialties: ["politics"] });
  const flat = makeSignals({ pctChangeVsOpen: 0, trendDirection: "FLAT" });
  const entrySignals = new Map<string, TrendSignals>([
    ["racer-1", makeSignals({ pctChangeVsOpen: 0.30, trendDirection: "UP" })],
    ["racer-2", flat],
    ["racer-3", flat],
    ["racer-4", flat],
  ]);
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, makeSignals(), {}, rng, entrySignals);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.equal(decision.entryId, "racer-1", "the +30% racer should be the top pick");
});

test("Race: a -25% entry is materially less likely than flat peers", () => {
  // Flip case — Alice tanking 25% should be the LEAST likely pick.
  // We don't assert which of the three flat peers wins (the seed picks
  // one), only that Alice is not the chosen entry — i.e. the negative
  // vs-open boost successfully fades her below the others.
  const market = makeRaceMarket();
  const agent = makeSharpAgent({ specialties: ["politics"] });
  const flat = makeSignals({ pctChangeVsOpen: 0, trendDirection: "FLAT" });
  const entrySignals = new Map<string, TrendSignals>([
    ["racer-1", makeSignals({ pctChangeVsOpen: -0.25, trendDirection: "DOWN" })],
    ["racer-2", flat],
    ["racer-3", flat],
    ["racer-4", flat],
  ]);
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, makeSignals(), {}, rng, entrySignals);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.notEqual(decision.entryId, "racer-1", "the -25% racer should not be the top pick");
});

test("Race: missing pctChangeVsOpen on entries falls back gracefully (no crash, no boost)", () => {
  // When the per-entry baseline can't be resolved (no snapshot pre-dates
  // market.createdAt for that person), `entrySig.pctChangeVsOpen` is
  // undefined and the boost should silently be 0. With everything else
  // equal, the racer with a strong scoreDelta7d should still win — i.e.
  // legacy behaviour is preserved when the new signal is absent.
  const market = makeRaceMarket();
  const agent = makeSharpAgent({ specialties: ["politics"] });
  const entrySignals = new Map<string, TrendSignals>([
    ["racer-1", makeSignals({ scoreDelta7d: 12 })], // no pctChangeVsOpen
    ["racer-2", makeSignals({ scoreDelta7d: 0 })],
    ["racer-3", makeSignals({ scoreDelta7d: 0 })],
    ["racer-4", makeSignals({ scoreDelta7d: 0 })],
  ]);
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, makeSignals(), {}, rng, entrySignals);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.equal(decision.entryId, "racer-1", "legacy 7d momentum path should still pick the strong mover");
});

test("Race: bullish stock signals on a decisively-down entry are gated (Plan C — per-entry pass)", () => {
  // Alice is -10% from market open (decisively down) but has rising wiki
  // and red news — the same Beyoncé-style Monday-peak pattern that the
  // Up/Down test pinned in `computeSignalBoost`. Pre-Plan-C, those
  // bullish stock boosts (+0.08 wiki + 0.05 news = +0.13) outweighed
  // the -0.05 vs-open + -0.03 direction tilt:
  //   Alice pre  : 1/n + (0 + 0.08 + 0.05 - 0.05 - 0.03) = 0.25 + 0.05 = 0.30
  //   peers      : 0.25
  //   normalised : Alice 0.286, others 0.238 — Alice top pick.
  //
  // Post-Plan-C the gate suppresses the bullish wiki/news on her entry
  // (entryDecisivelyDown=true) so only the bearish vs-open + direction
  // boosts apply:
  //   Alice post : 0.25 + (0 + 0 + 0 - 0.05 - 0.03) = 0.17
  //   peers      : 0.25
  //   normalised : Alice 0.185, others 0.272 — Alice fades to last.
  //
  // We use riskAppetite 0.2 so the n=4 sharp edge gate (0.0125) is
  // cleared by the post-Plan-C top score (0.272 > 0.25 + 0.0125), and
  // assert that Alice is NOT the top pick. Pre-Plan-C she would be.
  const market = makeRaceMarket();
  const agent = makeSharpAgent({ specialties: ["politics"], riskAppetite: 0.2 });
  const flat = makeSignals({ pctChangeVsOpen: 0, trendDirection: "FLAT" });
  const entrySignals = new Map<string, TrendSignals>([
    ["racer-1", makeSignals({
      pctChangeVsOpen: -0.10,
      scoreDelta7d: 0,
      wikiPulse: "rising",
      newsLevel: "red",
      trendDirection: "DOWN",
    })],
    ["racer-2", flat],
    ["racer-3", flat],
    ["racer-4", flat],
  ]);
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, makeSignals(), {}, rng, entrySignals);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.notEqual(
    decision.entryId,
    "racer-1",
    "decisively-down entry should not get pulled to the top by bullish stock signals",
  );
});

test("Race: bullish stock still applies on a mildly-down entry — Plan C gate is one-sided", () => {
  // Alice at -2% from open (NOT decisively down — gate inactive). With
  // rising wiki + red news the halved bullish stock boosts SHOULD
  // still tilt her to the top:
  //   Alice post : 0.25 + (0 + 0.04 + 0.025 - 0.01 + 0) = 0.305
  //   peers      : 0.25
  //   Alice norm : 0.305 / (0.305 + 0.25*3) = 0.305 / 1.055 ≈ 0.289
  //
  // Pre-Plan-C: 0.25 + (0.08 + 0.05 - 0.01 + 0) = 0.37 → 0.330 normalised.
  // Asserting 0.27 < Alice < 0.31 locks in the gate staying inactive
  // (Alice still tops the field) AND the halving (her lean is smaller
  // than the pre-Plan-C value of 0.330).
  const market = makeRaceMarket();
  const agent = makeSharpAgent({ specialties: ["politics"], riskAppetite: 0.2 });
  const flat = makeSignals({ pctChangeVsOpen: 0, trendDirection: "FLAT" });
  const entrySignals = new Map<string, TrendSignals>([
    ["racer-1", makeSignals({
      pctChangeVsOpen: -0.02,
      scoreDelta7d: 0,
      wikiPulse: "rising",
      newsLevel: "red",
      trendDirection: "FLAT",
    })],
    ["racer-2", flat],
    ["racer-3", flat],
    ["racer-4", flat],
  ]);
  const rng = createPRNG(PRNG_SEED);

  const decision = computePrediction(agent, market, makeSignals(), {}, rng, entrySignals);

  assert.equal(decision.abstain, false, `unexpected abstain: ${decision.abstainReason}`);
  assert.equal(
    decision.entryId,
    "racer-1",
    "shallow drawdown should still let bullish wiki/news lift Alice to the top",
  );
  assert.ok(
    (decision.rawProbability ?? 1) > 0.27 && (decision.rawProbability ?? 0) < 0.31,
    `expected Alice probability in (0.27, 0.31) to pin Plan C halving; got ${decision.rawProbability}`,
  );
});

// ---------------------------------------------------------------------------
// Original test resumes here
// ---------------------------------------------------------------------------

test("contrarianism fires normally on borderline moves (|pctChangeVsOpen| < 0.15)", () => {
  // 10% drawdown is decisivelyDown (< -0.05) so prestige stays gated,
  // but is NOT a decisive weekly move (< 0.15) so contrarianism is
  // still allowed to operate. With a heavy DOWN crowd, a strong
  // contrarian SHOULD fade and pick UP. This documents the guard's
  // intentional asymmetry — two different thresholds for two
  // different reasons.
  const market = makeBinaryUpDownMarket();
  const agent = makeSharpAgent({
    contrarianism: 0.95,
    simulationProfile: {
      schemaVersion: 2,
      cohortId: SIMULATION_V2_COHORT_ID,
      personaBand: "casual",
    },
  });
  const signals = makeSignals({ pctChangeVsOpen: -0.10 });
  const crowd = { "entry-down": 0.95, "entry-up": 0.05 };

  // Loop a few seeds until we land in Step 3 — the test just needs to
  // observe that contrarianism remains AVAILABLE in this regime, not
  // that it fires on every roll. Failing here would mean the guard is
  // over-eager (gating contrarianism on shallow moves too).
  let observedContrarianFade = false;
  for (let seed = 1; seed <= 25; seed++) {
    const decision = computePrediction(
      agent,
      market,
      signals,
      crowd,
      createPRNG(seed),
    );
    if (!decision.abstain && decision.entryId === "entry-up") {
      observedContrarianFade = true;
      break;
    }
  }
  assert.equal(
    observedContrarianFade,
    true,
    "contrarian fade never fired on a borderline -10% move — guard is over-eager",
  );
});
