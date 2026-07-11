import test from "node:test";
import assert from "node:assert/strict";

import {
  checkBuySlippage,
  checkSellSlippage,
} from "../server/services/amm-slippage";

// ---------------------------------------------------------------------------
// Buy direction
// ---------------------------------------------------------------------------

test("checkBuySlippage: no cap supplied -> ok regardless of fill", () => {
  const r = checkBuySlippage({ creditsSpent: 100, sharesOut: 200, cap: null });
  assert.equal(r.ok, true);
  assert.equal(r.avgPrice, 0.5);
});

test("checkBuySlippage: undefined cap -> ok", () => {
  const r = checkBuySlippage({ creditsSpent: 100, sharesOut: 200, cap: undefined });
  assert.equal(r.ok, true);
});

test("checkBuySlippage: avg price BELOW cap -> ok", () => {
  // Paid 100 for 200 shares = 0.50 avg. Cap was 0.60 -> within tolerance.
  const r = checkBuySlippage({ creditsSpent: 100, sharesOut: 200, cap: 0.6 });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.avgPrice, 0.5);
});

test("checkBuySlippage: avg price EXACTLY AT cap -> ok (inclusive <=)", () => {
  const r = checkBuySlippage({ creditsSpent: 100, sharesOut: 200, cap: 0.5 });
  assert.equal(r.ok, true);
});

test("checkBuySlippage: avg price ABOVE cap -> fail with actual avg + cap echoed", () => {
  // Paid 140 for 200 shares = 0.70 avg. Cap was 0.50 -> slipped.
  const r = checkBuySlippage({ creditsSpent: 140, sharesOut: 200, cap: 0.5 });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.avgPrice, 0.7);
    assert.equal(r.capOrFloor, 0.5);
  }
});

test("checkBuySlippage: zero sharesOut -> ok with avgPrice 0 (div-by-zero defence)", () => {
  const r = checkBuySlippage({ creditsSpent: 100, sharesOut: 0, cap: 0.5 });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.avgPrice, 0);
});

test("checkBuySlippage: negative cap is ignored (Zod is authoritative; helper defends)", () => {
  const r = checkBuySlippage({ creditsSpent: 100, sharesOut: 200, cap: -0.1 });
  assert.equal(r.ok, true);
});

test("checkBuySlippage: quoted-avg cap allows fill that marginal cap rejected (add-to-position)", () => {
  // Matt Rife scenario: marginal 0.195, quoted avg fill 0.208, stake ~100 Vox.
  const quotedAvg = 0.208;
  const sharesOut = 100 / quotedAvg;
  const oldMarginalCap = Math.min(1, 0.195 * 1.05);
  const newQuotedCap = Math.min(1, quotedAvg * 1.05);

  const oldGuard = checkBuySlippage({
    creditsSpent: 100,
    sharesOut,
    cap: oldMarginalCap,
  });
  const newGuard = checkBuySlippage({
    creditsSpent: 100,
    sharesOut,
    cap: newQuotedCap,
  });

  assert.equal(oldGuard.ok, false, "marginal-spot cap falsely rejects same-state quote");
  assert.equal(newGuard.ok, true, "quoted-avg cap accepts same-state quote");
});

test("checkBuySlippage: NaN cap is ignored", () => {
  const r = checkBuySlippage({ creditsSpent: 100, sharesOut: 200, cap: Number.NaN });
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------------------
// Sell direction
// ---------------------------------------------------------------------------

test("checkSellSlippage: no floor supplied -> ok regardless of fill", () => {
  const r = checkSellSlippage({ creditsReceived: 50, sharesIn: 100, floor: null });
  assert.equal(r.ok, true);
  assert.equal(r.avgPrice, 0.5);
});

test("checkSellSlippage: avg price ABOVE floor -> ok", () => {
  // Received 60 for 100 shares = 0.60 avg. Floor was 0.50 -> better than floor.
  const r = checkSellSlippage({ creditsReceived: 60, sharesIn: 100, floor: 0.5 });
  assert.equal(r.ok, true);
});

test("checkSellSlippage: avg price EXACTLY AT floor -> ok (inclusive >=)", () => {
  const r = checkSellSlippage({ creditsReceived: 50, sharesIn: 100, floor: 0.5 });
  assert.equal(r.ok, true);
});

test("checkSellSlippage: avg price BELOW floor -> fail with actual avg + floor echoed", () => {
  // Received 30 for 100 shares = 0.30 avg. Floor was 0.50 -> slipped (got less than expected).
  const r = checkSellSlippage({ creditsReceived: 30, sharesIn: 100, floor: 0.5 });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.avgPrice, 0.3);
    assert.equal(r.capOrFloor, 0.5);
  }
});

test("checkSellSlippage: zero sharesIn -> ok with avgPrice 0", () => {
  const r = checkSellSlippage({ creditsReceived: 100, sharesIn: 0, floor: 0.5 });
  assert.equal(r.ok, true);
});

test("checkSellSlippage: zero floor is treated as 'no floor' (no-op opt-in)", () => {
  const r = checkSellSlippage({ creditsReceived: 0, sharesIn: 100, floor: 0 });
  assert.equal(r.ok, true);
});

test("checkSellSlippage: quoted-avg floor allows fill that marginal floor rejected (cash-out)", () => {
  // Mirror of the buy-side Matt Rife case. LMSR sell avg fill sits BELOW
  // marginal spot (convexity). A floor of marginal × 0.95 can sit above
  // the quoted avg fill and falsely reject a same-state cash-out.
  // Example: marginal 0.50, quoted avg fill 0.45, sell 100 shares.
  const quotedAvg = 0.45;
  const marginal = 0.5;
  const sharesIn = 100;
  const creditsReceived = quotedAvg * sharesIn;
  const oldMarginalFloor = Math.max(1e-6, marginal * 0.95);
  const newQuotedFloor = Math.max(1e-6, quotedAvg * 0.95);

  const oldGuard = checkSellSlippage({
    creditsReceived,
    sharesIn,
    floor: oldMarginalFloor,
  });
  const newGuard = checkSellSlippage({
    creditsReceived,
    sharesIn,
    floor: newQuotedFloor,
  });

  assert.equal(oldGuard.ok, false, "marginal-spot floor falsely rejects same-state quote");
  assert.equal(newGuard.ok, true, "quoted-avg floor accepts same-state quote");
});
