import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSignedPercent,
  getRecentActivityMarketPath,
  shouldRenderCrowdSentiment,
} from "../client/src/lib/predict-display";

test("formatSignedPercent keeps negative sign and prefixes positive sign", () => {
  assert.equal(formatSignedPercent(12.34), "+12.3%");
  assert.equal(formatSignedPercent(-4.01), "-4.0%");
});

test("shouldRenderCrowdSentiment renders 0 but not nullish values", () => {
  assert.equal(shouldRenderCrowdSentiment(0), true);
  assert.equal(shouldRenderCrowdSentiment(42), true);
  assert.equal(shouldRenderCrowdSentiment(null), false);
  assert.equal(shouldRenderCrowdSentiment(undefined), false);
});

test("getRecentActivityMarketPath routes to market details when slug exists", () => {
  assert.equal(getRecentActivityMarketPath("weekly-foo"), "/markets/weekly-foo");
  assert.equal(getRecentActivityMarketPath(""), "/predict");
  assert.equal(getRecentActivityMarketPath(undefined), "/predict");
});
