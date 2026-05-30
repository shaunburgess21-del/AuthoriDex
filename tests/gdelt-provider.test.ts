import test from "node:test";
import assert from "node:assert/strict";

import {
  GDELT_24H_MAX_RECORDS,
  buildGdelt24hArtlistUrl,
  normalizeGdeltNewsData,
  parseGdelt24hArtlistResponse,
} from "../server/providers/gdelt-parse";

test("buildGdelt24hArtlistUrl: single 24h window, maxrecords=100", () => {
  const now = new Date("2026-05-30T19:00:00.000Z");
  const url = buildGdelt24hArtlistUrl("Test Person", now);
  assert.ok(url.includes(`maxrecords=${GDELT_24H_MAX_RECORDS}`));
  assert.equal(GDELT_24H_MAX_RECORDS, 100);
  assert.ok(url.includes("mode=artlist"));
  assert.ok(url.includes("startdatetime=20260529000000"));
  assert.ok(url.includes("enddatetime=20260530000000"));
  assert.ok(!url.includes("startdatetime=20260523000000"));
});

test("parseGdelt24hArtlistResponse: articleCount7d and averageDaily7d are zero", () => {
  const parsed = parseGdelt24hArtlistResponse(
    {
      articles: [
        { url: "https://example.com/a", title: "A" },
        { title: "No URL" },
      ],
    },
    "Test Person",
  );
  assert.equal(parsed.articleCount7d, 0);
  assert.equal(parsed.averageDaily7d, 0);
  assert.equal(parsed.articleCount24h, 1);
  assert.equal(parsed.articles.length, 1);
  assert.equal(parsed.delta, 1);
});

test("parseGdelt24hArtlistResponse: legacy empty body", () => {
  const parsed = parseGdelt24hArtlistResponse(null, "Bad Bunny");
  assert.equal(parsed.articleCount24h, 0);
  assert.equal(parsed.articleCount7d, 0);
  assert.equal(parsed.articles.length, 0);
});

test("normalizeGdeltNewsData: legacy cache without articles zeros phantom count", () => {
  const normalized = normalizeGdeltNewsData({
    query: "Bad Bunny",
    articleCount24h: 100,
    articleCount7d: 50,
    averageDaily7d: 7,
    delta: 1,
    topHeadlines: ["Old"],
  });
  assert.equal(normalized.articleCount24h, 0);
  assert.equal(normalized.articles?.length, 0);
});
