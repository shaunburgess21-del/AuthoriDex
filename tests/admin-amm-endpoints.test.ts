/**
 * Phase 5 — AMM admin dashboard audit invariants.
 *
 * The five new admin endpoints in `server/routes.ts` are largely thin
 * SQL aggregations, so this suite focuses on the pure audit helpers
 * that decide whether the system is healthy. Each test seeds a tiny
 * in-memory "DB" of state and bet rows, then asserts that the four
 * invariant checks behave exactly as the route handler exposes them.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CREDITS_DRIFT_TOLERANCE,
  SHARE_DRIFT_TOLERANCE,
  type AmmStateRow,
  type BetAggRow,
  creditsDriftCheck,
  detectCreditsDrift,
  detectSettlementIssues,
  detectShareDrift,
  reconcileHouseLedger,
  reconciliationCheck,
  settlementIdempotencyCheck,
  shareDriftCheck,
  summariseOverallSeverity,
} from "../server/services/amm-audit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(opts: {
  id: string;
  status?: string;
  shareQuantities: Record<string, number>;
  totalUserCreditsIn: number;
  outcomeOrder?: string[];
}): AmmStateRow {
  return {
    marketId: opts.id,
    marketTitle: `Market ${opts.id}`,
    marketStatus: opts.status ?? "OPEN",
    shareQuantities: opts.shareQuantities,
    totalUserCreditsIn: opts.totalUserCreditsIn,
    outcomeOrder: opts.outcomeOrder ?? Object.keys(opts.shareQuantities),
  };
}

function bet(marketId: string, entryId: string, netShares: number, netStake: number): BetAggRow {
  return { marketId, entryId, netShares, netStake };
}

// ---------------------------------------------------------------------------
// CHECK 1 — share drift
// ---------------------------------------------------------------------------

test("share drift: returns empty when state matches bets exactly", () => {
  const states = [
    freshState({ id: "m1", shareQuantities: { a: 10, b: 5 }, totalUserCreditsIn: 80 }),
  ];
  const bets = [bet("m1", "a", 10, 60), bet("m1", "b", 5, 20)];
  assert.deepEqual(detectShareDrift(states, bets), []);
});

test("share drift: tolerates floating-point dust below SHARE_DRIFT_TOLERANCE", () => {
  const states = [
    freshState({
      id: "m1",
      shareQuantities: { a: 10 + SHARE_DRIFT_TOLERANCE / 2 },
      totalUserCreditsIn: 60,
    }),
  ];
  const bets = [bet("m1", "a", 10, 60)];
  assert.deepEqual(detectShareDrift(states, bets), []);
});

test("share drift: flags state−bets mismatch larger than tolerance", () => {
  const states = [freshState({ id: "m1", shareQuantities: { a: 10, b: 5 }, totalUserCreditsIn: 60 })];
  // Bets only show 8 shares on `a` — state has 10. Drift = +2.
  const bets = [bet("m1", "a", 8, 50), bet("m1", "b", 5, 10)];
  const out = detectShareDrift(states, bets);
  assert.equal(out.length, 1);
  assert.equal(out[0].marketId, "m1");
  assert.equal(out[0].entryId, "a");
  assert.equal(out[0].drift, 2);
  assert.equal(out[0].stateShares, 10);
  assert.equal(out[0].betShares, 8);
});

test("share drift: missing entry in bet aggregate is treated as 0 shares", () => {
  const states = [freshState({ id: "m1", shareQuantities: { a: 7, b: 0 }, totalUserCreditsIn: 30 })];
  const bets = [bet("m1", "a", 0, 0)]; // no entry b row at all
  const out = detectShareDrift(states, bets);
  assert.equal(out.length, 1);
  assert.equal(out[0].entryId, "a");
  assert.equal(out[0].drift, 7);
});

test("share drift: skips markets without an AMM state row", () => {
  const states: AmmStateRow[] = [
    {
      marketId: "ghost",
      marketTitle: "Ghost",
      marketStatus: "OPEN",
      shareQuantities: null,
      totalUserCreditsIn: null,
      outcomeOrder: null,
    },
  ];
  assert.deepEqual(detectShareDrift(states, []), []);
});

// ---------------------------------------------------------------------------
// CHECK 2 — credits drift
// ---------------------------------------------------------------------------

test("credits drift: returns empty when totalUserCreditsIn matches stake sum", () => {
  const states = [freshState({ id: "m1", shareQuantities: { a: 10 }, totalUserCreditsIn: 60 })];
  const bets = [bet("m1", "a", 10, 60)];
  assert.deepEqual(detectCreditsDrift(states, bets), []);
});

test("credits drift: tolerates sub-cent drift", () => {
  const states = [
    freshState({
      id: "m1",
      shareQuantities: { a: 10 },
      totalUserCreditsIn: 60 + CREDITS_DRIFT_TOLERANCE / 2,
    }),
  ];
  const bets = [bet("m1", "a", 10, 60)];
  assert.deepEqual(detectCreditsDrift(states, bets), []);
});

test("credits drift: sells (negative stake) net correctly with buys", () => {
  const states = [freshState({ id: "m1", shareQuantities: { a: 7 }, totalUserCreditsIn: 40 })];
  // Buy 10 shares for 60, then sell 3 shares for 20 → net stake 40, net shares 7.
  const bets = [bet("m1", "a", 7, 40)];
  assert.deepEqual(detectCreditsDrift(states, bets), []);
});

test("credits drift: flags mismatched markets", () => {
  const states = [
    freshState({ id: "m1", shareQuantities: { a: 5 }, totalUserCreditsIn: 100 }),
    freshState({ id: "m2", shareQuantities: { a: 5 }, totalUserCreditsIn: 50 }),
  ];
  const bets = [
    bet("m1", "a", 5, 30), // state says 100 in, bets say 30 → drift 70
    bet("m2", "a", 5, 50),
  ];
  const out = detectCreditsDrift(states, bets);
  assert.equal(out.length, 1);
  assert.equal(out[0].marketId, "m1");
  assert.equal(out[0].drift, 70);
});

// ---------------------------------------------------------------------------
// CHECK 3 — settlement idempotency
// ---------------------------------------------------------------------------

test("settlement idempotency: ignores OPEN/CLOSED_PENDING markets", () => {
  const states = [
    freshState({ id: "open", status: "OPEN", shareQuantities: { a: 0 }, totalUserCreditsIn: 0 }),
    freshState({ id: "pending", status: "CLOSED_PENDING", shareQuantities: { a: 0 }, totalUserCreditsIn: 0 }),
  ];
  assert.deepEqual(detectSettlementIssues(states, new Map()), []);
});

test("settlement idempotency: passes when each closed market has exactly one settle row", () => {
  const states = [
    freshState({ id: "r1", status: "RESOLVED", shareQuantities: { a: 0 }, totalUserCreditsIn: 0 }),
    freshState({ id: "v1", status: "VOID", shareQuantities: { a: 0 }, totalUserCreditsIn: 0 }),
  ];
  const ledger = new Map([
    ["amm_settle_r1", 1],
    ["amm_settle_v1", 1],
  ]);
  assert.deepEqual(detectSettlementIssues(states, ledger), []);
});

test("settlement idempotency: flags missing settle rows", () => {
  const states = [
    freshState({ id: "r1", status: "RESOLVED", shareQuantities: { a: 0 }, totalUserCreditsIn: 0 }),
  ];
  const out = detectSettlementIssues(states, new Map());
  assert.equal(out.length, 1);
  assert.equal(out[0].marketId, "r1");
  assert.equal(out[0].settleCreditCount, 0);
});

test("settlement idempotency: flags duplicate settle rows", () => {
  const states = [
    freshState({ id: "r1", status: "RESOLVED", shareQuantities: { a: 0 }, totalUserCreditsIn: 0 }),
  ];
  const ledger = new Map([["amm_settle_r1", 2]]);
  const out = detectSettlementIssues(states, ledger);
  assert.equal(out.length, 1);
  assert.equal(out[0].settleCreditCount, 2);
});

// ---------------------------------------------------------------------------
// CHECK 4 — house ledger reconciliation
// ---------------------------------------------------------------------------

test("reconciliation: ok when profile matches ledger exactly", () => {
  const r = reconcileHouseLedger(1_000_000_000, 1_000_000_000);
  assert.equal(r.ok, true);
  assert.equal(r.drift, 0);
});

test("reconciliation: ok at sub-credit drift", () => {
  const r = reconcileHouseLedger(100, 99.5);
  assert.equal(r.ok, true);
});

test("reconciliation: not ok when drift >= 1 credit", () => {
  const r = reconcileHouseLedger(100, 98);
  assert.equal(r.ok, false);
  assert.equal(r.drift, 2);
});

// ---------------------------------------------------------------------------
// Result wrappers
// ---------------------------------------------------------------------------

test("shareDriftCheck: ok severity when no rows", () => {
  const c = shareDriftCheck([]);
  assert.equal(c.severity, "ok");
  assert.equal(c.affected.length, 0);
});

test("shareDriftCheck: error severity with affected rows", () => {
  const c = shareDriftCheck([
    { marketId: "m1", marketTitle: "M1", entryId: "a", stateShares: 10, betShares: 8, drift: 2 },
  ]);
  assert.equal(c.severity, "error");
  assert.equal(c.affected.length, 1);
});

test("settlementIdempotencyCheck: reports closed market count in ok message", () => {
  const c = settlementIdempotencyCheck([], 5);
  assert.equal(c.severity, "ok");
  assert.match(c.message, /5 closed/);
});

test("reconciliationCheck: pulls profile + ledger into affected on failure", () => {
  const c = reconciliationCheck({ profileCredits: 100, ledgerSum: 90, drift: 10, ok: false });
  assert.equal(c.severity, "error");
  assert.equal(c.affected.length, 1);
  assert.equal((c.affected[0] as any).drift, 10);
});

test("summariseOverallSeverity: ok only when every check is ok", () => {
  assert.equal(
    summariseOverallSeverity([
      { check: "a", severity: "ok", message: "", affected: [] },
      { check: "b", severity: "ok", message: "", affected: [] },
    ]),
    "ok",
  );
  assert.equal(
    summariseOverallSeverity([
      { check: "a", severity: "ok", message: "", affected: [] },
      { check: "b", severity: "error", message: "", affected: [] },
    ]),
    "error",
  );
  assert.equal(
    summariseOverallSeverity([
      { check: "a", severity: "warn", message: "", affected: [] },
    ]),
    "warn",
  );
});

// ---------------------------------------------------------------------------
// End-to-end: a realistic AMM market lifecycle
// ---------------------------------------------------------------------------

test("end-to-end: open H2H market with two buys passes all four checks", () => {
  // State after Alice buys 10 shares on entry-a for 60c, Bob buys 5
  // shares on entry-b for 20c. Total credits in = 80, q = {a:10, b:5}.
  const states = [
    freshState({
      id: "h2h-1",
      shareQuantities: { "entry-a": 10, "entry-b": 5 },
      totalUserCreditsIn: 80,
    }),
  ];
  const bets = [
    bet("h2h-1", "entry-a", 10, 60),
    bet("h2h-1", "entry-b", 5, 20),
  ];

  const checks = [
    shareDriftCheck(detectShareDrift(states, bets)),
    creditsDriftCheck(detectCreditsDrift(states, bets)),
    settlementIdempotencyCheck(detectSettlementIssues(states, new Map()), 0),
    reconciliationCheck(reconcileHouseLedger(999_995_000, 999_995_000)),
  ];

  for (const c of checks) {
    assert.equal(c.severity, "ok", `${c.check}: ${c.message}`);
  }
  assert.equal(summariseOverallSeverity(checks), "ok");
});

test("end-to-end: a market with a missing settle row after resolution flags exactly one error", () => {
  const states = [
    freshState({
      id: "h2h-1",
      status: "RESOLVED",
      shareQuantities: { "entry-a": 10, "entry-b": 5 },
      totalUserCreditsIn: 80,
    }),
  ];
  const bets = [
    bet("h2h-1", "entry-a", 10, 60),
    bet("h2h-1", "entry-b", 5, 20),
  ];

  // Settle ledger row is missing — only check 3 should fail.
  const checks = [
    shareDriftCheck(detectShareDrift(states, bets)),
    creditsDriftCheck(detectCreditsDrift(states, bets)),
    settlementIdempotencyCheck(detectSettlementIssues(states, new Map()), 1),
    reconciliationCheck(reconcileHouseLedger(100, 100)),
  ];

  assert.equal(checks[0].severity, "ok");
  assert.equal(checks[1].severity, "ok");
  assert.equal(checks[2].severity, "error");
  assert.equal(checks[3].severity, "ok");
  assert.equal(summariseOverallSeverity(checks), "error");
});
