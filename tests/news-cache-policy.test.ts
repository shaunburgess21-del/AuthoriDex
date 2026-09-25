import test from "node:test";
import assert from "node:assert/strict";

import {
  planNewsCacheAfterLiveFail,
  planNewsCacheRead,
} from "../server/providers/news-cache-policy";

test("cache-only prefers a still-valid row", () => {
  assert.equal(
    planNewsCacheRead({ cacheOnly: true, hasValidCache: true, hasExpiredCache: true }),
    "use_valid",
  );
});

test("cache-only fills from an expired row instead of dropping the person", () => {
  assert.equal(
    planNewsCacheRead({ cacheOnly: true, hasValidCache: false, hasExpiredCache: true }),
    "use_stale",
  );
});

test("cache-only reports empty when no row exists", () => {
  assert.equal(
    planNewsCacheRead({ cacheOnly: true, hasValidCache: false, hasExpiredCache: false }),
    "empty",
  );
});

test("refresh always live-fetches even when a valid row remains", () => {
  assert.equal(
    planNewsCacheRead({ cacheOnly: false, hasValidCache: true, hasExpiredCache: true }),
    "live_fetch",
  );
});

test("live-fetch failure falls back to expired cache rather than a union hole", () => {
  assert.equal(
    planNewsCacheAfterLiveFail({ hasValidCache: false, hasExpiredCache: true }),
    "use_stale",
  );
  assert.equal(
    planNewsCacheAfterLiveFail({ hasValidCache: true, hasExpiredCache: false }),
    "use_valid",
  );
  assert.equal(
    planNewsCacheAfterLiveFail({ hasValidCache: false, hasExpiredCache: false }),
    "empty",
  );
});
