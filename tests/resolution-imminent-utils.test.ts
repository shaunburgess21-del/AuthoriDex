import test from "node:test";
import assert from "node:assert/strict";

import { CURRENCY } from "@shared/currency";
import { formatResolutionImminentNotification } from "../server/jobs/resolution-imminent-utils";

const SYM = CURRENCY.symbol;
const MIDDOT = "\u00b7";

function body(stake: number, shares: string, shareWord: string, payout: number): string {
  const stakeFmt = `${SYM}${stake.toLocaleString("en-US")}`;
  const payoutFmt = `${SYM}${payout.toLocaleString("en-US")}`;
  return `Staked ${stakeFmt} ${MIDDOT} ${shares} ${shareWord} (${payoutFmt} if your pick wins)`;
}

test("market-first title reads 'settles soon' (no precise countdown)", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Mark Cuban: Up or Down?",
    contextLabel: "Mark Cuban",
    netShares: 240,
    stakeCredits: 180,
  });
  assert.equal(out.title, "Mark Cuban: Up or Down? settles soon");
  assert.equal(out.body, body(180, "240", "shares", 240));
});

test("title omits the padded settlement hour entirely", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Who will win Wimbledon Women's Singles 2026?",
    netShares: 398,
    stakeCredits: 100,
  });
  assert.equal(out.title, "Who will win Wimbledon Women's Singles 2026? settles soon");
  assert.doesNotMatch(out.title, /\dh|<1h/);
});

test("category race title and body lead with candidate pick", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Category Race: Streaming",
    contextLabel: "Clavicular",
    netShares: 335,
    stakeCredits: 280,
  });
  assert.equal(out.title, `Clavicular ${MIDDOT} Category Race: Streaming settles soon`);
  assert.equal(out.body, body(280, "335", "shares", 335));
});

test("netShares uses singular share when count rounds to 1", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Who wins?",
    netShares: 1,
    stakeCredits: 1,
  });
  assert.equal(out.body, body(1, "1", "share", 1));
});

test("large netShares uses en-US thousands separator", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Whale market",
    netShares: 12_345.7,
    stakeCredits: 10_000,
  });
  assert.equal(out.title, "Whale market settles soon");
  assert.equal(out.body, body(10_000, "12,346", "shares", 12_346));
});

test("negative netShares clamps to 0 shares and payout", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Defensive",
    netShares: -5,
    stakeCredits: 50,
  });
  assert.equal(out.body, body(50, "0", "shares", 0));
});

test("losing-side position: stake exceeds max payout if pick wins", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Elon Musk vs Dario Amodei",
    netShares: 247,
    stakeCredits: 500,
  });
  assert.equal(out.title, "Elon Musk vs Dario Amodei settles soon");
  assert.equal(out.body, body(500, "247", "shares", 247));
});

test("break-even stake equals share count", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Even odds",
    netShares: 100,
    stakeCredits: 100,
  });
  assert.equal(out.body, body(100, "100", "shares", 100));
});

test("negative stakeCredits clamps to 0 staked", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Over-sold edge",
    netShares: 50,
    stakeCredits: -20,
  });
  assert.equal(out.body, body(0, "50", "shares", 50));
});
