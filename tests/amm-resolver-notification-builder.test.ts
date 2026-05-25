import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAmmResolutionNotification,
  buildAmmVoidNotification,
} from "../server/services/amm-resolver-notifications";

test("won + positive payout → market-first title with signed profit", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Vladimir Putin: Up or Down?",
    won: true,
    stake: 100,
    payout: 207,
  });
  assert.ok(built, "expected a notification, got null");
  assert.equal(built!.title, "Vladimir Putin: Up or Down? won +Ꝟ107");
  assert.equal(built!.body, "Resolved. Payout Ꝟ207 (net +Ꝟ107).");
});

test("won + positive payout with large numbers uses en-US thousands separator", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Jake Paul vs KSI",
    won: true,
    stake: 5_000,
    payout: 12_345,
  });
  assert.ok(built);
  assert.equal(built!.title, "Jake Paul vs KSI won +Ꝟ7,345");
  assert.equal(built!.body, "Resolved. Payout Ꝟ12,345 (net +Ꝟ7,345).");
});

test("lost → market-first title; distinct per market on resolution nights", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Chamath Palihapitiya: Up or Down?",
    won: false,
    stake: 100,
    payout: 0,
  });
  assert.ok(built);
  assert.equal(built!.title, "Chamath Palihapitiya: Up or Down? didn't land");
  assert.equal(built!.body, "Resolved. Lost Ꝟ100.");
});

test("many losses on different markets get distinct titles", () => {
  const a = buildAmmResolutionNotification({
    marketTitle: "Theo Von",
    contextLabel: "Category Race: Comedy",
    won: false,
    stake: 100,
    payout: 0,
  });
  const b = buildAmmResolutionNotification({
    marketTitle: "Elon Musk vs Dario Amodei",
    won: false,
    stake: 200,
    payout: 0,
  });
  assert.ok(a && b);
  assert.notEqual(a!.title, b!.title);
  assert.match(a!.title, /Theo Von/);
  assert.match(b!.title, /Elon Musk vs Dario Amodei/);
});

test("gainer win with contextLabel leads title with candidate pick", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Category Race: Streaming",
    contextLabel: "Clavicular",
    won: true,
    stake: 100,
    payout: 200,
  });
  assert.ok(built);
  assert.equal(
    built!.title,
    "Clavicular · Category Race: Streaming won +Ꝟ100",
  );
  assert.equal(built!.body, "Resolved. Payout Ꝟ200 (net +Ꝟ100).");
});

test("won-but-fully-sold without pre-close proceeds (back-compat) → suppressed (null)", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Mark Cuban: Up or Down?",
    won: true,
    stake: 500,
    payout: 0,
  });
  assert.equal(built, null);
});

test("won-but-fully-sold with profitable pre-close proceeds → sold beforehand", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Mark Cuban: Up or Down?",
    won: true,
    stake: 500,
    payout: 0,
    preResolveSellProceeds: 720,
  });
  assert.ok(built, "expected a notification when sold-beforehand proceeds > 0");
  assert.equal(
    built!.title,
    "Mark Cuban: Up or Down? resolved — you'd sold beforehand",
  );
  assert.equal(
    built!.body,
    "You'd already sold those shares for Ꝟ720 (net +Ꝟ220).",
  );
});

test("won-but-fully-sold with pre-close proceeds below stake → signed-negative net", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Some Market",
    won: true,
    stake: 1_000,
    payout: 0,
    preResolveSellProceeds: 750,
  });
  assert.ok(built);
  assert.equal(built!.title, "Some Market resolved — you'd sold beforehand");
  assert.equal(
    built!.body,
    "You'd already sold those shares for Ꝟ750 (net \u2212Ꝟ250).",
  );
});

test("won-but-fully-sold with preResolveSellProceeds === 0 → suppressed", () => {
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
  const built = buildAmmResolutionNotification({
    marketTitle: "Plumb-through guard",
    won: true,
    stake: 100,
    payout: 207,
    preResolveSellProceeds: 999,
  });
  assert.ok(built);
  assert.equal(built!.title, "Plumb-through guard won +Ꝟ107");
});

test("won + payout === stake (parity buy) → stake returned title", () => {
  const built = buildAmmResolutionNotification({
    marketTitle: "Parity buy market",
    won: true,
    stake: 200,
    payout: 200,
  });
  assert.ok(built, "expected a notification, got null");
  assert.equal(built!.title, "Parity buy market — stake returned");
  assert.equal(built!.body, "Resolved. Payout Ꝟ200 (net Ꝟ0).");
});

test("won + payout=0 must NOT trigger stake-returned branch", () => {
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
  assert.equal(built.title, "Market voided — Ꝟ2,500 refunded");
  assert.equal(
    built.body,
    "Some Voided Market was voided. Ꝟ2,500 returned.",
  );
});
