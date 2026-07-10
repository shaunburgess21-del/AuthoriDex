import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HOUSE_PROFILE_ID,
  SCOUT_PROFILE_ID,
  isInfrastructureProfile,
} from "../server/utils/infrastructure-profiles";
import {
  canModerateUser,
  isInfrastructureUser,
} from "../client/src/pages/admin/adminTypes";

describe("infrastructure profiles", () => {
  it("recognises fixed house and scout UUIDs", () => {
    assert.equal(isInfrastructureProfile({ id: HOUSE_PROFILE_ID, role: "user" }), true);
    assert.equal(isInfrastructureProfile({ id: SCOUT_PROFILE_ID, role: "user" }), true);
  });

  it("recognises role=system", () => {
    assert.equal(
      isInfrastructureProfile({ id: "00000000-0000-0000-0000-000000000099", role: "system" }),
      true,
    );
  });

  it("rejects normal users", () => {
    assert.equal(
      isInfrastructureProfile({ id: "00000000-0000-0000-0000-000000000099", role: "user" }),
      false,
    );
  });
});

describe("admin user moderation helpers", () => {
  it("blocks infrastructure from moderation", () => {
    assert.equal(canModerateUser({ role: "system", isSystem: true }), false);
    assert.equal(canModerateUser({ role: "user", isSystem: false }), true);
    assert.equal(canModerateUser({ role: "admin", isSystem: false }), false);
  });

  it("detects infrastructure users for UI badges", () => {
    assert.equal(isInfrastructureUser({ role: "system" }), true);
    assert.equal(isInfrastructureUser({ role: "user", isSystem: true }), true);
    assert.equal(isInfrastructureUser({ role: "user" }), false);
  });
});
