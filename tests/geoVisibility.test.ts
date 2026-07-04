import test from "node:test";
import assert from "node:assert/strict";
import {
  isCardVisibleToUser,
  isGloballyVisible,
  sanitizeVisibleCountries,
} from "../shared/geoVisibility";

test("isGloballyVisible: empty or missing allowlist is global", () => {
  assert.equal(isGloballyVisible([]), true);
  assert.equal(isGloballyVisible(null), true);
  assert.equal(isGloballyVisible(undefined), true);
});

test("isCardVisibleToUser: residence must match allowlist", () => {
  assert.equal(isCardVisibleToUser(["US", "CA"], "US"), true);
  assert.equal(isCardVisibleToUser(["US", "CA"], "us"), true);
  assert.equal(isCardVisibleToUser(["US"], "ZA"), false);
  assert.equal(isCardVisibleToUser(["US"], null), false);
  assert.equal(isCardVisibleToUser(["US"], undefined), false);
  assert.equal(isCardVisibleToUser([], "ZA"), true);
});

test("sanitizeVisibleCountries: dedupes and uppercases valid ISO codes", () => {
  assert.deepEqual(sanitizeVisibleCountries(["us", "US", "gb", "XX"]), ["US", "GB"]);
  assert.deepEqual(sanitizeVisibleCountries(null), []);
});
