import test from "node:test";
import assert from "node:assert/strict";

import { isAdminRole, isStaffRole, resolveProfileRole } from "../server/utils/authz";

test("resolveProfileRole defaults to user", () => {
  assert.equal(resolveProfileRole(undefined), "user");
  assert.equal(resolveProfileRole(null), "user");
  assert.equal(resolveProfileRole("admin"), "admin");
});

test("isAdminRole only accepts admin", () => {
  assert.equal(isAdminRole("admin"), true);
  assert.equal(isAdminRole("user"), false);
  assert.equal(isAdminRole(undefined), false);
});

test("isStaffRole accepts admin and moderator", () => {
  assert.equal(isStaffRole("admin"), true);
  assert.equal(isStaffRole("moderator"), true);
  assert.equal(isStaffRole("user"), false);
  assert.equal(isStaffRole(undefined), false);
});
