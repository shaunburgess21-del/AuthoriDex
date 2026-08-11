/**
 * Unit tests for the Up/Down velocity-conditioned opening-price prior.
 *
 * Covers the threshold logic, the fail-safe paths (a missing velocity
 * reading must degrade to 50/50 rather than throw), the pricing design
 * invariants, and an end-to-end check that feeding the decision into
 * `pickSeedState` really opens the market at 0.40/0.60 with unchanged
 * liquidity depth.
 */
import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const {
  pickUpDownOpeningPrices,
  isUpDownOpeningPriorEnabled,
  isUpDownDepthPreservationEnabled,
  isValidUpLeanPrice,
  UPDOWN_HOT_VELOCITY_MIN,
  UPDOWN_HOT_UP_PRICE,
  UPDOWN_HOT_MEASURED_UP_RATE,
  UPDOWN_HOT_SAMPLE_SIZE,
} = await import("../server/native-markets/updown-opening-prices");

const { loadOpeningVelocityMap } = await import(
  "../server/native-markets/openingVelocity"
);

const { pickSeedState } = await import("../server/services/amm-house");
const { pricesAll, seedB } = await import("../shared/lib/amm/lmsr");
const { getTargetMaxLoss } = await import("../server/config/amm");

const UNIFORM_TML = getTargetMaxLoss("updown");

// ---------------------------------------------------------------------------
// Threshold
// ---------------------------------------------------------------------------

test("threshold is inclusive on the lower bound", () => {
  assert.ok(pickUpDownOpeningPrices({ openingVelocity: UPDOWN_HOT_VELOCITY_MIN }));
  assert.equal(pickUpDownOpeningPrices({ openingVelocity: UPDOWN_HOT_VELOCITY_MIN - 0.1 }), null);
});

test("cold cards get no prior — 50/50 is the honest price below the threshold", () => {
  // Below velocity 40 the sample was 19 markets over 7 weeks with a weekly
  // sd of 41.3 points. There is no level to price on, so we decline.
  for (const v of [0, 5, 14.3, 25, 39.99]) {
    assert.equal(pickUpDownOpeningPrices({ openingVelocity: v }), null, `velocity ${v}`);
  }
});

test("hot cards get the prior across the whole observed range", () => {
  for (const v of [40, 55, 70, 90.3, 100]) {
    const d = pickUpDownOpeningPrices({ openingVelocity: v, preserveDepth: false });
    assert.ok(d, `velocity ${v}`);
    assert.equal(d.upPrice, UPDOWN_HOT_UP_PRICE);
  }
});

test("the prior is flat above the threshold, not graduated", () => {
  // Deliberate: the three high bands measured 34.4 / 29.0 / 28.6% Up and are
  // statistically indistinguishable, so a ladder would be inventing signal.
  const a = pickUpDownOpeningPrices({ openingVelocity: 41, preserveDepth: false });
  const b = pickUpDownOpeningPrices({ openingVelocity: 89, preserveDepth: false });
  assert.ok(a && b);
  assert.equal(a.upPrice, b.upPrice);
  assert.equal(a.targetMaxLoss, b.targetMaxLoss);
});

// ---------------------------------------------------------------------------
// Fail-safe paths
// ---------------------------------------------------------------------------

test("a missing velocity reading degrades to 50/50 and never throws", () => {
  assert.equal(pickUpDownOpeningPrices({ openingVelocity: null }), null);
  assert.equal(pickUpDownOpeningPrices({ openingVelocity: undefined }), null);
});

test("non-finite velocity degrades to 50/50", () => {
  assert.equal(pickUpDownOpeningPrices({ openingVelocity: Number.NaN }), null);
  assert.equal(pickUpDownOpeningPrices({ openingVelocity: Number.POSITIVE_INFINITY }), null);
  assert.equal(pickUpDownOpeningPrices({ openingVelocity: Number.NEGATIVE_INFINITY }), null);
});

// ---------------------------------------------------------------------------
// Price shape and design invariants
// ---------------------------------------------------------------------------

test("prices are aligned [Up, Down] to match displayOrder 0 = Up", () => {
  const d = pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: false });
  assert.ok(d);
  assert.equal(d.prices[0], UPDOWN_HOT_UP_PRICE);
  assert.equal(d.prices[0], d.upPrice);
  assert.equal(d.prices[1], 0.6);
});

test("prices sum to exactly 1 (no float drift into normalizeSeedPrices)", () => {
  const d = pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: false });
  assert.ok(d);
  assert.equal(d.prices[0] + d.prices[1], 1);
});

test("Up is priced ABOVE its measured rate — the edge stays with the user", () => {
  // Mirror of the H2H invariant. There the favourite is priced below its
  // measured win rate; here Up is the underdog, so it must be priced above
  // the measured Up rate. Either way the house never prices past the evidence.
  assert.ok(
    UPDOWN_HOT_UP_PRICE > UPDOWN_HOT_MEASURED_UP_RATE,
    `Up price ${UPDOWN_HOT_UP_PRICE} must exceed measured ${UPDOWN_HOT_MEASURED_UP_RATE}`,
  );
  // And the same statement from the favoured side: Down opens below its
  // measured win rate.
  const downPrice = 1 - UPDOWN_HOT_UP_PRICE;
  const measuredDownRate = 1 - UPDOWN_HOT_MEASURED_UP_RATE;
  assert.ok(downPrice < measuredDownRate);
});

test("Up still leans Down overall, otherwise the prior does nothing", () => {
  assert.ok(UPDOWN_HOT_UP_PRICE < 0.5);
});

test("Up stays tradeable — never priced so thin nobody takes it", () => {
  assert.ok(
    UPDOWN_HOT_UP_PRICE >= 0.2,
    `Up at ${UPDOWN_HOT_UP_PRICE} would not attract volume`,
  );
});

test("loadOpeningVelocityMap: empty field short-circuits without querying", async () => {
  // The generator calls this with whatever field selection returned. An empty
  // field must not emit `person_id IN ()`, which is a syntax error.
  const executor = {
    execute: async () => {
      throw new Error("must not query the DB for an empty person list");
    },
  };
  const map = await loadOpeningVelocityMap([], executor);
  assert.equal(map.size, 0);
});

test("loadOpeningVelocityMap: skips rows with a non-finite median", async () => {
  // PERCENTILE_CONT over an all-NULL group yields NULL; a person with no
  // usable reading must be absent from the map so the caller opens 50/50
  // rather than pricing on NaN.
  const executor = {
    execute: async () => ({
      rows: [
        { person_id: "a", opening_velocity: null, snapshot_at: new Date().toISOString(), sample_count: 3 },
        { person_id: "b", opening_velocity: "not-a-number", snapshot_at: new Date().toISOString(), sample_count: 3 },
        { person_id: "c", opening_velocity: 62.5, snapshot_at: new Date().toISOString(), sample_count: 4 },
      ],
    }),
  };
  const map = await loadOpeningVelocityMap(["a", "b", "c"], executor);
  assert.deepEqual([...map.keys()], ["c"]);
  assert.equal(map.get("c")?.velocity, 62.5);
  assert.equal(map.get("c")?.sampleCount, 4);
});

test("isValidUpLeanPrice: rejects exactly 0.5, the value that would throw", () => {
  // The wired-in caller runs inside the generator's single transaction, where
  // one throw rolls back every Up/Down market for the week. 0.5 is the
  // dangerous value: it is what someone would try to "turn the lean off", and
  // computeDepthPreservingTargetMaxLoss rejects it outright.
  assert.equal(isValidUpLeanPrice(0.5), false);
  assert.equal(isValidUpLeanPrice(0.6), false);
  assert.equal(isValidUpLeanPrice(1), false);
  assert.equal(isValidUpLeanPrice(0), false);
  assert.equal(isValidUpLeanPrice(-0.1), false);
  assert.equal(isValidUpLeanPrice(Number.NaN), false);
  assert.equal(isValidUpLeanPrice(Number.POSITIVE_INFINITY), false);
});

test("isValidUpLeanPrice: accepts the configured price and the usable range", () => {
  assert.equal(isValidUpLeanPrice(UPDOWN_HOT_UP_PRICE), true);
  assert.equal(isValidUpLeanPrice(0.2), true);
  assert.equal(isValidUpLeanPrice(0.4999), true);
});

test("the configured Up price passes its own guard", () => {
  // If this fails, pickUpDownOpeningPrices silently returns null for every
  // card and the prior becomes a no-op rather than a crash — which is safe,
  // but you would want to know.
  assert.ok(isValidUpLeanPrice(UPDOWN_HOT_UP_PRICE));
  assert.doesNotThrow(() =>
    pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: true }),
  );
});

test("shading is more conservative than H2H, because the estimate is noisier", () => {
  // H2H strips ~83% of its mispricing (weekly sd 6.6). Up/Down's weekly sd is
  // 22.0, so it deliberately strips barely half. If someone tightens the price
  // toward the measured rate, this test should make them justify it.
  const stripped =
    (0.5 - UPDOWN_HOT_UP_PRICE) / (0.5 - UPDOWN_HOT_MEASURED_UP_RATE);
  assert.ok(stripped < 0.7, `stripping ${(stripped * 100).toFixed(0)}% is too aggressive here`);
  assert.ok(stripped > 0.3, `stripping ${(stripped * 100).toFixed(0)}% barely moves the price`);
});

test("audit fields carry the sample the price was fitted on", () => {
  const d = pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: false });
  assert.ok(d);
  assert.equal(d.measuredUpRate, UPDOWN_HOT_MEASURED_UP_RATE);
  assert.equal(d.sampleSize, UPDOWN_HOT_SAMPLE_SIZE);
  assert.equal(d.openingVelocity, 75);
});

// ---------------------------------------------------------------------------
// Depth preservation
// ---------------------------------------------------------------------------

test("preserveDepth=true holds b equal to the uniform 50/50 seed", () => {
  const uniformB = seedB(2, UNIFORM_TML);
  const d = pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: true });
  assert.ok(d);
  const pricedB = d.targetMaxLoss / Math.log(1 / UPDOWN_HOT_UP_PRICE);
  assert.ok(
    Math.abs(pricedB - uniformB) < 1,
    `b ${pricedB} should match uniform ${uniformB}`,
  );
});

test("preserveDepth=true scales targetMaxLoss up, never down", () => {
  const d = pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: true });
  assert.ok(d);
  assert.ok(d.targetMaxLoss > UNIFORM_TML);
  assert.equal(d.depthPreserved, true);
});

test("preserveDepth=false leaves targetMaxLoss untouched", () => {
  const d = pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: false });
  assert.ok(d);
  assert.equal(d.targetMaxLoss, UNIFORM_TML);
  assert.equal(d.depthPreserved, false);
});

test("an explicit uniformTargetMaxLoss is respected", () => {
  const d = pickUpDownOpeningPrices({
    openingVelocity: 75,
    uniformTargetMaxLoss: 1000,
    preserveDepth: false,
  });
  assert.ok(d);
  assert.equal(d.targetMaxLoss, 1000);
});

// ---------------------------------------------------------------------------
// End-to-end through the real seeding path
// ---------------------------------------------------------------------------

test("seeded market actually opens at 0.40 Up / 0.60 Down", () => {
  const d = pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: true });
  assert.ok(d);
  const seed = pickSeedState(["entry-up", "entry-down"], "updown", d.targetMaxLoss, d.prices);
  assert.equal(seed.priceMatched, true);

  const q = seed.outcomeOrder.map((id) => seed.shareQuantities[id]);
  const opened = pricesAll(q, seed.liquidityB);
  assert.ok(Math.abs(opened[0] - 0.4) < 0.001, `Up should open at 0.40, got ${opened[0]}`);
  assert.ok(Math.abs(opened[1] - 0.6) < 0.001, `Down should open at 0.60, got ${opened[1]}`);
});

test("depth-preserved seed keeps b equal to the uniform seed end-to-end", () => {
  const uniform = pickSeedState(["entry-up", "entry-down"], "updown");
  const d = pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: true });
  assert.ok(d);
  const priced = pickSeedState(["entry-up", "entry-down"], "updown", d.targetMaxLoss, d.prices);
  assert.ok(
    Math.abs(priced.liquidityB - uniform.liquidityB) < 1,
    `b should be preserved: ${priced.liquidityB} vs uniform ${uniform.liquidityB}`,
  );
});

test("without depth preservation b thins out — the trap the override guards", () => {
  const uniform = pickSeedState(["entry-up", "entry-down"], "updown");
  const d = pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: false });
  assert.ok(d);
  const thin = pickSeedState(["entry-up", "entry-down"], "updown", d.targetMaxLoss, d.prices);
  assert.ok(
    thin.liquidityB < uniform.liquidityB,
    `expected a thinner book, got ${thin.liquidityB} vs ${uniform.liquidityB}`,
  );
});

test("house seed equals targetMaxLoss on both the uniform and priced paths", () => {
  const uniform = pickSeedState(["entry-up", "entry-down"], "updown");
  assert.equal(uniform.houseSeedAmount, UNIFORM_TML);

  const d = pickUpDownOpeningPrices({ openingVelocity: 75, preserveDepth: true });
  assert.ok(d);
  const priced = pickSeedState(["entry-up", "entry-down"], "updown", d.targetMaxLoss, d.prices);
  assert.equal(priced.houseSeedAmount, d.targetMaxLoss);
});

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

test("the prior is off unless explicitly enabled", () => {
  const prev = process.env.UPDOWN_OPENING_PRIOR_ENABLED;
  try {
    delete process.env.UPDOWN_OPENING_PRIOR_ENABLED;
    assert.equal(isUpDownOpeningPriorEnabled(), false);
    process.env.UPDOWN_OPENING_PRIOR_ENABLED = "false";
    assert.equal(isUpDownOpeningPriorEnabled(), false);
    // Railway has shipped an uppercase TRUE before — it must be accepted.
    for (const v of ["true", "TRUE", "1", "yes", "on", " On "]) {
      process.env.UPDOWN_OPENING_PRIOR_ENABLED = v;
      assert.equal(isUpDownOpeningPriorEnabled(), true, `value ${JSON.stringify(v)}`);
    }
  } finally {
    if (prev === undefined) delete process.env.UPDOWN_OPENING_PRIOR_ENABLED;
    else process.env.UPDOWN_OPENING_PRIOR_ENABLED = prev;
  }
});

test("depth preservation defaults ON, including when the var is blank", () => {
  const prev = process.env.UPDOWN_PRESERVE_DEPTH_ENABLED;
  try {
    delete process.env.UPDOWN_PRESERVE_DEPTH_ENABLED;
    assert.equal(isUpDownDepthPreservationEnabled(), true);
    process.env.UPDOWN_PRESERVE_DEPTH_ENABLED = "   ";
    assert.equal(isUpDownDepthPreservationEnabled(), true);
    process.env.UPDOWN_PRESERVE_DEPTH_ENABLED = "false";
    assert.equal(isUpDownDepthPreservationEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.UPDOWN_PRESERVE_DEPTH_ENABLED;
    else process.env.UPDOWN_PRESERVE_DEPTH_ENABLED = prev;
  }
});
