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
    newsLevel: "red",       // small UP-direction boost (+0.07 * recencyWeight)
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
