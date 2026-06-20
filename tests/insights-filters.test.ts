import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalCacheKey,
  DEFAULT_INSIGHTS_FILTERS,
  parseFilters,
  parseTab,
  serializeFilters,
} from "../shared/insights/filters";

describe("parseTab", () => {
  it("defaults to today with no params", () => {
    assert.equal(parseTab(""), "today");
    assert.equal(parseTab("?"), "today");
  });

  it("resolves canonical tab ids", () => {
    assert.equal(parseTab("?tab=today"), "today");
    assert.equal(parseTab("?tab=rankings"), "rankings");
    assert.equal(parseTab("?tab=vote"), "vote");
    assert.equal(parseTab("?tab=predict"), "predict");
    assert.equal(parseTab("?tab=crowd"), "crowd");
  });

  it("maps legacy tab ids", () => {
    assert.equal(parseTab("?tab=overview"), "today");
    assert.equal(parseTab("?tab=you"), "today");
    assert.equal(parseTab("?tab=approval"), "crowd");
    assert.equal(parseTab("?tab=compare"), "rankings");
    // Phase 4: `markets` used to redirect out to /predict; now it stays
    // inside Insights on the Predict tab.
    assert.equal(parseTab("?tab=markets"), "predict");
    assert.equal(parseTab("?tab=discover"), "today");
  });

  it("lands on rankings when filter params are present", () => {
    assert.equal(parseTab("?source=news_momentum"), "rankings");
    assert.equal(parseTab("?category=politics"), "rankings");
    assert.equal(parseTab("?fav=1"), "rankings");
  });

  it("prefers explicit tab over filter-only routing", () => {
    assert.equal(parseTab("?tab=rankings&source=news_momentum"), "rankings");
  });

  it("explicit today tab wins even with stale rankings filters present", () => {
    // Regression: the header now clears filters on tab switch, but if any
    // leak through, an explicit ?tab=today must still resolve to today
    // (not fall back to rankings via the filter-param heuristic).
    assert.equal(parseTab("?tab=today&source=news_momentum&window=7d"), "today");
  });

  it("lands on rankings when sortDir=asc is present", () => {
    assert.equal(parseTab("?sortDir=asc"), "rankings");
  });
});

describe("parseFilters sortDir", () => {
  it("defaults to desc", () => {
    assert.equal(parseFilters("").sortDir, "desc");
    assert.equal(parseFilters("?sortDir=desc").sortDir, "desc");
  });

  it("parses asc", () => {
    assert.equal(parseFilters("?sortDir=asc").sortDir, "asc");
  });
});

describe("serializeFilters sortDir", () => {
  it("omits desc by default and serializes asc", () => {
    const descQs = serializeFilters(DEFAULT_INSIGHTS_FILTERS);
    assert.equal(descQs.get("sortDir"), null);

    const ascQs = serializeFilters({ ...DEFAULT_INSIGHTS_FILTERS, sortDir: "asc" });
    assert.equal(ascQs.get("sortDir"), "asc");
  });

  it("round-trips category, favourites, and sort", () => {
    const filters = {
      ...DEFAULT_INSIGHTS_FILTERS,
      category: "politics",
      favouritesOnly: true,
      sortDir: "asc" as const,
    };
    const roundTrip = parseFilters(`?${serializeFilters(filters).toString()}`);
    assert.equal(roundTrip.category, "politics");
    assert.equal(roundTrip.favouritesOnly, true);
    assert.equal(roundTrip.sortDir, "asc");
  });

  it("includes sortDir in canonical cache key", () => {
    const key = canonicalCacheKey("rankings", {
      ...DEFAULT_INSIGHTS_FILTERS,
      sortDir: "asc",
    });
    assert.match(key, /sortDir=asc/);
  });
});
