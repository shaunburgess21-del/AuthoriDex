import test from "node:test";
import assert from "node:assert/strict";
import {
  ANCHORED_ANCHOR_COUNT,
  ANCHORED_FIELD_SIZE,
  ANCHORED_MOVER_COUNT,
  ANCHORED_MOVER_RANK_RANGE,
  ANCHORED_WILDCARD_COUNT,
  ANCHORED_WILDCARD_RANK_RANGE,
  GAINER_MOVEMENT_MIN_SAMPLES,
} from "../shared/constants";
import {
  selectAnchoredField,
  type AnchoredSelectionInput,
} from "../server/jobs/anchored-selection";
import type { GainerMovementStat } from "../server/jobs/gainer-movement-stats";

function buildPeople(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `person-${String(i + 1).padStart(3, "0")}`,
  }));
}

function buildFameById(people: { id: string }[]): Map<string, number> {
  return new Map(
    people.map((p, i) => [p.id, (people.length - i) * 1000]),
  );
}

function buildMomentumById(
  people: { id: string }[],
  opts: { excludeIds?: Set<string> } = {},
): Map<string, GainerMovementStat> {
  const map = new Map<string, GainerMovementStat>();
  for (const [i, p] of people.entries()) {
    if (opts.excludeIds?.has(p.id)) continue;
    map.set(p.id, {
      personId: p.id,
      stddev30d: 1000 + i * 10,
      momentum7d: 0.05 + i * 0.01,
      sampleCount: GAINER_MOVEMENT_MIN_SAMPLES,
    });
  }
  return map;
}

function runSelection(
  overrides: Partial<AnchoredSelectionInput> & Pick<AnchoredSelectionInput, "weekNumber" | "marketType">,
) {
  const people = overrides.people ?? buildPeople(100);
  return selectAnchoredField({
    people,
    fameById: overrides.fameById ?? buildFameById(people),
    momentumById: overrides.momentumById ?? buildMomentumById(people),
    weekNumber: overrides.weekNumber,
    marketType: overrides.marketType,
    anchorCount: overrides.anchorCount,
    moverCount: overrides.moverCount,
    wildcardCount: overrides.wildcardCount,
    moverRankRange: overrides.moverRankRange,
    wildcardRankRange: overrides.wildcardRankRange,
  });
}

test("selectAnchoredField returns full field size when pool is large enough", () => {
  const result = runSelection({ weekNumber: 24, marketType: "jackpot" });
  assert.equal(result.all.length, ANCHORED_FIELD_SIZE);
  assert.equal(result.anchors.length, ANCHORED_ANCHOR_COUNT);
  assert.equal(result.movers.length, ANCHORED_MOVER_COUNT);
  assert.equal(result.wildcards.length, ANCHORED_WILDCARD_COUNT);
  assert.equal(new Set(result.all).size, ANCHORED_FIELD_SIZE);
});

test("anchors are the top-N by fame in order", () => {
  const people = buildPeople(100);
  const fameById = buildFameById(people);
  const result = runSelection({
    weekNumber: 24,
    marketType: "jackpot",
    people,
    fameById,
  });

  const expectedAnchors = [...people]
    .sort((a, b) => {
      const fameA = fameById.get(a.id)!;
      const fameB = fameById.get(b.id)!;
      if (fameB !== fameA) return fameB - fameA;
      return a.id.localeCompare(b.id);
    })
    .slice(0, ANCHORED_ANCHOR_COUNT)
    .map((p) => p.id);

  assert.deepEqual(result.anchors, expectedAnchors);
});

test("movers come from mover rank range when pool is full", () => {
  const people = buildPeople(100);
  const fameById = buildFameById(people);
  const sorted = [...people].sort(
    (a, b) => fameById.get(b.id)! - fameById.get(a.id)! || a.id.localeCompare(b.id),
  );
  const moverIds = new Set(
    sorted.slice(ANCHORED_MOVER_RANK_RANGE[0] - 1, ANCHORED_MOVER_RANK_RANGE[1]).map((p) => p.id),
  );
  const wildcardIds = new Set(
    sorted.slice(ANCHORED_WILDCARD_RANK_RANGE[0] - 1, ANCHORED_WILDCARD_RANK_RANGE[1]).map((p) => p.id),
  );

  const result = runSelection({ weekNumber: 24, marketType: "jackpot", people, fameById });

  for (const id of result.movers) {
    assert.ok(
      moverIds.has(id) || wildcardIds.has(id),
      `mover ${id} should be from ranks ${ANCHORED_MOVER_RANK_RANGE} or padded from wildcards`,
    );
  }
});

test("wildcards come from wildcard rank range when pool is full", () => {
  const people = buildPeople(100);
  const fameById = buildFameById(people);
  const sorted = [...people].sort(
    (a, b) => fameById.get(b.id)! - fameById.get(a.id)! || a.id.localeCompare(b.id),
  );
  const anchorAndMoverIds = new Set([
    ...sorted.slice(0, ANCHORED_ANCHOR_COUNT).map((p) => p.id),
    ...sorted.slice(ANCHORED_MOVER_RANK_RANGE[0] - 1, ANCHORED_MOVER_RANK_RANGE[1]).map((p) => p.id),
  ]);

  const result = runSelection({ weekNumber: 24, marketType: "jackpot", people, fameById });

  for (const id of result.wildcards) {
    assert.ok(!anchorAndMoverIds.has(id) || sorted.findIndex((p) => p.id === id) >= ANCHORED_WILDCARD_RANK_RANGE[0] - 1);
  }
});

test("same week + marketType is deterministic", () => {
  const a = runSelection({ weekNumber: 24, marketType: "updown" });
  const b = runSelection({ weekNumber: 24, marketType: "updown" });
  assert.deepEqual(a, b);
});

test("jackpot and updown share anchors but differ in movers/wildcards", () => {
  const jackpot = runSelection({ weekNumber: 24, marketType: "jackpot" });
  const updown = runSelection({ weekNumber: 24, marketType: "updown" });

  assert.deepEqual(jackpot.anchors, updown.anchors);
  assert.notDeepEqual(jackpot.movers, updown.movers);
  assert.notDeepEqual(jackpot.wildcards, updown.wildcards);
});

test("small pool returns only available people without throwing", () => {
  const people = buildPeople(15);
  const result = runSelection({ weekNumber: 24, marketType: "jackpot", people });

  assert.equal(result.anchors.length, 10);
  assert.equal(result.movers.length, 5);
  assert.equal(result.wildcards.length, 0);
  assert.equal(result.all.length, 15);
});

test("people without momentum are excluded from movers when enough eligible exist", () => {
  const people = buildPeople(100);
  const fameById = buildFameById(people);
  const sorted = [...people].sort(
    (a, b) => fameById.get(b.id)! - fameById.get(a.id)! || a.id.localeCompare(b.id),
  );
  const moverBand = sorted.slice(
    ANCHORED_MOVER_RANK_RANGE[0] - 1,
    ANCHORED_MOVER_RANK_RANGE[1],
  );
  const excludeIds = new Set(moverBand.slice(0, 10).map((p) => p.id));

  const result = runSelection({
    weekNumber: 24,
    marketType: "jackpot",
    people,
    fameById,
    momentumById: buildMomentumById(people, { excludeIds }),
  });

  for (const id of result.movers) {
    assert.ok(!excludeIds.has(id), "movers without momentum history should not be picked from excluded band");
  }
});

test("empty pool returns empty field without throwing", () => {
  const result = runSelection({
    weekNumber: 24,
    marketType: "jackpot",
    people: [],
    fameById: new Map(),
    momentumById: new Map(),
  });
  assert.equal(result.all.length, 0);
  assert.deepEqual(result.anchors, []);
});

test("different week changes movers and wildcards", () => {
  const w24 = runSelection({ weekNumber: 24, marketType: "jackpot" });
  const w25 = runSelection({ weekNumber: 25, marketType: "jackpot" });
  assert.notDeepEqual(w24.movers, w25.movers);
});
