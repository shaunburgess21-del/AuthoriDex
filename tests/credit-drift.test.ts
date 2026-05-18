/**
 * Unit tests for `computeDriftDelta` — the pure helper behind the
 * admin "Reconcile drift" action.
 *
 * Pins the sign convention: `delta = wallet - ledgerSum`, with truncation
 * so we never emit a fractional ledger amount even if the inputs ever
 * carry decimals from a numeric DB column.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { computeDriftDelta } from "../server/services/credit-drift";

test("drift delta: zero when wallet matches ledger sum exactly", () => {
  assert.equal(computeDriftDelta({ wallet: 10_000, ledgerSum: 10_000 }), 0);
});

test("drift delta: positive when wallet > ledgerSum (user 'richer than audit')", () => {
  assert.equal(
    computeDriftDelta({ wallet: 10_000, ledgerSum: 4_246 }),
    5_754,
  );
});

test("drift delta: negative when wallet < ledgerSum (user 'poorer than audit')", () => {
  assert.equal(
    computeDriftDelta({ wallet: 10_033, ledgerSum: 24_069 }),
    -14_036,
  );
});

test("drift delta: handles negative wallets (defense in depth — shouldn't occur in prod)", () => {
  assert.equal(computeDriftDelta({ wallet: -50, ledgerSum: -100 }), 50);
});

test("drift delta: truncates fractional inputs toward zero", () => {
  // numeric DB columns can theoretically arrive as floats; we always
  // want an integer ledger amount.
  assert.equal(computeDriftDelta({ wallet: 100.7, ledgerSum: 50.4 }), 50);
});

test("drift delta: throws on NaN wallet", () => {
  assert.throws(
    () => computeDriftDelta({ wallet: Number.NaN, ledgerSum: 100 }),
    /wallet must be finite/,
  );
});

test("drift delta: throws on infinite ledger sum", () => {
  assert.throws(
    () => computeDriftDelta({ wallet: 100, ledgerSum: Number.POSITIVE_INFINITY }),
    /ledgerSum must be finite/,
  );
});
