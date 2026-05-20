import test from "node:test";
import assert from "node:assert/strict";

import { formatResolutionImminentNotification } from "../server/jobs/resolution-imminent-utils";

const EMDASH = "\u2014";
const MIDDOT = "\u00b7";

test("6h remaining: Your position title and market-only body", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Mark Cuban: Up or Down?",
    contextLabel: "Mark Cuban",
    netShares: 240,
    hoursRemaining: 6,
  });
  assert.equal(out.title, `Your position resolves in 6h ${EMDASH} you're still holding`);
  assert.equal(
    out.body,
    `Mark Cuban: Up or Down? ${MIDDOT} 240 shares. Last call before payout lands.`,
  );
});

test("3.7h remaining floors to 3h", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Conor McGregor: Up or Down?",
    netShares: 100,
    hoursRemaining: 3.7,
  });
  assert.equal(out.title, `Your position resolves in 3h ${EMDASH} you're still holding`);
});

test("0.5h remaining renders as <1h", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Tesla: Up or Down?",
    netShares: 50,
    hoursRemaining: 0.5,
  });
  assert.equal(out.title, `Your position resolves in <1h ${EMDASH} you're still holding`);
});

test("category race body leads with candidate pick", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Category Race: Streaming",
    contextLabel: "Clavicular",
    netShares: 335,
    hoursRemaining: 6,
  });
  assert.equal(
    out.body,
    `Clavicular ${MIDDOT} Category Race: Streaming ${MIDDOT} 335 shares. Last call before payout lands.`,
  );
});

test("netShares uses singular share when count rounds to 1", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Who wins?",
    netShares: 1,
    hoursRemaining: 4,
  });
  assert.equal(out.body, `Who wins? ${MIDDOT} 1 share. Last call before payout lands.`);
});

test("large netShares uses en-US thousands separator", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Whale market",
    netShares: 12_345.7,
    hoursRemaining: 5,
  });
  assert.equal(
    out.body,
    `Whale market ${MIDDOT} 12,346 shares. Last call before payout lands.`,
  );
});

test("negative netShares clamps to 0 shares", () => {
  const out = formatResolutionImminentNotification({
    marketTitle: "Defensive",
    netShares: -5,
    hoursRemaining: 2,
  });
  assert.equal(out.body, `Defensive ${MIDDOT} 0 shares. Last call before payout lands.`);
});
