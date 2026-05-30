import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCurrentsKeywords,
  normalizeCurrentsPublished,
  parseCurrentsSearchResponse,
} from "../server/providers/currents-parse";

test("normalizeCurrentsPublished: converts Currents format to ISO", () => {
  const iso = normalizeCurrentsPublished("2026-03-24 11:10:00 +0000");
  assert.ok(iso);
  assert.ok(iso!.includes("2026-03-24"));
  assert.ok(iso!.includes("T"));
});

test("normalizeCurrentsPublished: undefined/empty", () => {
  assert.equal(normalizeCurrentsPublished(undefined), undefined);
  assert.equal(normalizeCurrentsPublished(""), undefined);
});

test("parseCurrentsSearchResponse: maps articles and headlines", () => {
  const parsed = parseCurrentsSearchResponse(
    {
      status: "ok",
      news: [
        {
          url: "https://example.com/a",
          title: "Headline A",
          published: "2026-05-30 10:00:00 +0000",
        },
        {
          url: "https://example.com/b",
          title: "Headline B",
        },
        { url: "https://example.com/no-title" },
      ],
      page: 1,
    },
    "Donald Trump",
  );
  assert.equal(parsed.query, "Donald Trump");
  assert.equal(parsed.articleCount24h, 3);
  assert.deepEqual(parsed.topHeadlines, ["Headline A", "Headline B"]);
  assert.equal(parsed.articles.length, 3);
  assert.equal(parsed.articles[0].url, "https://example.com/a");
  assert.ok(parsed.articles[0].publishedAt?.includes("2026-05-30"));
});

test("parseCurrentsSearchResponse: non-ok or missing news", () => {
  assert.deepEqual(parseCurrentsSearchResponse(null, "X"), {
    query: "X",
    articleCount24h: 0,
    topHeadlines: [],
    articles: [],
  });
  assert.deepEqual(parseCurrentsSearchResponse({ status: "error" }, "X"), {
    query: "X",
    articleCount24h: 0,
    topHeadlines: [],
    articles: [],
  });
  assert.deepEqual(parseCurrentsSearchResponse({ status: "ok", news: [] }, "X"), {
    query: "X",
    articleCount24h: 0,
    topHeadlines: [],
    articles: [],
  });
});

test("buildCurrentsKeywords: uses name or searchQueryOverride OR-clauses", () => {
  assert.equal(buildCurrentsKeywords("Elon Musk"), "Elon Musk");
  assert.equal(buildCurrentsKeywords("Elon Musk", null), "Elon Musk");
  assert.equal(
    buildCurrentsKeywords("Tim Cook", "Apple OR Tim Cook"),
    "Apple OR Tim Cook",
  );
  assert.equal(buildCurrentsKeywords("X", "  "), "X");
});

test("parseCurrentsSearchResponse: skips entries without url", () => {
  const parsed = parseCurrentsSearchResponse(
    {
      status: "ok",
      news: [{ title: "No URL" }, { url: "https://ok.com", title: "OK" }],
    },
    "Test",
  );
  assert.equal(parsed.articleCount24h, 1);
  assert.deepEqual(parsed.topHeadlines, ["OK"]);
});
