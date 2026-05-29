import test from "node:test";
import assert from "node:assert/strict";

import {
  computePositivePct,
  parseSentimentSummaryTask,
  webSentimentLevel,
  webSentimentReadingFromCounts,
  WEB_SENTIMENT_MIN_OPINIONATED,
} from "../server/providers/sentiment-window";

test("parseSentimentSummaryTask: maps connotation_types from summary task", () => {
  const task = {
    status_code: 20000,
    result: [
      {
        type: "content_analysis_summary",
        total_count: 1000,
        connotation_types: { positive: 300, negative: 200, neutral: 500 },
      },
    ],
  };
  const counts = parseSentimentSummaryTask(task);
  assert.deepEqual(counts, { positive: 300, negative: 200, neutral: 500, total: 1000 });
});

test("parseSentimentSummaryTask: failed task returns null", () => {
  assert.equal(parseSentimentSummaryTask({ status_code: 40000 }), null);
  assert.equal(parseSentimentSummaryTask(null), null);
});

test("computePositivePct: organic pos/(pos+neg), neutral excluded", () => {
  assert.equal(computePositivePct(60, 40), 60);
  assert.equal(computePositivePct(0, 0), null);
  assert.equal(computePositivePct(10, 10), null);
  assert.equal(
    computePositivePct(WEB_SENTIMENT_MIN_OPINIONATED, WEB_SENTIMENT_MIN_OPINIONATED),
    50,
  );
});

test("webSentimentLevel: tier thresholds", () => {
  assert.equal(webSentimentLevel(null), "none");
  assert.equal(webSentimentLevel(30), "low");
  assert.equal(webSentimentLevel(50), "medium");
  assert.equal(webSentimentLevel(70), "high");
});

test("webSentimentReadingFromCounts: attaches positivePct", () => {
  const reading = webSentimentReadingFromCounts({
    positive: 600,
    negative: 400,
    neutral: 1000,
    total: 2000,
  });
  assert.equal(reading.positivePct, 60);
  assert.equal(reading.total, 2000);
});
