import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeHeadlineHash,
  emptyWhyTrendingPayload,
  parseWhyTrendingModelContent,
} from "../server/services/why-trending-payload";

describe("parseWhyTrendingModelContent", () => {
  const fallback = { summary: "Headline fallback", category: "General News" };

  it("uses the headline when the model returns nothing", () => {
    assert.deepEqual(parseWhyTrendingModelContent(null, fallback), fallback);
    assert.deepEqual(parseWhyTrendingModelContent("   ", fallback), fallback);
  });

  it("parses a fenced JSON object", () => {
    const parsed = parseWhyTrendingModelContent(
      '```json\n{"summary":"He opened a film.","category":"Film"}\n```',
      fallback,
    );
    assert.deepEqual(parsed, { summary: "He opened a film.", category: "Film" });
  });

  it("does not throw when the completion is truncated or null", () => {
    assert.deepEqual(parseWhyTrendingModelContent('{"summary": "Robert', fallback), fallback);
    assert.deepEqual(parseWhyTrendingModelContent("null", fallback), fallback);
    assert.deepEqual(parseWhyTrendingModelContent("[]", fallback), fallback);
  });
});

describe("computeHeadlineHash", () => {
  it("hashes a headline that is missing a title instead of throwing", () => {
    const hash = computeHeadlineHash([
      { title: undefined, link: "not a url" },
      { title: null, link: null },
    ]);
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 16);
  });
});

describe("emptyWhyTrendingPayload", () => {
  it("is the empty card shape, not an error", () => {
    const payload = emptyWhyTrendingPayload("person-1", "Robert Pattinson");
    assert.equal(payload.hasContext, false);
    assert.equal(payload.cacheStatus, "NO_NEWS");
    assert.equal(payload.personName, "Robert Pattinson");
  });
});
