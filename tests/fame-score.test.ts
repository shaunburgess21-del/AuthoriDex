import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFameScore } from "../client/src/lib/fameScore";

describe("resolveFameScore", () => {
  it("prefers fameIndexLive over fameIndex", () => {
    assert.equal(
      resolveFameScore({ fameIndexLive: 900, fameIndex: 800, trendScore: 50_000 }),
      900,
    );
  });

  it("falls back to fameIndex when live is null", () => {
    assert.equal(
      resolveFameScore({ fameIndexLive: null, fameIndex: 793_009, trendScore: 50_000 }),
      793_009,
    );
  });

  it("derives from trendScore when index fields are missing", () => {
    assert.equal(
      resolveFameScore({ fameIndex: null, trendScore: 79_300_900 }),
      793_009,
    );
  });

  it("returns 0 when all inputs are empty", () => {
    assert.equal(resolveFameScore({}), 0);
  });
});
