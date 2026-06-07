import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sortValueForSource } from "../server/services/insights/signal-utils";

const BASE_ROW = {
  fameIndex: 100_000,
  velocityScore: 1,
  massScore: 1,
  newsMomentumRatio: 1.5,
  wikiMomentumRatio: 1.2,
  newsCount: 10,
  newsDailyAvg7d: 5,
  wikiPageviews: 1000,
  wiki7dSum: 7000,
  searchVolume: 50_000,
  change24h: 10,
  change7d: 5,
};

describe("sortValueForSource (fame / Movers board)", () => {
  it("sorts by the windowed Trend Score % change", () => {
    assert.equal(sortValueForSource("fame", BASE_ROW, "24h"), 10);
    assert.equal(sortValueForSource("fame", BASE_ROW, "7d"), 5);
  });

  it("sinks unknown change to the bottom via a sentinel", () => {
    const unknown = sortValueForSource(
      "fame",
      { ...BASE_ROW, change24h: null, change7d: 5 },
      "24h",
    );
    const known = sortValueForSource("fame", BASE_ROW, "24h");
    assert.ok(unknown < known);
    assert.ok(unknown < 0);
  });
});
