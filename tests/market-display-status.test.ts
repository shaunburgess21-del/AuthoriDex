import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveMarketDisplayStatus,
  isTradingCutoffPassed,
} from "../client/src/lib/marketDisplayStatus";
import { isCommunityTradingClosed } from "../client/src/lib/marketClosedMessaging";

const NOW = Date.parse("2026-11-26T19:20:00.000Z");
const PAST_CLOSE = "2026-11-26T08:01:08.207Z";
const FUTURE_CLOSE = "2026-12-01T08:00:00.000Z";
const FUTURE_END = "2027-12-31T21:00:00.000Z";

test("OPEN before the cutoff stays open and live", () => {
  const status = deriveMarketDisplayStatus(
    { status: "OPEN", closeAt: FUTURE_CLOSE, endAt: FUTURE_END },
    NOW,
  );
  assert.equal(status.phase, "open");
  assert.equal(status.label, "Open");
  assert.equal(status.canTrade, true);
  assert.equal(status.showLive, true);
  assert.equal(status.messageStatus, "OPEN");
  assert.equal(status.cyclePhase, "OPEN");
  assert.equal(
    isCommunityTradingClosed(
      { status: "OPEN", closeAt: FUTURE_CLOSE, endAt: FUTURE_END },
      NOW,
    ),
    false,
  );
});

test("OPEN after closeAt is trading-closed while the outcome is still in the future", () => {
  const market = { status: "OPEN", closeAt: PAST_CLOSE, endAt: FUTURE_END };
  const status = deriveMarketDisplayStatus(market, NOW);
  assert.equal(status.phase, "trading_closed");
  assert.equal(status.label, "Trading closed");
  assert.equal(status.canTrade, false);
  assert.equal(status.showLive, false);
  assert.equal(status.messageStatus, "CLOSED_PENDING");
  assert.equal(status.cyclePhase, "ENTRIES_CLOSED");
  assert.equal(isCommunityTradingClosed(market, NOW), true);
});

test("endAt past closes trading when closeAt is missing", () => {
  const status = deriveMarketDisplayStatus(
    { status: "OPEN", closeAt: null, endAt: PAST_CLOSE },
    NOW,
  );
  assert.equal(status.phase, "trading_closed");
  assert.equal(status.canTrade, false);
});

test("a future closeAt does not keep trading open once endAt has passed", () => {
  assert.equal(
    isTradingCutoffPassed({ closeAt: FUTURE_CLOSE, endAt: PAST_CLOSE }, NOW),
    true,
  );
  const status = deriveMarketDisplayStatus(
    { status: "OPEN", closeAt: FUTURE_CLOSE, endAt: PAST_CLOSE },
    NOW,
  );
  assert.equal(status.phase, "trading_closed");
});

test("closeAt exactly at now is closed", () => {
  assert.equal(
    isTradingCutoffPassed({ closeAt: new Date(NOW), endAt: FUTURE_END }, NOW),
    true,
  );
});

test("OPEN with no dates stays open", () => {
  const status = deriveMarketDisplayStatus({ status: "OPEN" }, NOW);
  assert.equal(status.phase, "open");
  assert.equal(status.canTrade, true);
});

test("CLOSED_PENDING is trading-closed even when the cutoff is still ahead", () => {
  const status = deriveMarketDisplayStatus(
    { status: "CLOSED_PENDING", closeAt: FUTURE_CLOSE, endAt: FUTURE_END },
    NOW,
  );
  assert.equal(status.phase, "trading_closed");
  assert.equal(status.showLive, false);
  assert.equal(status.canTrade, false);
});

test("RESOLVED and VOID are not tradable and hide the cycle strip", () => {
  const resolved = deriveMarketDisplayStatus(
    { status: "RESOLVED", closeAt: PAST_CLOSE, endAt: FUTURE_END },
    NOW,
  );
  assert.equal(resolved.phase, "resolved");
  assert.equal(resolved.label, "Resolved");
  assert.equal(resolved.showLive, false);
  assert.equal(resolved.cyclePhase, null);
  assert.equal(resolved.messageStatus, "RESOLVED");

  const voided = deriveMarketDisplayStatus({ status: "VOID", closeAt: FUTURE_CLOSE }, NOW);
  assert.equal(voided.phase, "void");
  assert.equal(voided.label, "Void");
  assert.equal(voided.messageStatus, "VOID");
  assert.equal(voided.canTrade, false);
  assert.equal(voided.showLive, false);
});

test("missing or unknown status is not tradable", () => {
  assert.equal(deriveMarketDisplayStatus({ status: null, closeAt: FUTURE_CLOSE }, NOW).canTrade, false);
  assert.equal(deriveMarketDisplayStatus({ status: "DRAFT", closeAt: FUTURE_CLOSE }, NOW).phase, "trading_closed");
});

test("invalid cutoff strings are ignored", () => {
  const status = deriveMarketDisplayStatus(
    { status: "OPEN", closeAt: "not-a-date", endAt: "also-bad" },
    NOW,
  );
  assert.equal(status.phase, "open");
});
