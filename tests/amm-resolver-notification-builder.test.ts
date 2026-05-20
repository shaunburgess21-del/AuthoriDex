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

test("gainer win with contextLabel leads body with candidate pick", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Category Race: Streaming",
    contextLabel: "Clavicular",
    won: true,
    stake: 100,
    payout: 200,
  });
  assert.ok(built);
  assert.equal(built!.title, "Your prediction won — +100 credits");
  assert.equal(
    built!.body,
    "Clavicular · Category Race: Streaming resolved. Payout 200 credits (net +100).",
  );
});

test("won-but-fully-sold without pre-close proceeds (back-compat) → suppressed (null)", () => {
  // Buy row marked status='won' but payoutAmount=0 because the user
  // sold all their winner-side shares before resolution. When the
  // caller hasn't aggregated pre-close sells (preResolveSellProceeds
  // omitted) the builder degrades to the legacy suppression, so older
  // call sites don't regress into the self-contradictory
  // "Stake returned — 0 credits (net -500)" message.
  const built = buildAmmResolutionNotification({
    marketTitle: "Mark Cuban: Up or Down?",
    won: true,
    stake: 500,
    payout: 0,
  });
  assert.equal(built, null);
});

test("won-but-fully-sold with profitable pre-close proceeds → 'sold beforehand' with positive net", () => {
  // Tier 1.7: user bought 500 cr of the winning side, sold for 720 cr
  // before resolution. Settlement row shows payout=0 (no shares left
  // to pay out) but they DID realise +220 cr. Resolution ping should
  // reflect that, not stay silent.
  const built = buildAmmResolutionNotification({
    marketTitle: "Mark Cuban: Up or Down?",
    won: true,
    stake: 500,
    payout: 0,
    preResolveSellProceeds: 720,
  });
  assert.ok(built, "expected a notification when sold-beforehand proceeds > 0");
  assert.equal(built!.title, "Your market resolved — you'd sold beforehand");
  assert.equal(
    built!.body,
    "Mark Cuban: Up or Down? resolved on your side. You'd already sold those shares for 720 credits (net +220).",
  );
});

test("won-but-fully-sold with pre-close proceeds below stake → signed-negative net is rendered", () => {
  // User sold winner-side shares early at a loss (e.g. bought at a
  // high price then panic-sold on a swing). They still get closure
  // with the realised loss spelled out.
  const built = buildAmmResolutionNotification({
    marketTitle: "Some Market",
    won: true,
    stake: 1_000,
    payout: 0,
    preResolveSellProceeds: 750,
  });
  assert.ok(built);
  assert.equal(built!.title, "Your market resolved — you'd sold beforehand");
  assert.equal(
    built!.body,
    "Some Market resolved on your side. You'd already sold those shares for 750 credits (net -250).",
  );
});

test("won-but-fully-sold with preResolveSellProceeds === 0 → suppressed (degenerate)", () => {
  // Structurally near-unreachable (winner-side buy with payout=0 and
  // ZERO pre-close sells), but the guard avoids resurrecting the
  // legacy "net -<stake>" bug if a future code path passes a zero
  // proceeds figure explicitly.
  const built = buildAmmResolutionNotification({
    marketTitle: "Degenerate market",
    won: true,
    stake: 500,
    payout: 0,
    preResolveSellProceeds: 0,
  });
  assert.equal(built, null);
});

test("won-but-fully-sold with non-finite proceeds → suppressed", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Defensive",
    won: true,
    stake: 500,
    payout: 0,
    preResolveSellProceeds: Number.NaN,
  });
  assert.equal(built, null);
});

test("preResolveSellProceeds is ignored on non-zero payout branches", () => {
  // The new field only matters for the won-but-fully-sold path. A
  // normal winner with payout > 0 should still render the standard
  // "Your prediction won" wording even if proceeds is plumbed.
  const built = buildAmmResolutionNotification({
    marketTitle: "Plumb-through guard",
    won: true,
    stake: 100,
    payout: 207,
    preResolveSellProceeds: 999,
  });
  assert.ok(built);
  assert.equal(built!.title, "Your prediction won — +107 credits");
});

test("won + payout === stake (profit=0, parity buy) → 'Stake returned' wording is accurate now that payout=0 is suppressed upstream", () => {
  // Edge case in LMSR pricing where the user bought at price=1.0
  // and a winning share paid out 1:1. The 'Stake returned' wording
  // is semantically correct here — the original bug was only that
  // this branch also fired for payout=0 (Mark Cuban case), which
  // is now suppressed at the head of the helper.
  const built = buildAmmResolutionNotification({
    marketTitle: "Parity buy market",
    won: true,
    stake: 200,
    payout: 200,
  });
  assert.ok(built, "expected a notification, got null");
  assert.equal(built!.title, "Stake returned — 200 credits");
  assert.equal(
    built!.body,
    "Parity buy market resolved. Payout matched your stake (net +0).",
  );
});

test("won + payout=0 must NOT trigger the 'Stake returned' branch (regression guard for Mark Cuban bug)", () => {
  // Belt-and-braces: the original bug was payout=0 falling into the
  // 'Stake returned' branch and printing a self-contradictory
  // 'net -<stake>' body. Even if a future edit reorders branches,
  // this case must return null.
  const built = buildAmmResolutionNotification({
    marketTitle: "Regression guard",
    won: true,
    stake: 500,
    payout: 0,
  });
  assert.equal(built, null);
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
