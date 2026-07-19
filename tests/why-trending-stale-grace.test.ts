import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WHY_TRENDING_MAX_STALE_HOURS,
  WHY_TRENDING_SUMMARY_CACHE_PREFIX,
  isWithinWhyTrendingStaleGrace,
  isWhyTrendingSummaryCacheKey,
} from "../server/services/why-trending-stale";

describe("isWithinWhyTrendingStaleGrace", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");

  it("exports a 24h grace window", () => {
    assert.equal(WHY_TRENDING_MAX_STALE_HOURS, 24);
  });

  it("allows freshly fetched summaries", () => {
    assert.equal(isWithinWhyTrendingStaleGrace(now, now), true);
  });

  it("allows summaries fetched just under 24h ago", () => {
    const fetchedAt = new Date(now.getTime() - (24 * 60 * 60 * 1000 - 1));
    assert.equal(isWithinWhyTrendingStaleGrace(fetchedAt, now), true);
  });

  it("allows summaries fetched exactly 24h ago", () => {
    const fetchedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    assert.equal(isWithinWhyTrendingStaleGrace(fetchedAt, now), true);
  });

  it("rejects summaries older than 24h", () => {
    const fetchedAt = new Date(now.getTime() - (24 * 60 * 60 * 1000 + 1));
    assert.equal(isWithinWhyTrendingStaleGrace(fetchedAt, now), false);
  });

  it("accepts ISO string fetchedAt values", () => {
    const fetchedAt = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    assert.equal(isWithinWhyTrendingStaleGrace(fetchedAt, now), true);
  });
});

describe("isWhyTrendingSummaryCacheKey", () => {
  // Retention uses LIKE `${WHY_TRENDING_SUMMARY_CACHE_PREFIX}%` so summary rows
  // get the grace window while lock/ratelimit keys (underscore) stay on the
  // normal expired delete path.
  it("uses the shared summary prefix", () => {
    assert.equal(WHY_TRENDING_SUMMARY_CACHE_PREFIX, "why_trending:");
  });

  it("matches summary keys only", () => {
    assert.equal(isWhyTrendingSummaryCacheKey("why_trending:abc-123"), true);
    assert.equal(isWhyTrendingSummaryCacheKey("why_trending_lock:abc-123"), false);
    assert.equal(isWhyTrendingSummaryCacheKey("why_trending_ratelimit:abc-123"), false);
    assert.equal(isWhyTrendingSummaryCacheKey("serper:trending:elon_musk"), false);
    assert.equal(isWhyTrendingSummaryCacheKey("insights_story:deterministic"), false);
  });
});
