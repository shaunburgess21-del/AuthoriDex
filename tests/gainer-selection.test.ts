import test from "node:test";
import assert from "node:assert/strict";
import {
  GAINER_FIELD_SIZE,
  GAINER_MIN_ELIGIBLE,
  GAINER_MOVEMENT_MIN_SAMPLES,
} from "../shared/constants";
import type { SnapshotScore } from "../server/native-markets/openingScores";
import type { GainerMovementStat } from "../server/jobs/gainer-movement-stats";
import {
  computeMovementScores,
  filterGainerEligible,
  hashGainerSelectionSeed,
  selectGainerField,
  type GainerSelectionInput,
} from "../server/jobs/gainer-selection";

function opening(
  method: SnapshotScore["windowMethod"] = "7d_median",
  sampleCount = GAINER_MOVEMENT_MIN_SAMPLES,
): SnapshotScore {
  return {
    score: 100,
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
      good: opening("7d_median", GAINER_MOVEMENT_MIN_SAMPLES),
      tick: opening("latest_tick", 1),
      thin: opening("7d_median", GAINER_MOVEMENT_MIN_SAMPLES),
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
