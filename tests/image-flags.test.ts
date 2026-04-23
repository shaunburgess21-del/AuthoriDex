import test from "node:test";
import assert from "node:assert/strict";

import {
  IMAGE_FLAG_RATE_LIMIT,
  IMAGE_FLAG_REASONS,
  isImageFlagRateLimited,
  isValidImageFlagReason,
} from "../server/utils/image-flags";

test("isValidImageFlagReason accepts every enum value (happy path)", () => {
  for (const reason of IMAGE_FLAG_REASONS) {
    assert.equal(isValidImageFlagReason(reason), true, `expected '${reason}' to be valid`);
  }
});

test("isValidImageFlagReason rejects invalid inputs (400 path)", () => {
  assert.equal(isValidImageFlagReason("spam"), false);
  assert.equal(isValidImageFlagReason(""), false);
  assert.equal(isValidImageFlagReason(null), false);
  assert.equal(isValidImageFlagReason(undefined), false);
  assert.equal(isValidImageFlagReason(42), false);
  assert.equal(isValidImageFlagReason({}), false);
});

test("isImageFlagRateLimited fires on the 11th flag in the window (429 path)", () => {
  assert.equal(isImageFlagRateLimited(0), false);
  assert.equal(isImageFlagRateLimited(IMAGE_FLAG_RATE_LIMIT - 1), false, "9 flags should still allow a 10th");
  assert.equal(isImageFlagRateLimited(IMAGE_FLAG_RATE_LIMIT), true, "10 flags already in window blocks the 11th");
  assert.equal(isImageFlagRateLimited(IMAGE_FLAG_RATE_LIMIT + 5), true);
});
