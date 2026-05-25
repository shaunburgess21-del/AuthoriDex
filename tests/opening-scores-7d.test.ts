import test from "node:test";
import assert from "node:assert/strict";
import { loadOpeningScoreMap } from "../server/native-markets/openingScores";

test("loadOpeningScoreMap prefers 7d median when enough samples", async () => {
  const calls: string[] = [];
  const executor = {
    async execute() {
      calls.push("query");
      if (calls.length === 1) {
        return {
          rows: [
            {
              person_id: "p1",
              opening_score: 300000,
              snapshot_at: "2026-05-20T00:00:00.000Z",
              sample_count: 48,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const map = await loadOpeningScoreMap(["p1"], executor, {
    asOf: new Date("2026-05-25T00:00:00.000Z"),
  });

  assert.equal(map.get("p1")?.score, 300000);
  assert.equal(map.get("p1")?.windowMethod, "7d_median");
  assert.equal(map.get("p1")?.windowDays, 7);
  assert.equal(calls.length, 1, "should not fall through to 6h when 7d hits");
});

test("loadOpeningScoreMap falls back to 6h when 7d insufficient", async () => {
  let call = 0;
  const executor = {
    async execute() {
      call++;
      if (call === 1) return { rows: [] };
      if (call === 2) {
        return {
          rows: [
            {
              person_id: "p2",
              opening_score: 250000,
              snapshot_at: "2026-05-25T05:00:00.000Z",
              sample_count: 4,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const map = await loadOpeningScoreMap(["p2"], executor);
  assert.equal(map.get("p2")?.windowMethod, "6h_median");
});
