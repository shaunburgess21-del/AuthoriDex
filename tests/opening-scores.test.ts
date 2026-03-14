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
