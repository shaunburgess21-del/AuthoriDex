import test from "node:test";
import assert from "node:assert/strict";

import { formatResolutionImminentNotification } from "../server/jobs/resolution-imminent-utils";

// Pure helper — no DB. Pins the title/body wording for the
// position_resolution_imminent kind so any future formatter changes
// have to be intentional. Uses an em-dash that the source builds as
// "\u2014" — replicate the same here to keep equality checks tidy.
const EMDASH = "\u2014";

test("6h remaining renders integer hour label", () => {
  const out = formatResolutionImminentNotification({
    subjectLabel: "Mark Cuban",
    netShares: 240,
    hoursRemaining: 6,
  });
  assert.equal(out.title, `Mark Cuban resolves in 6h ${EMDASH} you're still holding`);
  assert.equal(out.body, "Your position: 240 shares. Last call before payout lands.");
});

test("3.7h remaining floors to 3h", () => {
  const out = formatResolutionImminentNotification({
    subjectLabel: "Conor McGregor",
    netShares: 100,
    hoursRemaining: 3.7,
  });
  assert.equal(out.title, `Conor McGregor resolves in 3h ${EMDASH} you're still holding`);
});

test("0.5h remaining renders as <1h (avoids misleading '0h')", () => {
  const out = formatResolutionImminentNotification({
    subjectLabel: "Tesla",
    netShares: 50,
    hoursRemaining: 0.5,
  });
  assert.equal(out.title, `Tesla resolves in <1h ${EMDASH} you're still holding`);
});

test("0h (exactly at deadline) renders as <1h", () => {
  const out = formatResolutionImminentNotification({
    subjectLabel: "Edge case",
    netShares: 10,
    hoursRemaining: 0,
  });
  assert.equal(out.title, `Edge case resolves in <1h ${EMDASH} you're still holding`);
});

test("negative hoursRemaining clamps to 0 → <1h", () => {
  // Cron timing slip — endAt slid past NOW between query and fire.
  // Render gracefully rather than printing "-0h" or "Infinity".
  const out = formatResolutionImminentNotification({
    subjectLabel: "Clock skew",
    netShares: 10,
    hoursRemaining: -0.2,
  });
  assert.equal(out.title, `Clock skew resolves in <1h ${EMDASH} you're still holding`);
});

test("non-finite hoursRemaining falls back to <1h", () => {
  const out = formatResolutionImminentNotification({
    subjectLabel: "NaN handling",
    netShares: 10,
    hoursRemaining: NaN,
  });
  assert.equal(out.title, `NaN handling resolves in <1h ${EMDASH} you're still holding`);
});

test("netShares uses singular 'share' when count rounds to 1", () => {
  const out = formatResolutionImminentNotification({
    subjectLabel: "Single share",
    netShares: 1,
    hoursRemaining: 4,
  });
  assert.equal(out.body, "Your position: 1 share. Last call before payout lands.");
});

test("large netShares uses en-US thousands separator", () => {
  const out = formatResolutionImminentNotification({
    subjectLabel: "Whale market",
    netShares: 12_345.7,
    hoursRemaining: 5,
  });
  assert.equal(out.body, "Your position: 12,346 shares. Last call before payout lands.");
});

test("negative netShares clamps to 0 (defensive)", () => {
  // Net shares should never be negative on a fire-path row, but the
  // helper should not produce "-N shares" in the body if it does.
  const out = formatResolutionImminentNotification({
    subjectLabel: "Defensive",
    netShares: -5,
    hoursRemaining: 2,
  });
  assert.equal(out.body, "Your position: 0 shares. Last call before payout lands.");
});
