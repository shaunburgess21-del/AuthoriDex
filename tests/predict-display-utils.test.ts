import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSignedPercent,
  formatSignedPoints,
  getRecentActivityMarketPath,
  shouldRenderCrowdSentiment,
} from "../client/src/lib/predict-display";

test("formatSignedPercent keeps negative sign and prefixes positive sign", () => {
  assert.equal(formatSignedPercent(12.34), "+12.3%");
  assert.equal(formatSignedPercent(-4.01), "-4.0%");
});

test("formatSignedPercent handles zero", () => {
  assert.equal(formatSignedPercent(0), "+0.0%");
});

test("formatSignedPercent handles NaN and Infinity", () => {
  assert.equal(formatSignedPercent(NaN), "--");
  assert.equal(formatSignedPercent(Infinity), "--");
  assert.equal(formatSignedPercent(-Infinity), "--");
});

test("formatSignedPercent respects custom fractionDigits", () => {
  assert.equal(formatSignedPercent(12.345, 2), "+12.35%");
  assert.equal(formatSignedPercent(-0.1, 0), "-0%");
});

test("formatSignedPoints handles NaN", () => {
  assert.equal(formatSignedPoints(NaN), "--");
});

test("formatSignedPoints formats positive and negative numbers", () => {
  assert.equal(formatSignedPoints(1500), "+1,500");
  assert.equal(formatSignedPoints(-200), "-200");
  assert.equal(formatSignedPoints(0), "+0");
});

test("shouldRenderCrowdSentiment renders 0 but not nullish values", () => {
  assert.equal(shouldRenderCrowdSentiment(0), true);
  assert.equal(shouldRenderCrowdSentiment(42), true);
  assert.equal(shouldRenderCrowdSentiment(null), false);
  assert.equal(shouldRenderCrowdSentiment(undefined), false);
});

test("getRecentActivityMarketPath routes community markets by slug", () => {
  assert.equal(getRecentActivityMarketPath("rfk-vs-ternus", "community", "abc-id"), "/markets/rfk-vs-ternus");
  // No slug => fallback rather than broken URL
  assert.equal(getRecentActivityMarketPath(null, "community", "abc-id"), "/predict");
});

test("getRecentActivityMarketPath routes native markets by id to their dedicated detail page", () => {
  assert.equal(getRecentActivityMarketPath("weekly-foo", "updown", "abc-id"), "/predict/updown/abc-id");
  assert.equal(getRecentActivityMarketPath("weekly-foo", "h2h", "abc-id"), "/predict/h2h/abc-id");
  assert.equal(getRecentActivityMarketPath("weekly-foo", "gainer", "abc-id"), "/predict/race/abc-id");
});

test("getRecentActivityMarketPath sends jackpot bets to the predict page (no detail page)", () => {
  assert.equal(getRecentActivityMarketPath("weekly-foo", "jackpot", "abc-id"), "/predict");
});

test("getRecentActivityMarketPath falls back to /predict when inputs are missing or unrecognised", () => {
  assert.equal(getRecentActivityMarketPath("weekly-foo"), "/predict");
  assert.equal(getRecentActivityMarketPath(""), "/predict");
  assert.equal(getRecentActivityMarketPath(undefined), "/predict");
  assert.equal(getRecentActivityMarketPath(null), "/predict");
  // Native type but no marketId => can't build a valid URL, fall back
  assert.equal(getRecentActivityMarketPath("weekly-foo", "h2h"), "/predict");
});
