import test from "node:test";
import assert from "node:assert/strict";
import { getRecentActivityMarketPath } from "../shared/lib/market-paths";

test("getRecentActivityMarketPath routes native markets by id", () => {
  assert.equal(getRecentActivityMarketPath("slug", "updown", "id-1"), "/predict/updown/id-1");
  assert.equal(getRecentActivityMarketPath("slug", "h2h", "id-2"), "/predict/h2h/id-2");
  assert.equal(getRecentActivityMarketPath("slug", "gainer", "id-3"), "/predict/race/id-3");
});

test("getRecentActivityMarketPath routes community by slug", () => {
  assert.equal(getRecentActivityMarketPath("my-market", "community", "id-1"), "/markets/my-market");
});
