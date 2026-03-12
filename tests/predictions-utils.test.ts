import test from "node:test";
import assert from "node:assert/strict";
import { inferPredictionDirection } from "../client/src/pages/me/predictions-utils";

test("inferPredictionDirection identifies positive outcomes", () => {
  assert.equal(inferPredictionDirection("Above 100"), "up");
  assert.equal(inferPredictionDirection("Yes"), "up");
});

test("inferPredictionDirection identifies negative outcomes", () => {
  assert.equal(inferPredictionDirection("Below 100"), "down");
  assert.equal(inferPredictionDirection("No"), "down");
});

test("inferPredictionDirection falls back to neutral for non-directional outcomes", () => {
  assert.equal(inferPredictionDirection("Taylor Swift"), "neutral");
  assert.equal(inferPredictionDirection(undefined), "neutral");
});
