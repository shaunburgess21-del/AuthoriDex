import test from "node:test";
import assert from "node:assert/strict";
import {
  GAINER_BAND_TIERS,
  GAINER_FIELD_SIZE,
  GAINER_MIN_ELIGIBLE,
  GAINER_MOVEMENT_MIN_SAMPLES,
} from "../shared/constants";
import type { SnapshotScore } from "../server/native-markets/openingScores";
import type { GainerMovementStat } from "../server/jobs/gainer-movement-stats";
import {
  computeMovementScores,
  filterGainerEligible,
  findGainerBandPoolsForTier,
  findQualifyingGainerBandPools,
  hashGainerSelectionSeed,
  preferTightestBandPools,
  selectGainerField,
  type GainerSelectionInput,
} from "../server/jobs/gainer-selection";

function opening(
  score = 100,
  method: SnapshotScore["windowMethod"] = "7d_median",
  sampleCount = GAINER_MOVEMENT_MIN_SAMPLES,
): SnapshotScore {
  return {
    score,
    snapshotAt: new Date().toISOString(),
    sampleCount,
    windowMethod: method,
    windowDays: 7,
  };
}

function movement(
  personId: string,
  overrides: Partial<GainerMovementStat> = {},
): GainerMovementStat {
  return {
    personId,
    stddev30d: 5,
    momentum7d: 0.1,
    sampleCount: GAINER_MOVEMENT_MIN_SAMPLES,
    ...overrides,
  };
}

function buildInput(
  ids: string[],
  opts: {
    weekNumber?: number;
    category?: string;
    fame?: Record<string, number>;
    opening?: Record<string, SnapshotScore | undefined>;
    movement?: Record<string, GainerMovementStat | undefined>;
  } = {},
): GainerSelectionInput {
  const fameById = new Map<string, number>();
  const openingById = new Map<string, SnapshotScore>();
  const movementById = new Map<string, GainerMovementStat>();

  ids.forEach((id, i) => {
    fameById.set(id, opts.fame?.[id] ?? 1000 - i * 10);
    const snap = opts.opening?.[id] ?? opening();
    if (snap) openingById.set(id, snap);
    const mov = opts.movement?.[id] ?? movement(id);
    if (mov) movementById.set(id, mov);
  });

  return {
    people: ids.map((id) => ({ id })),
    fameById,
    openingById,
    movementById,
    weekNumber: opts.weekNumber ?? 23,
    category: opts.category ?? "politics",
  };
}

test("selectGainerField returns exactly 5 when pool has enough eligible", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const result = selectGainerField(buildInput(ids));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.personIds.length, GAINER_FIELD_SIZE);
  assert.equal(new Set(result.personIds).size, GAINER_FIELD_SIZE);
  assert.equal(result.bandApplied, false);
});

test("selectGainerField skips when eligible < GAINER_MIN_ELIGIBLE", () => {
  const ids = ["a", "b", "c", "d"];
  const result = selectGainerField(buildInput(ids));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "too_few_eligible");
  assert.equal(result.eligibleCount, 4);
});

test("same week+category seed yields identical field", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
  const a = selectGainerField(buildInput(ids, { weekNumber: 10, category: "comedy" }));
  const b = selectGainerField(buildInput(ids, { weekNumber: 10, category: "comedy" }));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.deepEqual(a.personIds, b.personIds);
});

test("different week changes field (rotation)", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const w1 = selectGainerField(buildInput(ids, { weekNumber: 10, category: "sports" }));
  const w2 = selectGainerField(buildInput(ids, { weekNumber: 11, category: "sports" }));
  assert.equal(w1.ok, true);
  assert.equal(w2.ok, true);
  if (!w1.ok || !w2.ok) return;
  const sameMovers =
    w1.moverIds.join() === w2.moverIds.join() && w1.anchorId === w2.anchorId;
  assert.equal(sameMovers, false, "expected different seed to change movers or anchor tie-break only");
});

test("anchor is highest fame among eligible", () => {
  const ids = ["low", "mid", "a", "b", "c", "d"];
  const fame = { low: 10, mid: 50, a: 100, b: 200, c: 300, d: 400 };
  const result = selectGainerField(buildInput(ids, { fame }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.anchorId, "d");
  assert.equal(result.personIds[0], "d");
});

test("eligibility gate excludes low-history and latest_tick opening", () => {
  const ids = ["good", "tick", "thin"];
  const input = buildInput(ids, {
    opening: {
      good: opening(100, "7d_median", GAINER_MOVEMENT_MIN_SAMPLES),
      tick: opening(100, "latest_tick", 1),
      thin: opening(100, "7d_median", GAINER_MOVEMENT_MIN_SAMPLES),
    },
    movement: {
      good: movement("good"),
      tick: movement("tick"),
      thin: movement("thin", { sampleCount: GAINER_MOVEMENT_MIN_SAMPLES - 1 }),
    },
  });
  const eligible = filterGainerEligible(input);
  assert.deepEqual(eligible, ["good"]);
});

test("hashGainerSelectionSeed is stable", () => {
  assert.equal(hashGainerSelectionSeed(23, "politics"), hashGainerSelectionSeed(23, "politics"));
  assert.notEqual(hashGainerSelectionSeed(23, "politics"), hashGainerSelectionSeed(24, "politics"));
});

test("computeMovementScores favors higher volatility within pool", () => {
  const ids = ["quiet", "wild"];
  const movementById = new Map<string, GainerMovementStat>([
    ["quiet", movement("quiet", { stddev30d: 1, momentum7d: 0 })],
    ["wild", movement("wild", { stddev30d: 50, momentum7d: 0.5 })],
  ]);
  const fameById = new Map([
    ["quiet", 500],
    ["wild", 500],
  ]);
  const scores = computeMovementScores(ids, fameById, movementById);
  assert.ok((scores.get("wild") ?? 0) > (scores.get("quiet") ?? 0));
});

// ---------------------------------------------------------------------------
// Opening-score band selection
// ---------------------------------------------------------------------------

test("GAINER_BAND_TIERS ladder is ordered tight-to-loose", () => {
  for (let i = 1; i < GAINER_BAND_TIERS.length; i++) {
    assert.ok(
      GAINER_BAND_TIERS[i]!.maxRatio >= GAINER_BAND_TIERS[i - 1]!.maxRatio,
      "maxRatio must be non-decreasing",
    );
  }
});

test("findGainerBandPoolsForTier: rejects pools that exceed the ratio", () => {
  const openingById = new Map<string, SnapshotScore>([
    ["a", opening(300)],
    ["b", opening(280)],
    ["c", opening(270)],
    ["d", opening(260)],
    ["e", opening(250)],
    ["f", opening(100)], // 300/100 = 3x — outside any tier
    ["g", opening(90)],
  ]);
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  const pools = findGainerBandPoolsForTier(ids, openingById, 0, 1.5, 5);
  assert.ok(pools.length >= 1);
  for (const pool of pools) {
    assert.ok(pool.ratio <= 1.5 + 1e-9);
    assert.ok(pool.personIds.length >= 5);
    assert.ok(!pool.personIds.includes("f"));
    assert.ok(!pool.personIds.includes("g"));
  }
});

test("findQualifyingGainerBandPools: falls through to a looser tier", () => {
  // Exactly 6 people spanning ~1.9x — fails tier 0/1 (minPool 7), hits tier 2.
  const openingById = new Map<string, SnapshotScore>([
    ["a", opening(190)],
    ["b", opening(170)],
    ["c", opening(150)],
    ["d", opening(130)],
    ["e", opening(110)],
    ["f", opening(100)],
  ]);
  const ids = ["a", "b", "c", "d", "e", "f"];
  const q = findQualifyingGainerBandPools(ids, openingById);
  assert.ok(q);
  assert.equal(q!.tierIndex, 2);
  assert.ok(q!.pools.some((p) => p.personIds.length === 6));
});

test("findQualifyingGainerBandPools: returns null when no tier qualifies", () => {
  // 5 people spanning 5x — no tier has minPool ≤ 5 with room, and ratio > 2.
  const openingById = new Map<string, SnapshotScore>([
    ["a", opening(500)],
    ["b", opening(400)],
    ["c", opening(200)],
    ["d", opening(150)],
    ["e", opening(100)],
  ]);
  assert.equal(findQualifyingGainerBandPools(["a", "b", "c", "d", "e"], openingById), null);
});

test("preferTightestBandPools: drops looser pools so compression is not undone", () => {
  const pools = [
    { personIds: ["a", "b", "c", "d", "e", "f", "g"], ratio: 1.48, tierIndex: 0, maxOpen: 148, minOpen: 100 },
    { personIds: ["b", "c", "d", "e", "f", "g", "h"], ratio: 1.05, tierIndex: 0, maxOpen: 105, minOpen: 100 },
    { personIds: ["c", "d", "e", "f", "g", "h", "i"], ratio: 1.05, tierIndex: 0, maxOpen: 105, minOpen: 100 },
    { personIds: ["a", "b", "c", "d", "e", "f", "g", "h"], ratio: 1.49, tierIndex: 0, maxOpen: 149, minOpen: 100 },
  ];
  const tight = preferTightestBandPools(pools);
  assert.equal(tight.length, 2);
  assert.ok(tight.every((p) => Math.abs(p.ratio - 1.05) < 1e-9));
});

test("forceBand: picks a tight pool, not a maximal near-cap one", () => {
  // Ten people: a cluster of 7 at ~100 and three much higher that can only
  // join via a loose 1.5x window. Tightest preference must stay in the cluster.
  const ids = ["hi1", "hi2", "hi3", "c1", "c2", "c3", "c4", "c5", "c6", "c7"];
  const openingScores: Record<string, SnapshotScore> = {
    hi1: opening(149),
    hi2: opening(145),
    hi3: opening(140),
    c1: opening(105),
    c2: opening(104),
    c3: opening(103),
    c4: opening(102),
    c5: opening(101),
    c6: opening(100),
    c7: opening(100),
  };
  const fame = Object.fromEntries(ids.map((id, i) => [id, 1000 - i]));
  const result = selectGainerField(
    buildInput(ids, { fame, opening: openingScores, weekNumber: 50, category: "politics" }),
    { forceBand: true },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.bandApplied, true);
  assert.ok(result.bandRatio != null && result.bandRatio < 1.1, `expected tight pool, got ${result.bandRatio}`);
  assert.ok(result.fieldRatio != null && result.fieldRatio <= (result.bandRatio ?? 99));
  for (const hi of ["hi1", "hi2", "hi3"]) {
    assert.ok(!result.personIds.includes(hi), `${hi} should not enter a tight mid-band field`);
  }
});

test("forceBand: falls back to whole-category when no band qualifies", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const result = selectGainerField(
    buildInput(ids, {
      opening: {
        a: opening(500),
        b: opening(400),
        c: opening(200),
        d: opening(150),
        e: opening(100),
      },
    }),
    { forceBand: true },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.bandApplied, false);
  assert.equal(result.poolSize, 5);
  assert.equal(result.personIds.length, GAINER_FIELD_SIZE);
});

test("forceBand: applies a band and anchors highest fame WITHIN the band", () => {
  // Global fame leader "star" sits alone at 1000; a tight mid-band of 7
  // people lives around 200. Banding must pick from the mid-band and
  // NOT use star as the anchor.
  const ids = ["star", "m1", "m2", "m3", "m4", "m5", "m6", "m7"];
  const fame = {
    star: 9999,
    m1: 220,
    m2: 215,
    m3: 210,
    m4: 205,
    m5: 200,
    m6: 195,
    m7: 190,
  };
  const openingScores = {
    star: opening(1000),
    m1: opening(220),
    m2: opening(215),
    m3: opening(210),
    m4: opening(205),
    m5: opening(200),
    m6: opening(195),
    m7: opening(190),
  };
  const result = selectGainerField(
    buildInput(ids, { fame, opening: openingScores }),
    { forceBand: true },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.bandApplied, true);
  assert.equal(result.bandTier, 0);
  assert.ok(!result.personIds.includes("star"), "global star must be outside the band");
  assert.equal(result.anchorId, "m1", "anchor is highest fame inside the band");
  assert.ok(result.bandRatio != null && result.bandRatio <= 1.5);
});

test("forceBand: same week+category yields identical banded field", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const openingScores: Record<string, SnapshotScore> = {};
  ids.forEach((id, i) => {
    openingScores[id] = opening(200 - i * 5);
  });
  const a = selectGainerField(
    buildInput(ids, { weekNumber: 30, category: "tech", opening: openingScores }),
    { forceBand: true },
  );
  const b = selectGainerField(
    buildInput(ids, { weekNumber: 30, category: "tech", opening: openingScores }),
    { forceBand: true },
  );
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(a.bandApplied, true);
  assert.deepEqual(a.personIds, b.personIds);
  assert.equal(a.bandTier, b.bandTier);
});

test("forceBand: different week can rotate the chosen band or movers", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const openingScores: Record<string, SnapshotScore> = {};
  // Ten people within 1.4x → many overlapping tier-0 windows of size ≥7.
  ids.forEach((id, i) => {
    openingScores[id] = opening(200 - i * 5); // 200 … 155 → ratio 1.29
  });
  const w1 = selectGainerField(
    buildInput(ids, { weekNumber: 40, category: "music", opening: openingScores }),
    { forceBand: true },
  );
  const w2 = selectGainerField(
    buildInput(ids, { weekNumber: 41, category: "music", opening: openingScores }),
    { forceBand: true },
  );
  assert.equal(w1.ok, true);
  assert.equal(w2.ok, true);
  if (!w1.ok || !w2.ok) return;
  assert.equal(w1.bandApplied, true);
  assert.equal(w2.bandApplied, true);
  assert.ok(w1.poolSize >= 7);
  assert.ok(w2.poolSize >= 7);
  // Different seeds should change which overlapping window or movers land.
  const identical =
    w1.personIds.join() === w2.personIds.join() && w1.poolSize === w2.poolSize;
  assert.equal(identical, false, "expected week rotation to change field or pool");
});

test("band off by default: equal-score pool does not set bandApplied", () => {
  // Without the flag / forceBand, even a trivially bandable pool stays
  // on the legacy whole-category path.
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  const result = selectGainerField(buildInput(ids));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.bandApplied, false);
  assert.equal(result.bandTier, null);
});
