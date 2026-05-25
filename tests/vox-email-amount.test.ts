import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENCY,
  formatVoxAmountEmail,
  voxMarkEmailUrl,
  VOX_MARK_EMAIL_PATH,
} from "../shared/currency";

test("VOX_MARK_EMAIL_PATH", () => {
  assert.equal(VOX_MARK_EMAIL_PATH, "/fonts/vox-mark-email.png");
});

test("voxMarkEmailUrl: strips trailing slash from baseUrl", () => {
  assert.equal(
    voxMarkEmailUrl("https://voxdex.com/"),
    "https://voxdex.com/fonts/vox-mark-email.png",
  );
  assert.equal(
    voxMarkEmailUrl("https://voxdex.com"),
    "https://voxdex.com/fonts/vox-mark-email.png",
  );
});

test("formatVoxAmountEmail: positive variant", () => {
  assert.equal(formatVoxAmountEmail(471, "positive"), "+471");
  assert.equal(formatVoxAmountEmail(1234, "positive"), "+1,234");
});

test("formatVoxAmountEmail: negative variant", () => {
  assert.equal(formatVoxAmountEmail(500, "negative"), "\u2212500");
});

test("formatVoxAmountEmail: parens variant preserves sign, no glyph", () => {
  assert.equal(formatVoxAmountEmail(-500, "parens"), "\u2212500");
  assert.equal(formatVoxAmountEmail(40, "parens"), "40");
  assert.ok(!formatVoxAmountEmail(-500, "parens").includes(CURRENCY.symbol));
});

test("formatVoxAmountEmail: non-finite falls back to zero", () => {
  assert.equal(formatVoxAmountEmail(Number.NaN, "positive"), "+0");
});
