import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCategoryMix } from "../shared/insights/category-mix";

describe("buildCategoryMix", () => {
  it("counts categories among the top N by rank", () => {
    const people = [
      { rank: 1, category: "Sports" },
      { rank: 2, category: "sports" },
      { rank: 3, category: "Politics" },
      { rank: 4, category: "Tech" },
      { rank: 55, category: "Music" },
    ];

    const mix = buildCategoryMix(people, 3);

    assert.equal(mix.topN, 3);
    assert.equal(mix.segments.length, 2);
    assert.equal(mix.segments[0]?.category, "sports");
    assert.equal(mix.segments[0]?.count, 2);
    assert.equal(mix.segments[0]?.pct, 67);
    assert.equal(mix.segments[1]?.category, "politics");
    assert.equal(mix.segments[1]?.count, 1);
  });

  it("returns an empty mix when no people are provided", () => {
    const mix = buildCategoryMix([]);
    assert.equal(mix.topN, 0);
    assert.deepEqual(mix.segments, []);
  });

  it("merges media-and-podcast into the media bucket", () => {
    const mix = buildCategoryMix([
      { rank: 1, category: "Media & Podcast" },
      { rank: 2, category: "media" },
      { rank: 3, category: "Sports" },
    ]);

    assert.equal(mix.topN, 3);
    assert.equal(mix.segments.length, 2);
    assert.equal(mix.segments.find((s) => s.category === "media")?.count, 2);
    assert.equal(mix.segments.find((s) => s.category === "media")?.label, "Media & Podcast");
  });
});
