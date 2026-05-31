import test from "node:test";
import assert from "node:assert/strict";

import { parseDataForSeoNewsTaskResult } from "../server/providers/dataforseo-news-parse";

test("parseDataForSeoNewsTaskResult: counts news_search items with URLs", () => {
  const parsed = parseDataForSeoNewsTaskResult(
    {
      items: [
        { type: "news_search", url: "https://a.com/1", title: "A" },
        { type: "news_search", title: "No URL" },
        {
          type: "top_stories",
          items: [{ url: "https://b.com/2", title: "B" }],
        },
      ],
    },
    "Test Person",
  );
  assert.equal(parsed.articleCount24h, 2);
  assert.equal(parsed.articles.length, 2);
  assert.equal(parsed.topHeadlines[0], "A");
});

test("parseDataForSeoNewsTaskResult: empty body", () => {
  const parsed = parseDataForSeoNewsTaskResult(null, "X");
  assert.equal(parsed.articleCount24h, 0);
  assert.equal(parsed.articles.length, 0);
});
