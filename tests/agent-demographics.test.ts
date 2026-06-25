import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignAgentDemographics } from "../server/agents/agentDemographics";

describe("assignAgentDemographics", () => {
  const baseInput = {
    username: "BetTom42",
    bio: "Follows the market.",
    specialties: ["sports", "entertainment"],
    createdAt: new Date("2025-11-15T12:00:00.000Z"),
  };

  it("is deterministic for the same username", () => {
    const first = assignAgentDemographics(baseInput);
    const second = assignAgentDemographics(baseInput);
    assert.deepEqual(first, second);
  });

  it("assigns canonical gender and ISO country codes", () => {
    const fields = assignAgentDemographics(baseInput);
    assert.ok(["male", "female", "prefer_not_to_say"].includes(fields.gender));
    assert.match(fields.countryOfResidence, /^[A-Z]{2}$/);
    assert.match(fields.countryOfOrigin, /^[A-Z]{2}$/);
    assert.match(fields.dateOfBirth, /^\d{4}-01-01$/);
    assert.equal(fields.onboardingStep, 5);
    assert.ok(fields.onboardingCompletedAt >= baseInput.createdAt);
    assert.ok(fields.tosAcceptedAt >= baseInput.createdAt);
    assert.deepEqual(fields.statedInterests, ["sports", "film-tv"]);
  });

  it("varies assignments across usernames", () => {
    const a = assignAgentDemographics({ ...baseInput, username: "userA" });
    const b = assignAgentDemographics({ ...baseInput, username: "userB" });
    const differs =
      a.gender !== b.gender ||
      a.countryOfResidence !== b.countryOfResidence ||
      a.dateOfBirth !== b.dateOfBirth;
    assert.ok(differs, "expected different usernames to produce different demographics");
  });
});
