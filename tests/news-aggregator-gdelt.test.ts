import test from "node:test";
import assert from "node:assert/strict";

import {
  gdeltUnionAttributionCount,
  normalizeGdeltNewsData,
} from "../server/providers/gdelt-parse";
import type { GdeltNewsData } from "../server/providers/gdelt";

test("gdeltUnionAttributionCount: legacy cache without articles reports 0", () => {
  const legacy = normalizeGdeltNewsData({
    query: "Bad Bunny",
    articleCount24h: 100,
    articleCount7d: 0,
    averageDaily7d: 0,
    delta: 1,
    topHeadlines: ["Legacy"],
  }) as GdeltNewsData;
  assert.equal(gdeltUnionAttributionCount(legacy), 0);
  assert.equal(legacy.articleCount24h, 0);
});

test("gdeltUnionAttributionCount: URL-bearing articles count toward union", () => {
  const withUrls: GdeltNewsData = {
    query: "Someone",
    articleCount24h: 100,
    articleCount7d: 0,
    averageDaily7d: 0,
    delta: 1,
    topHeadlines: [],
    articles: [
      { url: "https://example.com/a" },
      { url: "https://example.com/b" },
    ],
  };
  assert.equal(gdeltUnionAttributionCount(withUrls), 2);
});

test("gdeltUnionAttributionCount: undefined GDELT is 0", () => {
  assert.equal(gdeltUnionAttributionCount(undefined), 0);
});
