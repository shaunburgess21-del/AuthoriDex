/**
 * Unit tests for the daily LLM budget cap in
 * `server/agents/worldMarketBudget.ts`.
 *
 * The module is intentionally zero-DB so these tests run as a pure
 * library — no `DATABASE_URL` workaround needed. We do, however, set
 * env vars BEFORE importing the module so the cap and per-call
 * estimate land at known values.
 */
import test from "node:test";
import assert from "node:assert/strict";

// Set test-friendly defaults BEFORE the import so the module-load env
// reads pick them up. The test bodies then call `_resetBudgetForTesting`
// when they need a fresh starting state.
process.env.WORLD_MARKETS_DAILY_BUDGET_USD = "5.00";
process.env.WORLD_MARKETS_PER_CALL_ESTIMATE_USD = "0.40";

const {
  tryReserveLlmCall,
  getBudgetSnapshot,
  getCapUsd,
  getDefaultPerCallEstimateUsd,
  _resetBudgetForTesting,
  _overrideClockForTesting,
} = await import("../server/agents/worldMarketBudget");

// ---------------------------------------------------------------------------
// Log capture helper — the module logs via `console.log`. Tests assert
// that certain log lines fire (or don't), so we wrap each test in a
// helper that captures console.log output for the duration.
// ---------------------------------------------------------------------------
function withCapturedLogs<T>(fn: () => T): { result: T; logs: string[] } {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  try {
    const result = fn();
    return { result, logs };
  } finally {
    console.log = original;
  }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

test("budget: initial state shows zero spend, full cap available", () => {
  _resetBudgetForTesting();
  const snap = getBudgetSnapshot();
  assert.equal(snap.spendUsd, 0);
  assert.equal(snap.callsReserved, 0);
  assert.equal(snap.callsReleased, 0);
  assert.equal(snap.callsBlocked, 0);
  assert.equal(snap.capUsd, 5.0);
  assert.equal(snap.remainingUsd, 5.0);
  assert.equal(snap.exhausted, false);
});

test("budget: env defaults are reflected in getCapUsd / getDefaultPerCallEstimateUsd", () => {
  _resetBudgetForTesting();
  assert.equal(getCapUsd(), 5.0);
  assert.equal(getDefaultPerCallEstimateUsd(), 0.4);
});

// ---------------------------------------------------------------------------
// Reservation accumulation
// ---------------------------------------------------------------------------

test("budget: single reservation increments spend and counter", () => {
  _resetBudgetForTesting();
  const r = tryReserveLlmCall(0.4);
  assert.equal(r.allowed, true);
  const snap = getBudgetSnapshot();
  assert.equal(snap.spendUsd, 0.4);
  assert.equal(snap.callsReserved, 1);
  assert.equal(snap.callsReleased, 0);
  assert.equal(snap.remainingUsd, 4.6);
});

test("budget: ten reservations at $0.40 accumulate to $4.00", () => {
  _resetBudgetForTesting();
  for (let i = 0; i < 10; i++) {
    const r = tryReserveLlmCall(0.4);
    assert.equal(r.allowed, true, `reservation ${i} should succeed`);
  }
  const snap = getBudgetSnapshot();
  assert.ok(Math.abs(snap.spendUsd - 4.0) < 1e-9, `spend=${snap.spendUsd}`);
  assert.equal(snap.callsReserved, 10);
});

test("budget: omitting cost uses the default estimate", () => {
  _resetBudgetForTesting();
  tryReserveLlmCall(); // no arg
  const snap = getBudgetSnapshot();
  assert.equal(snap.spendUsd, 0.4);
});

test("budget: negative / NaN / zero cost falls back to default estimate", () => {
  _resetBudgetForTesting();
  tryReserveLlmCall(-1);
  tryReserveLlmCall(NaN);
  tryReserveLlmCall(0);
  const snap = getBudgetSnapshot();
  // 3 reservations at default 0.40 = 1.20
  assert.ok(Math.abs(snap.spendUsd - 1.2) < 1e-9);
});

// ---------------------------------------------------------------------------
// Cap-blocking
// ---------------------------------------------------------------------------

test("budget: cap blocks the FIRST reservation that would breach", () => {
  _resetBudgetForTesting();
  // Reserve 12 × 0.40 = $4.80 (still under $5.00). The 13th would push
  // to $5.20 which exceeds the $5.00 cap → must be refused.
  for (let i = 0; i < 12; i++) {
    const r = tryReserveLlmCall(0.4);
    assert.equal(r.allowed, true, `reservation ${i} should succeed`);
  }
  const blocked = tryReserveLlmCall(0.4);
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) {
    assert.equal(blocked.reason, "cap_exhausted");
    assert.equal(blocked.snapshot.callsBlocked, 1);
    assert.equal(blocked.snapshot.callsReserved, 12);
    assert.ok(blocked.snapshot.spendUsd <= 5.0);
  }
});

test("budget: exactly-at-cap reservation succeeds (strict <= semantics)", () => {
  _resetBudgetForTesting();
  // A single reservation of exactly $5.00 brings spendUsd to $5.00 which
  // is NOT > cap. So the reservation succeeds, but the cap is now
  // hit and the NEXT call (at any cost > 0) will fail.
  const r1 = tryReserveLlmCall(5.0);
  assert.equal(r1.allowed, true);
  assert.equal(getBudgetSnapshot().spendUsd, 5.0);

  const r2 = tryReserveLlmCall(0.01);
  assert.equal(r2.allowed, false);
});

test("budget: oversized single reservation is refused", () => {
  _resetBudgetForTesting();
  // One call estimated at $6 exceeds the $5 cap by itself.
  const r = tryReserveLlmCall(6.0);
  assert.equal(r.allowed, false);
  const snap = getBudgetSnapshot();
  assert.equal(snap.spendUsd, 0);
  assert.equal(snap.callsReserved, 0);
  assert.equal(snap.callsBlocked, 1);
});

// ---------------------------------------------------------------------------
// Release / commit semantics
// ---------------------------------------------------------------------------

test("budget: release() refunds the reservation", () => {
  _resetBudgetForTesting();
  const r = tryReserveLlmCall(0.4);
  assert.equal(r.allowed, true);
  if (!r.allowed) return;
  assert.equal(getBudgetSnapshot().spendUsd, 0.4);

  r.release();
  const snap = getBudgetSnapshot();
  assert.equal(snap.spendUsd, 0);
  assert.equal(snap.callsReleased, 1);
  // callsReserved stays — it counts total reservations made, not net
  assert.equal(snap.callsReserved, 1);
});

test("budget: commit() is a no-op (counter unchanged from post-reserve)", () => {
  _resetBudgetForTesting();
  const r = tryReserveLlmCall(0.4);
  assert.equal(r.allowed, true);
  if (!r.allowed) return;

  const before = getBudgetSnapshot();
  r.commit();
  const after = getBudgetSnapshot();
  assert.equal(after.spendUsd, before.spendUsd);
  assert.equal(after.callsReserved, before.callsReserved);
  assert.equal(after.callsReleased, before.callsReleased);
});

test("budget: double-release is a silent no-op (counter doesn't go negative)", () => {
  _resetBudgetForTesting();
  const r = tryReserveLlmCall(0.4);
  assert.equal(r.allowed, true);
  if (!r.allowed) return;

  r.release();
  r.release(); // second call must NOT refund a second time
  const snap = getBudgetSnapshot();
  assert.equal(snap.spendUsd, 0);
  assert.equal(snap.callsReleased, 1, "callsReleased should only count the first release");
});

test("budget: release-after-commit is a silent no-op", () => {
  _resetBudgetForTesting();
  const r = tryReserveLlmCall(0.4);
  assert.equal(r.allowed, true);
  if (!r.allowed) return;

  r.commit();
  r.release(); // late release after commit must NOT refund
  const snap = getBudgetSnapshot();
  assert.equal(snap.spendUsd, 0.4, "spendUsd stays committed; release after commit is ignored");
  assert.equal(snap.callsReleased, 0);
});

// ---------------------------------------------------------------------------
// Day rollover
// ---------------------------------------------------------------------------

test("budget: day rollover resets state and logs summary", () => {
  _resetBudgetForTesting();
  // Pin clock to Day 1
  const day1 = new Date("2026-05-19T12:00:00Z");
  _overrideClockForTesting(() => day1);
  _resetBudgetForTesting(); // re-read date with pinned clock

  tryReserveLlmCall(0.4);
  tryReserveLlmCall(0.4);
  // Try to overspend so we get a `callsBlocked` count too
  const oversize = tryReserveLlmCall(10);
  assert.equal(oversize.allowed, false);

  // Advance to next UTC day. The next reserve should trigger rollover.
  const day2 = new Date("2026-05-20T01:00:00Z");
  _overrideClockForTesting(() => day2);

  const { logs } = withCapturedLogs(() => tryReserveLlmCall(0.4));

  const rolloverLog = logs.find((l) => l.includes("Day rolled over"));
  assert.ok(rolloverLog, `expected rollover log, got: ${logs.join(" | ")}`);
  assert.ok(rolloverLog!.includes("2026-05-19=$0.80"));
  assert.ok(rolloverLog!.includes("2 successful calls"));
  assert.ok(rolloverLog!.includes("1 blocked"));

  // After rollover, state is fresh for Day 2 + the just-made reservation.
  const snap = getBudgetSnapshot();
  assert.equal(snap.dateUtc, "2026-05-20");
  assert.equal(snap.spendUsd, 0.4); // the post-rollover reserve landed
  assert.equal(snap.callsReserved, 1);
  assert.equal(snap.callsBlocked, 0);

  _overrideClockForTesting(null);
});

test("budget: same-day reservations DON'T trigger rollover log", () => {
  _resetBudgetForTesting();
  const fixed = new Date("2026-05-19T12:00:00Z");
  _overrideClockForTesting(() => fixed);
  _resetBudgetForTesting();

  const { logs } = withCapturedLogs(() => {
    tryReserveLlmCall(0.4);
    tryReserveLlmCall(0.4);
    tryReserveLlmCall(0.4);
  });
  const rolloverLog = logs.find((l) => l.includes("Day rolled over"));
  assert.equal(rolloverLog, undefined);

  _overrideClockForTesting(null);
});

// ---------------------------------------------------------------------------
// Cap-exhaustion log fires once per day
// ---------------------------------------------------------------------------

test("budget: first block of the day logs; subsequent blocks are silent", () => {
  _resetBudgetForTesting();
  // Fill the cap
  for (let i = 0; i < 12; i++) tryReserveLlmCall(0.4); // 12 × 0.40 = 4.80

  // Now any further reservation at 0.40 will breach (4.80 + 0.40 = 5.20 > 5.00)
  const captured1 = withCapturedLogs(() => tryReserveLlmCall(0.4));
  const exhaustionLog = captured1.logs.find((l) => l.includes("cap exhausted"));
  assert.ok(exhaustionLog, `expected first-block log, got: ${captured1.logs.join(" | ")}`);

  // Second block on the same day — must be silent
  const captured2 = withCapturedLogs(() => tryReserveLlmCall(0.4));
  const repeatLog = captured2.logs.find((l) => l.includes("cap exhausted"));
  assert.equal(repeatLog, undefined, "second block should not re-log");
});

test("budget: cap-exhaustion log fires again after rollover", () => {
  _resetBudgetForTesting();
  const day1 = new Date("2026-05-19T12:00:00Z");
  _overrideClockForTesting(() => day1);
  _resetBudgetForTesting();

  for (let i = 0; i < 12; i++) tryReserveLlmCall(0.4);

  // First block on day 1 — logs
  const captured1 = withCapturedLogs(() => tryReserveLlmCall(0.4));
  assert.ok(captured1.logs.some((l) => l.includes("cap exhausted")));

  // Roll to day 2 + retry the cap-exhaustion path
  const day2 = new Date("2026-05-20T12:00:00Z");
  _overrideClockForTesting(() => day2);

  // Fresh day = fresh state. Refill to cap and try to block again.
  for (let i = 0; i < 12; i++) tryReserveLlmCall(0.4);
  const captured2 = withCapturedLogs(() => tryReserveLlmCall(0.4));
  const day2ExhaustionLog = captured2.logs.find((l) => l.includes("cap exhausted"));
  assert.ok(day2ExhaustionLog, "exhaustion log should re-fire after rollover");

  _overrideClockForTesting(null);
});

// ---------------------------------------------------------------------------
// Env override
// ---------------------------------------------------------------------------

test("budget: env vars are re-read on _resetBudgetForTesting", () => {
  _resetBudgetForTesting();
  assert.equal(getCapUsd(), 5.0);

  process.env.WORLD_MARKETS_DAILY_BUDGET_USD = "2.00";
  _resetBudgetForTesting();
  assert.equal(getCapUsd(), 2.0);

  // A reservation that would have been fine at $5 cap is blocked at $2
  for (let i = 0; i < 5; i++) tryReserveLlmCall(0.4); // 5 × 0.40 = 2.00 = cap
  const blocked = tryReserveLlmCall(0.4); // 2.00 + 0.40 > 2.00
  assert.equal(blocked.allowed, false);

  // Restore for downstream tests
  process.env.WORLD_MARKETS_DAILY_BUDGET_USD = "5.00";
  _resetBudgetForTesting();
});

test("budget: invalid env values fall back to defaults", () => {
  process.env.WORLD_MARKETS_DAILY_BUDGET_USD = "not a number";
  _resetBudgetForTesting();
  assert.equal(getCapUsd(), 5.0);

  process.env.WORLD_MARKETS_DAILY_BUDGET_USD = "-3";
  _resetBudgetForTesting();
  assert.equal(getCapUsd(), 5.0, "negative cap should fall back to default");

  process.env.WORLD_MARKETS_DAILY_BUDGET_USD = "0";
  _resetBudgetForTesting();
  assert.equal(getCapUsd(), 5.0, "zero cap should fall back to default");

  // Restore
  process.env.WORLD_MARKETS_DAILY_BUDGET_USD = "5.00";
  _resetBudgetForTesting();
});
