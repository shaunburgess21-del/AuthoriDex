import test from "node:test";
import assert from "node:assert/strict";
import { loadOpeningScoreMap } from "../server/native-markets/openingScores";

test("loadOpeningScoreMap prefers 6h median when enough samples", async () => {
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
              sample_count: 6,
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
  assert.equal(map.get("p1")?.windowMethod, "6h_median");
  assert.equal(calls.length, 1, "should not fall through to 7d when 6h hits");
});

test("loadOpeningScoreMap falls back to 7d when 6h insufficient", async () => {
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
              sample_count: 48,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const map = await loadOpeningScoreMap(["p2"], executor);
  assert.equal(map.get("p2")?.windowMethod, "7d_median");
  assert.equal(map.get("p2")?.windowDays, 7);
});

test("loadOpeningScoreMap falls back to latest_tick when both 6h and 7d insufficient", async () => {
  let call = 0;
  const executor = {
    async execute() {
      call++;
      if (call === 1) return { rows: [] };
      if (call === 2) return { rows: [] };
      return {
        rows: [
          {
            person_id: "p3",
            fame_index: 420000,
            timestamp: "2026-05-24T22:00:00.000Z",
          },
        ],
      };
    },
  };

  const map = await loadOpeningScoreMap(["p3"], executor);
  assert.equal(map.get("p3")?.windowMethod, "latest_tick");
  assert.equal(map.get("p3")?.score, 420000);
  assert.equal(map.get("p3")?.sampleCount, 1);
});

function makeGuardCohortIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `guard-p${i}`);
}

test("loadOpeningScoreMap with cohortGuard pass keeps 6h primary", async () => {
  const ids = makeGuardCohortIds(25);
  let call = 0;
  const executor = {
    async execute() {
      call++;
      if (call === 1) {
        return {
          rows: ids.map((id) => ({
            person_id: id,
            opening_score: 500000,
            snapshot_at: "2026-07-06T00:00:00.000Z",
            sample_count: 6,
            max_news: 10,
            max_wiki: 100,
          })),
        };
      }
      if (call === 2) {
        return {
          rows: ids.map((id) => ({
            person_id: id,
            opening_score: 510000,
            snapshot_at: "2026-07-06T00:00:00.000Z",
            sample_count: 48,
          })),
        };
      }
      return { rows: [] };
    },
  };

  const map = await loadOpeningScoreMap(ids, executor, {
    asOf: new Date("2026-07-06T00:00:00.000Z"),
    cohortGuard: true,
  });

  assert.equal(map.get(ids[0]!)?.windowMethod, "6h_median");
  assert.equal(map.get(ids[0]!)?.guardTriggered, undefined);
  assert.equal(call, 2, "6h + 7d only when guard passes");
});

test("loadOpeningScoreMap with cohortGuard trip forces 7d for cohort", async () => {
  const ids = makeGuardCohortIds(25);
  let call = 0;
  const executor = {
    async execute() {
      call++;
      if (call === 1) {
        return {
          rows: ids.map((id) => ({
            person_id: id,
            opening_score: 370000,
            snapshot_at: "2026-07-06T00:00:00.000Z",
            sample_count: 6,
            max_news: 10,
            max_wiki: 100,
          })),
        };
      }
      if (call === 2) {
        return {
          rows: ids.map((id) => ({
            person_id: id,
            opening_score: 500000,
            snapshot_at: "2026-07-06T00:00:00.000Z",
            sample_count: 48,
          })),
        };
      }
      return { rows: [] };
    },
  };

  const map = await loadOpeningScoreMap(ids, executor, {
    asOf: new Date("2026-07-06T00:00:00.000Z"),
    cohortGuard: true,
  });

  assert.equal(map.get(ids[0]!)?.windowMethod, "7d_median");
  assert.equal(map.get(ids[0]!)?.score, 500000);
  assert.equal(map.get(ids[0]!)?.guardTriggered, true);
  assert.equal(call, 2, "6h + 7d only when guard trips (no latest_tick needed)");
});

test("loadOpeningScoreMap cohortGuard disabled preserves non-guard query path", async () => {
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
              sample_count: 6,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const map = await loadOpeningScoreMap(["p1"], executor, {
    asOf: new Date("2026-05-25T00:00:00.000Z"),
    cohortGuard: false,
  });

  assert.equal(map.get("p1")?.windowMethod, "6h_median");
  assert.equal(calls.length, 1);
});
