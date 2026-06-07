import test from "node:test";
import assert from "node:assert/strict";

import { getSerperNewsCacheTtlHours } from "../server/providers/serper-news-cache-ttl";
import {
  resolveCurrentsRefreshIntervalMinutes,
  resolveMediastackRefreshIntervalMinutes,
} from "../server/providers/news-refresh-intervals";

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

test("getSerperNewsCacheTtlHours: defaults to max(Mediastack, Currents) refresh hours", () => {
  saveEnv([
    "SERPER_NEWS_CACHE_TTL_HOURS",
    "MEDIASTACK_REFRESH_INTERVAL_MINUTES",
    "CURRENTS_REFRESH_INTERVAL_MINUTES",
  ]);
  try {
    delete process.env.SERPER_NEWS_CACHE_TTL_HOURS;
    process.env.MEDIASTACK_REFRESH_INTERVAL_MINUTES = "180";
    process.env.CURRENTS_REFRESH_INTERVAL_MINUTES = "120";
    assert.equal(getSerperNewsCacheTtlHours(), 3);
  } finally {
    restoreEnv([
      "SERPER_NEWS_CACHE_TTL_HOURS",
      "MEDIASTACK_REFRESH_INTERVAL_MINUTES",
      "CURRENTS_REFRESH_INTERVAL_MINUTES",
    ]);
  }
});

test("getSerperNewsCacheTtlHours: matches shared refresh-interval helpers", () => {
  saveEnv(["SERPER_NEWS_CACHE_TTL_HOURS"]);
  try {
    delete process.env.SERPER_NEWS_CACHE_TTL_HOURS;
    const env = {
      MEDIASTACK_REFRESH_INTERVAL_MINUTES: "150",
      CURRENTS_REFRESH_INTERVAL_MINUTES: "90",
    };
    const expected =
      Math.max(
        resolveMediastackRefreshIntervalMinutes(env),
        resolveCurrentsRefreshIntervalMinutes(env),
      ) / 60;
    process.env.MEDIASTACK_REFRESH_INTERVAL_MINUTES = env.MEDIASTACK_REFRESH_INTERVAL_MINUTES;
    process.env.CURRENTS_REFRESH_INTERVAL_MINUTES = env.CURRENTS_REFRESH_INTERVAL_MINUTES;
    assert.equal(getSerperNewsCacheTtlHours(), expected);
    assert.equal(expected, 2.5);
  } finally {
    restoreEnv([
      "SERPER_NEWS_CACHE_TTL_HOURS",
      "MEDIASTACK_REFRESH_INTERVAL_MINUTES",
      "CURRENTS_REFRESH_INTERVAL_MINUTES",
    ]);
  }
});

test("getSerperNewsCacheTtlHours: SERPER_NEWS_CACHE_TTL_HOURS override wins", () => {
  saveEnv(["SERPER_NEWS_CACHE_TTL_HOURS"]);
  try {
    process.env.SERPER_NEWS_CACHE_TTL_HOURS = "2";
    assert.equal(getSerperNewsCacheTtlHours(), 2);
    process.env.SERPER_NEWS_CACHE_TTL_HOURS = "2.5";
    assert.equal(getSerperNewsCacheTtlHours(), 2.5);
  } finally {
    restoreEnv(["SERPER_NEWS_CACHE_TTL_HOURS"]);
  }
});
