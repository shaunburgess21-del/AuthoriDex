import test from "node:test";
import assert from "node:assert/strict";
import { buildOpeningScores } from "../server/native-markets/openingScores";

test("buildOpeningScores preserves person mapping when one snapshot is missing", () => {
  const snapMap = new Map([
    ["person-a", { score: 10, snapshotAt: "2026-03-10T00:00:00.000Z" }],
    ["person-c", { score: 99, snapshotAt: "2026-03-10T00:00:00.000Z" }],
  ]);

  const result = buildOpeningScores(["person-a", "person-b", "person-c"], snapMap);

  assert.deepEqual(result, [
    { personId: "person-a", score: 10, snapshotAt: "2026-03-10T00:00:00.000Z" },
    { personId: "person-c", score: 99, snapshotAt: "2026-03-10T00:00:00.000Z" },
  ]);
});

test("buildOpeningScores returns empty array for empty personIds", () => {
  const snapMap = new Map([
    ["person-a", { score: 10, snapshotAt: "2026-03-10T00:00:00.000Z" }],
  ]);
  assert.deepEqual(buildOpeningScores([], snapMap), []);
});

test("buildOpeningScores returns empty array when no snapshots exist", () => {
  const snapMap = new Map<string, { score: number; snapshotAt: string }>();
  assert.deepEqual(buildOpeningScores(["person-a", "person-b"], snapMap), []);
});

test("buildOpeningScores returns all entries when all snapshots present", () => {
  const snapMap = new Map([
    ["person-a", { score: 10, snapshotAt: "2026-03-10T00:00:00.000Z" }],
    ["person-b", { score: 20, snapshotAt: "2026-03-10T01:00:00.000Z" }],
  ]);
  const result = buildOpeningScores(["person-a", "person-b"], snapMap);
  assert.equal(result.length, 2);
  assert.equal(result[0].personId, "person-a");
  assert.equal(result[1].personId, "person-b");
});
