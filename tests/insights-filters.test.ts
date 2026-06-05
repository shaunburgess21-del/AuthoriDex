import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTab } from "../shared/insights/filters";

describe("parseTab", () => {
  it("defaults to today with no params", () => {
    assert.equal(parseTab(""), "today");
    assert.equal(parseTab("?"), "today");
  });

  it("resolves canonical tab ids", () => {
    assert.equal(parseTab("?tab=today"), "today");
    assert.equal(parseTab("?tab=rankings"), "rankings");
    assert.equal(parseTab("?tab=discover"), "discover");
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
  });

  it("lands on rankings when filter params are present", () => {
    assert.equal(parseTab("?source=news_momentum"), "rankings");
    assert.equal(parseTab("?category=politics"), "rankings");
    assert.equal(parseTab("?fav=1"), "rankings");
  });

  it("prefers explicit tab over filter-only routing", () => {
    assert.equal(parseTab("?tab=discover&source=news_momentum"), "discover");
  });

  it("explicit today tab wins even with stale rankings filters present", () => {
    // Regression: the header now clears filters on tab switch, but if any
    // leak through, an explicit ?tab=today must still resolve to today
    // (not fall back to rankings via the filter-param heuristic).
    assert.equal(parseTab("?tab=today&source=news_momentum&window=7d"), "today");
  });
});
