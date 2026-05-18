import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAmmResolutionNotification,
  buildAmmVoidNotification,
} from "../server/services/amm-resolver-notifications";

// Pure helper — no DB. These tests pin the AMM resolution notification
// wording so the calibration fixes (Sprint: notification-calibration-fixes)
// don't regress. See `amm-resolver-notifications.ts` for the full
// rationale on each branch.

test("won + positive payout → 'Your prediction won — +N credits' with thousands separator", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Vladimir Putin: Up or Down?",
    won: true,
    stake: 100,
    payout: 207,
  });
  assert.ok(built, "expected a notification, got null");
  assert.equal(built!.title, "Your prediction won — +107 credits");
  assert.equal(
    built!.body,
    "Vladimir Putin: Up or Down? resolved. Payout 207 credits (net +107).",
  );
});

test("won + positive payout with large numbers uses en-US thousands separator", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Jake Paul vs KSI",
    won: true,
    stake: 5_000,
    payout: 12_345,
  });
  assert.ok(built);
  assert.equal(built!.title, "Your prediction won — +7,345 credits");
  assert.equal(
    built!.body,
    "Jake Paul vs KSI resolved. Payout 12,345 credits (net +7,345).",
  );
});

test("lost → 'Your prediction didn't land' with stake amount", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Chamath Palihapitiya: Up or Down?",
    won: false,
    stake: 100,
    payout: 0,
  });
  assert.ok(built);
  assert.equal(built!.title, "Your prediction didn't land");
  assert.equal(
    built!.body,
    "Chamath Palihapitiya: Up or Down? resolved. Lost 100 credits — better luck next round.",
  );
});

test("won-but-fully-sold (Mark Cuban case) → suppressed (null)", () => {
  // Buy row marked status='won' but payoutAmount=0 because the user
  // sold all their winner-side shares before resolution. Notifying
  // here would print the self-contradictory
  // "Stake returned — 0 credits (net -500)" message that this fix
  // eliminates.
  const built = buildAmmResolutionNotification({
    marketTitle: "Mark Cuban: Up or Down?",
    won: true,
    stake: 500,
    payout: 0,
  });
  assert.equal(built, null);
});

test("theoretical won + payout === stake (profit=0) degrades to 'didn't land' wording, never contradictory", () => {
  // Structurally unreachable in production AMM (winning shares always
  // pay 100 credits, so non-zero payout strictly exceeds stake), but
  // we keep the assertion to lock the helper into "no contradictory
  // text" behaviour even if pricing ever changes.
  const built = buildAmmResolutionNotification({
    marketTitle: "Edge case market",
    won: true,
    stake: 200,
    payout: 200,
  });
  assert.ok(built, "expected fallback message, not null");
  assert.ok(
    !built!.title.includes("Stake returned"),
    `title must not claim 'Stake returned' for profit=0 (got: ${built!.title})`,
  );
  assert.ok(
    !built!.body.includes("Payout matched your stake"),
    `body must not claim 'Payout matched your stake' (got: ${built!.body})`,
  );
});

test("void notification matches parimutuel template with thousands separator", () => {
  const built = buildAmmVoidNotification({
    marketTitle: "Some Voided Market",
    refund: 2_500,
  });
  assert.equal(built.title, "Market voided — 2,500 credits refunded");
  assert.equal(
    built.body,
    "Some Voided Market was voided. 2,500 credits returned.",
  );
});
