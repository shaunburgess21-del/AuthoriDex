import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMMENT_VOLUME_BOOST_UNTIL_MS,
  COMMENT_VOLUME_CAP_MULT,
  COMMENT_VOLUME_CHANCE_MULT,
  applyCommentVolumeBoost,
  isCommentVolumeBoostActive,
} from "../server/agents/commentVolumeBoost";
import type { AgentSimulationProfile } from "../server/agents/simulationProfile";
import { SIMULATION_V2_COHORT_ID } from "../server/agents/simulationProfile";

const base: AgentSimulationProfile = {
  schemaVersion: 2,
  cohortId: SIMULATION_V2_COHORT_ID,
  personaBand: "casual",
  skillTier: 0.5,
  favoriteCategories: ["sports"],
  edgeThreshold: -0.02,
  publicConfidenceRate: 0.25,
  stakeMultiplier: 1,
  minStake: 75,
  maxStake: 250,
  weeklyVoteCap: 3,
  weeklyCommentCap: 1,
  dailyVoteChance: 0.18,
  dailyCommentChance: 0.020,
  commentStyle: "casual",
  bankrollProfile: "normal",
};

const during = new Date("2026-09-16T12:00:00.000Z");
const after = new Date("2026-09-20T00:00:00.000Z");

describe("isCommentVolumeBoostActive", () => {
  it("is on during the 5-day window", () => {
    assert.equal(isCommentVolumeBoostActive(during), true);
    assert.equal(isCommentVolumeBoostActive(new Date(COMMENT_VOLUME_BOOST_UNTIL_MS - 1)), true);
  });

  it("turns itself off at the until instant", () => {
    assert.equal(isCommentVolumeBoostActive(new Date(COMMENT_VOLUME_BOOST_UNTIL_MS)), false);
    assert.equal(isCommentVolumeBoostActive(after), false);
  });
});

describe("applyCommentVolumeBoost", () => {
  it("triples chance and caps while active", () => {
    const out = applyCommentVolumeBoost(base, during);
    assert.equal(out.dailyCommentChance, 0.020 * COMMENT_VOLUME_CHANCE_MULT);
    assert.equal(out.weeklyCommentCap, 1 * COMMENT_VOLUME_CAP_MULT);
    assert.equal(out.weeklyVoteCap, 3 * COMMENT_VOLUME_CAP_MULT);
  });

  it("does not mutate the input profile", () => {
    applyCommentVolumeBoost(base, during);
    assert.equal(base.dailyCommentChance, 0.020);
    assert.equal(base.weeklyCommentCap, 1);
  });

  it("is a no-op after the window", () => {
    const out = applyCommentVolumeBoost(base, after);
    assert.equal(out, base);
    assert.equal(out.dailyCommentChance, 0.020);
    assert.equal(out.weeklyCommentCap, 1);
  });

  it("keeps silent arb agents silent", () => {
    const arb: AgentSimulationProfile = {
      ...base,
      personaBand: "arb",
      weeklyVoteCap: 1,
      weeklyCommentCap: 0,
      dailyCommentChance: 0,
    };
    const out = applyCommentVolumeBoost(arb, during);
    assert.equal(out.dailyCommentChance, 0);
    assert.equal(out.weeklyCommentCap, 0);
  });

  it("clamps chance at 1", () => {
    const hot: AgentSimulationProfile = { ...base, dailyCommentChance: 0.5 };
    const out = applyCommentVolumeBoost(hot, during);
    assert.equal(out.dailyCommentChance, 1);
  });
});
