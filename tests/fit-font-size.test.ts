import test from "node:test";
import assert from "node:assert/strict";

import { chooseFontSizeForHeight } from "../client/src/lib/fitFontSize.ts";

test("picks the largest size that still fits", () => {
  const measure = (size: number) => (size <= 19 ? 46 : 72);
  assert.equal(chooseFontSizeForHeight(measure, 11, 32, 64), 19);
});

test("does not keep a size whose block is taller than the cap", () => {
  const measure = (size: number) => (size <= 17 ? 41 : 65);
  const chosen = chooseFontSizeForHeight(measure, 11, 32, 64);
  assert.equal(chosen, 17);
  assert.ok(measure(chosen) <= 64);
});

test("returns the minimum when every size overflows", () => {
  const measure = () => 80;
  assert.equal(chooseFontSizeForHeight(measure, 11, 32, 64), 11);
});

test("returns the maximum when every size fits", () => {
  const measure = () => 20;
  assert.equal(chooseFontSizeForHeight(measure, 11, 32, 64), 32);
});
