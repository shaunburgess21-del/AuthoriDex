import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeEngagementBlendWeight,
  normalizeEngagementScore,
  getEngagementWeightMax,
} from "../server/scoring/engagement";
import { computeTrendScore } from "../server/scoring/trendScore";

describe("engagement scoring", () => {
  it("blend weight is 0 when max weight is 0 (default pre-launch)", () => {
    const prevMax = process.env.ENGAGEMENT_WEIGHT_MAX;
    process.env.ENGAGEMENT_WEIGHT_MAX = "0";
    try {
      assert.equal(getEngagementWeightMax(), 0);
      assert.equal(computeEngagementBlendWeight(10_000), 0);
    } finally {
      if (prevMax === undefined) delete process.env.ENGAGEMENT_WEIGHT_MAX;
      else process.env.ENGAGEMENT_WEIGHT_MAX = prevMax;
    }
  });

  it("normalizeEngagementScore returns 0 for no activity", () => {
    assert.equal(normalizeEngagementScore(0, 0), 0);
  });

  it("volume gate ramps blend weight with fleet activity", () => {
    const prevMax = process.env.ENGAGEMENT_WEIGHT_MAX;
    const prevGate = process.env.ENGAGEMENT_VOLUME_GATE;
    process.env.ENGAGEMENT_WEIGHT_MAX = "0.1";
    process.env.ENGAGEMENT_VOLUME_GATE = "100";
    try {
      assert.equal(computeEngagementBlendWeight(0), 0);
      assert.ok(computeEngagementBlendWeight(50) > 0);
      assert.ok(computeEngagementBlendWeight(200) >= computeEngagementBlendWeight(50));
    } finally {
      if (prevMax === undefined) delete process.env.ENGAGEMENT_WEIGHT_MAX;
      else process.env.ENGAGEMENT_WEIGHT_MAX = prevMax;
      if (prevGate === undefined) delete process.env.ENGAGEMENT_VOLUME_GATE;
      else process.env.ENGAGEMENT_VOLUME_GATE = prevGate;
    }
  });

  it("computeTrendScore unchanged when engagement blend weight is 0", () => {
    const inputs = {
      wikiPageviews: 50_000,
      wikiPageviews7dAvg: 45_000,
      wikiDelta: 0,
      newsDelta: 0,
      searchDelta: 0,
      newsCount: 10,
      activePlatforms: { wiki: true, instagram: false, youtube: false },
      engagementVotes: 100,
      engagementProfileViews: 100,
      engagementBlendWeight: 0,
    };
    const without = computeTrendScore(inputs);
    assert.equal(without.engagementBlendWeight, 0);
    assert.ok(without.fameIndex > 0);
  });
});
