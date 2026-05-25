import test from "node:test";
import assert from "node:assert/strict";

import {
  buildJackpotResolvedLossNotification,
  buildJackpotResolvedWinNotification,
} from "../server/jobs/jackpot-resolved-utils";

test("jackpot win with profit → market-first title", () => {
  const out = buildJackpotResolvedWinNotification({
    marketTitle: "Celebrity score pool",
    actualScore: 42,
    predictedScore: 40,
    diff: 2,
    stake: 100,
    payout: 470,
  });
  assert.equal(out.title, "Celebrity score pool jackpot — +Ꝟ370");
  assert.match(out.body, /Closed at 42/);
  assert.match(out.body, /Payout Ꝟ470/);
});

test("jackpot win break-even → stake returned title", () => {
  const out = buildJackpotResolvedWinNotification({
    marketTitle: "Tight pool",
    actualScore: 10,
    predictedScore: 10,
    diff: 0,
    stake: 50,
    payout: 50,
  });
  assert.equal(out.title, "Tight pool jackpot — stake returned");
  assert.match(out.body, /net Ꝟ0/);
});

test("jackpot loss → market in title", () => {
  const out = buildJackpotResolvedLossNotification({
    marketTitle: "Weekly jackpot",
    actualScore: 99,
    stake: 25,
  });
  assert.equal(out.title, "Weekly jackpot jackpot didn't land");
  assert.equal(out.body, "Closed at 99. Lost Ꝟ25.");
});
