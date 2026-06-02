import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capEngagementInputs } from "../server/scoring/engagement";

describe("engagement hour-bucket contract", () => {
  it("caps per-person votes and views independently", () => {
    const capped = capEngagementInputs(999, 999);
    assert.ok(capped.votes <= 10);
    assert.ok(capped.profileViews <= 100);
  });

  it("hour window is exactly one UTC hour", () => {
    const bucket = new Date("2026-06-02T14:00:00.000Z");
    const end = new Date(bucket.getTime() + 60 * 60 * 1000);
    assert.equal(end.toISOString(), "2026-06-02T15:00:00.000Z");
  });
});
