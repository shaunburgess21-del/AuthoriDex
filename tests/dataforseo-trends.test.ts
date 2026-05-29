import test from "node:test";
import assert from "node:assert/strict";

import {
  parseDataForSeoTrendsExploreTask,
  trendsBatchResultFromSeries,
} from "../server/providers/dataforseo-trends-parse";
import { computeTrendsCurrentInterest } from "../server/providers/trends-window";

const H = 60 * 60 * 1000;

function exploreTask(data: Array<{ timestamp: number; values: number[] }>) {
  return {
    status_code: 20000,
    result: [
      {
        items: [
          {
            type: "dataforseo_trends_graph",
            data,
          },
        ],
      },
    ],
  };
}

test("parseDataForSeoTrendsExploreTask: maps hourly points to timeseries", () => {
  const end = 1780081200; // seconds
  const data = Array.from({ length: 24 }, (_, i) => ({
    timestamp: end - (23 - i) * 3600,
    values: [40 + i],
  }));
  const series = parseDataForSeoTrendsExploreTask(exploreTask(data));
  assert.equal(series.length, 24);
  assert.equal(series[0].interest, 40);
  assert.equal(series[23].interest, 63);
  assert.ok(series[0].date.includes("T"));
});

test("parseDataForSeoTrendsExploreTask: failed task returns empty", () => {
  assert.deepEqual(parseDataForSeoTrendsExploreTask({ status_code: 40000 }), []);
  assert.deepEqual(parseDataForSeoTrendsExploreTask(null), []);
  assert.deepEqual(parseDataForSeoTrendsExploreTask({ status_code: 20000, result: [] }), []);
});

test("parseDataForSeoTrendsExploreTask: sparse / missing values default interest to 0", () => {
  const series = parseDataForSeoTrendsExploreTask(
    exploreTask([{ timestamp: 1780081200, values: [] }, { timestamp: 1780084800 } as any]),
  );
  assert.equal(series.length, 2);
  assert.equal(series[0].interest, 0);
  assert.equal(series[1].interest, 0);
});

test("trendsBatchResultFromSeries: wires computeTrendsCurrentInterest", () => {
  const end = Date.parse("2026-05-29T20:00:00.000Z");
  const series = Array.from({ length: 24 }, (_, i) => ({
    date: new Date(end - (23 - i) * H).toISOString(),
    interest: 50,
  }));
  series[22] = { date: new Date(end - 2 * H).toISOString(), interest: 80 };
  series[23] = { date: new Date(end - 1 * H).toISOString(), interest: 90 };
  series.push({ date: new Date(end).toISOString(), interest: 100 });

  const result = trendsBatchResultFromSeries("person-1", series);
  const expected = computeTrendsCurrentInterest(series);
  assert.equal(result.personId, "person-1");
  assert.equal(result.currentInterest, expected.currentInterest);
  assert.equal(result.avgWindowInterest, expected.avgWindowInterest);
  assert.equal(result.timeseries.length, series.length);
});

test("trendsBatchResultFromSeries: empty series returns zeros", () => {
  const result = trendsBatchResultFromSeries("p", []);
  assert.deepEqual(result, {
    personId: "p",
    timeseries: [],
    currentInterest: 0,
    avgWindowInterest: 0,
  });
});
