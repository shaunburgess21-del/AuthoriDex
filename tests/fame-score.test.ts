import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFameScore } from "../client/src/lib/fameScore";

describe("resolveFameScore", () => {
  it("returns canonical fameIndex", () => {
    assert.equal(
      resolveFameScore({ fameIndex: 793_009, fameIndexLive: 900, trendScore: 50_000 }),
      793_009,
    );
  });

  it("ignores fameIndexLive (cosmetic lane only)", () => {
    assert.equal(
      resolveFameScore({ fameIndexLive: 900, fameIndex: null, trendScore: 793_009 }),
      793_009,
    );
  });

  it("falls back to trendScore when fameIndex is missing", () => {
    assert.equal(
      resolveFameScore({ fameIndex: null, trendScore: 793_009 }),
      793_009,
    );
  });

  it("returns 0 when all inputs are empty", () => {
    assert.equal(resolveFameScore({}), 0);
  });
});
