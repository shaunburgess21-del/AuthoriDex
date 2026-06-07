import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldApplyNews24hDecayFloor,
  shouldUseRawNewsCountForScoring,
  isUnionNewsSmoothingEnabled,
  getUnionNewsSmoothingMode,
  getUnionNewsSmoothingMediastackRatio,
  isSerperDominantUnionNews,
  shouldSmoothUnionNewsForScoring,
} from "../server/scoring/news-smoothing";

const envBackup: Record<string, string | undefined> = {};

function saveEnv(keys: string[]) {
  for (const key of keys) {
    envBackup[key] = process.env[key];
  }
}

function restoreEnv(keys: string[]) {
  for (const key of keys) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
}

test("shouldUseRawNewsCountForScoring: true when HEALTHY and no fallback", () => {
  assert.equal(
    shouldUseRawNewsCountForScoring({
      newsHealthState: "HEALTHY",
      newsUsedFallback: false,
      newsNeedsOutageFallback: false,
    }),
    true,
  );
});

test("shouldUseRawNewsCountForScoring: false when DEGRADED", () => {
  assert.equal(
    shouldUseRawNewsCountForScoring({
      newsHealthState: "DEGRADED",
      newsUsedFallback: false,
      newsNeedsOutageFallback: false,
    }),
    false,
  );
});

test("shouldApplyNews24hDecayFloor: false on healthy path", () => {
  assert.equal(
    shouldApplyNews24hDecayFloor({
      newsNeedsOutageFallback: false,
      newsUsedFallback: false,
      newsHealthState: "HEALTHY",
    }),
    false,
  );
});

test("shouldApplyNews24hDecayFloor: true when DEGRADED", () => {
  assert.equal(
    shouldApplyNews24hDecayFloor({
      newsNeedsOutageFallback: false,
      newsUsedFallback: false,
      newsHealthState: "DEGRADED",
    }),
    true,
  );
});

test("isUnionNewsSmoothingEnabled: false unless env is true", () => {
  saveEnv(["UNION_NEWS_SMOOTHING_ENABLED"]);
  try {
    delete process.env.UNION_NEWS_SMOOTHING_ENABLED;
    assert.equal(isUnionNewsSmoothingEnabled(), false);
    process.env.UNION_NEWS_SMOOTHING_ENABLED = "true";
    assert.equal(isUnionNewsSmoothingEnabled(), true);
    process.env.UNION_NEWS_SMOOTHING_ENABLED = "false";
    assert.equal(isUnionNewsSmoothingEnabled(), false);
  } finally {
    restoreEnv(["UNION_NEWS_SMOOTHING_ENABLED"]);
  }
});

test("getUnionNewsSmoothingMode: defaults to serper_dominant", () => {
  saveEnv(["UNION_NEWS_SMOOTHING_MODE"]);
  try {
    delete process.env.UNION_NEWS_SMOOTHING_MODE;
    assert.equal(getUnionNewsSmoothingMode(), "serper_dominant");
    process.env.UNION_NEWS_SMOOTHING_MODE = "all";
    assert.equal(getUnionNewsSmoothingMode(), "all");
    process.env.UNION_NEWS_SMOOTHING_MODE = "ALL";
    assert.equal(getUnionNewsSmoothingMode(), "all");
  } finally {
    restoreEnv(["UNION_NEWS_SMOOTHING_MODE"]);
  }
});

test("getUnionNewsSmoothingMediastackRatio: defaults to 0.2", () => {
  saveEnv(["UNION_NEWS_SMOOTHING_MEDIASTACK_RATIO"]);
  try {
    delete process.env.UNION_NEWS_SMOOTHING_MEDIASTACK_RATIO;
    assert.equal(getUnionNewsSmoothingMediastackRatio(), 0.2);
    process.env.UNION_NEWS_SMOOTHING_MEDIASTACK_RATIO = "0.15";
    assert.equal(getUnionNewsSmoothingMediastackRatio(), 0.15);
    process.env.UNION_NEWS_SMOOTHING_MEDIASTACK_RATIO = "invalid";
    assert.equal(getUnionNewsSmoothingMediastackRatio(), 0.2);
  } finally {
    restoreEnv(["UNION_NEWS_SMOOTHING_MEDIASTACK_RATIO"]);
  }
});

test("isSerperDominantUnionNews: mediastack below ratio of union", () => {
  assert.equal(
    isSerperDominantUnionNews({ mediastackTotal: 2, unionCount: 25, mediastackRatio: 0.2 }),
    true,
  );
  assert.equal(
    isSerperDominantUnionNews({ mediastackTotal: 6, unionCount: 25, mediastackRatio: 0.2 }),
    false,
  );
  assert.equal(
    isSerperDominantUnionNews({ mediastackTotal: 0, unionCount: 0 }),
    false,
  );
});

test("shouldSmoothUnionNewsForScoring: disabled by default", () => {
  saveEnv(["UNION_NEWS_SMOOTHING_ENABLED", "UNION_NEWS_SMOOTHING_MODE"]);
  try {
    delete process.env.UNION_NEWS_SMOOTHING_ENABLED;
    assert.equal(
      shouldSmoothUnionNewsForScoring({
        newsSource: "union",
        newsProviderHealthy: true,
        mediastackTotal: 2,
        unionCount: 25,
      }),
      false,
    );
  } finally {
    restoreEnv(["UNION_NEWS_SMOOTHING_ENABLED", "UNION_NEWS_SMOOTHING_MODE"]);
  }
});

test("shouldSmoothUnionNewsForScoring: serper_dominant mode only smooths dominant rows", () => {
  saveEnv(["UNION_NEWS_SMOOTHING_ENABLED", "UNION_NEWS_SMOOTHING_MODE"]);
  try {
    process.env.UNION_NEWS_SMOOTHING_ENABLED = "true";
    delete process.env.UNION_NEWS_SMOOTHING_MODE;

    assert.equal(
      shouldSmoothUnionNewsForScoring({
        newsSource: "union",
        newsProviderHealthy: true,
        mediastackTotal: 2,
        unionCount: 25,
      }),
      true,
    );
    assert.equal(
      shouldSmoothUnionNewsForScoring({
        newsSource: "union",
        newsProviderHealthy: true,
        mediastackTotal: 50,
        unionCount: 25,
      }),
      false,
    );
  } finally {
    restoreEnv(["UNION_NEWS_SMOOTHING_ENABLED", "UNION_NEWS_SMOOTHING_MODE"]);
  }
});

test("shouldSmoothUnionNewsForScoring: all mode smooths every healthy union row", () => {
  saveEnv(["UNION_NEWS_SMOOTHING_ENABLED", "UNION_NEWS_SMOOTHING_MODE"]);
  try {
    process.env.UNION_NEWS_SMOOTHING_ENABLED = "true";
    process.env.UNION_NEWS_SMOOTHING_MODE = "all";

    assert.equal(
      shouldSmoothUnionNewsForScoring({
        newsSource: "union",
        newsProviderHealthy: true,
        mediastackTotal: 50,
        unionCount: 25,
      }),
      true,
    );
  } finally {
    restoreEnv(["UNION_NEWS_SMOOTHING_ENABLED", "UNION_NEWS_SMOOTHING_MODE"]);
  }
});

test("shouldSmoothUnionNewsForScoring: healthy non-union stays raw", () => {
  saveEnv(["UNION_NEWS_SMOOTHING_ENABLED", "UNION_NEWS_SMOOTHING_MODE"]);
  try {
    process.env.UNION_NEWS_SMOOTHING_ENABLED = "true";
    process.env.UNION_NEWS_SMOOTHING_MODE = "all";

    assert.equal(
      shouldSmoothUnionNewsForScoring({
        newsSource: "mediastack",
        newsProviderHealthy: true,
        mediastackTotal: 2,
        unionCount: 25,
      }),
      false,
    );
  } finally {
    restoreEnv(["UNION_NEWS_SMOOTHING_ENABLED", "UNION_NEWS_SMOOTHING_MODE"]);
  }
});
