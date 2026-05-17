import test from "node:test";
import assert from "node:assert/strict";
import {
  AMM_PRE_RESOLVE_COOLDOWN_MS,
  deriveNativeMarketLifecycle,
  getWeeklyBettingCutoff,
} from "../server/native-markets/lifecycle";
import { getWeekContext } from "../server/native-markets/week-context";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const { decideMissingMarketTypes } = await import("../server/jobs/market-generator");

test("getWeeklyBettingCutoff sets Friday 23:59:59.999 UTC for Sunday close", () => {
  const sundayEnd = new Date("2026-04-05T23:59:59.999Z");
  const cutoff = getWeeklyBettingCutoff(sundayEnd);
  assert.equal(cutoff.toISOString(), "2026-04-03T23:59:59.999Z");
});

test("getWeekContext returns Monday 00:00 UTC and Sunday 23:59:59.999 UTC", () => {
  const now = new Date("2026-03-30T12:34:56.000Z"); // Monday
  const { monday, sunday } = getWeekContext(now);
  assert.equal(monday.toISOString(), "2026-03-30T00:00:00.000Z");
  assert.equal(sunday.toISOString(), "2026-04-05T23:59:59.999Z");
});

test("getWeekContext handles Sunday by returning current week's Monday", () => {
  const now = new Date("2026-03-29T18:00:00.000Z"); // Sunday
  const { monday, sunday } = getWeekContext(now);
  assert.equal(monday.toISOString(), "2026-03-23T00:00:00.000Z");
  assert.equal(sunday.toISOString(), "2026-03-29T23:59:59.999Z");
});

test("deriveNativeMarketLifecycle (parimutuel/jackpot) transitions OPEN -> ENTRIES_CLOSED -> RESOLVED", () => {
  const endAt = new Date("2026-04-05T23:59:59.999Z");

  const openState = deriveNativeMarketLifecycle(
    endAt,
    new Date("2026-04-03T20:00:00.000Z"),
    "parimutuel",
  );
  assert.equal(openState.status, "OPEN");
  assert.equal(openState.isCutoffPassed, false);

  const closedState = deriveNativeMarketLifecycle(
    endAt,
    new Date("2026-04-04T12:00:00.000Z"),
    "parimutuel",
  );
  assert.equal(closedState.status, "ENTRIES_CLOSED");
  assert.equal(closedState.isCutoffPassed, true);

  const resolvedState = deriveNativeMarketLifecycle(
    endAt,
    new Date("2026-04-06T00:00:00.000Z"),
    "parimutuel",
  );
  assert.equal(resolvedState.status, "RESOLVED");
  assert.equal(resolvedState.isCutoffPassed, true);
});

test("deriveNativeMarketLifecycle (amm default) transitions OPEN -> ENTRIES_CLOSED -> RESOLVED", () => {
  // AMM trading cutoff is endAt - admin cooldown (default 5 min).
  // Long before endAt the market is OPEN; inside the cooldown band the
  // market is ENTRIES_CLOSED; past endAt it is RESOLVED.
  const endAt = new Date("2026-04-05T23:59:59.999Z");

  const saturdayNoon = deriveNativeMarketLifecycle(
    endAt,
    new Date("2026-04-04T12:00:00.000Z"),
  );
  assert.equal(saturdayNoon.status, "OPEN");
  assert.equal(saturdayNoon.isCutoffPassed, false);

  // Pick a time inside the cooldown band: endAt - (cooldown / 2).
  // Works regardless of the admin-tunable cooldown value.
  const insideCooldown = new Date(endAt.getTime() - AMM_PRE_RESOLVE_COOLDOWN_MS / 2);
  const closedState = deriveNativeMarketLifecycle(endAt, insideCooldown);
  assert.equal(closedState.status, "ENTRIES_CLOSED");
  assert.equal(closedState.isCutoffPassed, true);

  const resolvedState = deriveNativeMarketLifecycle(
    endAt,
    new Date("2026-04-06T00:00:00.000Z"),
  );
  assert.equal(resolvedState.status, "RESOLVED");
  assert.equal(resolvedState.isCutoffPassed, true);
});

// ---------------------------------------------------------------------------
// decideMissingMarketTypes (Phase A4)
// ---------------------------------------------------------------------------
//
// Pre-A4 bug: ensureWeeklyMarketsForCurrentWeek early-returned the
// moment ANY native market was open for the week, so a partial-week
// failure (e.g. UpDown succeeded, H2H generator threw) was never
// repaired by the Monday in-process tick or the read-path self-heal.
// The new per-type decision helper is what lets the ensure path back-
// fill ONLY the missing product(s); these tests pin its behaviour.

test("decideMissingMarketTypes returns nothing when every type has an open market", () => {
  const counts = { updown: 1, h2h: 1, gainer: 1, jackpot: 1 };
  assert.deepEqual(decideMissingMarketTypes(counts), []);
});

test("decideMissingMarketTypes returns all four when none are open (fresh week)", () => {
  const counts = { updown: 0, h2h: 0, gainer: 0, jackpot: 0 };
  assert.deepEqual(decideMissingMarketTypes(counts), ["updown", "h2h", "gainer", "jackpot"]);
});

test("decideMissingMarketTypes returns only the missing types (partial-week backfill)", () => {
  // The exact failure mode A4 is meant to fix: UpDown succeeded but
  // H2H + gainer failed. Pre-A4 the ensure tick saw `openBefore = 1`
  // and short-circuited; now it must return the two missing types.
  const counts = { updown: 5, h2h: 0, gainer: 0, jackpot: 1 };
  assert.deepEqual(decideMissingMarketTypes(counts), ["h2h", "gainer"]);
});

test("decideMissingMarketTypes preserves stable order (updown, h2h, gainer, jackpot)", () => {
  // Order matters because the ensure helper iterates and runs
  // generators in this exact order — pinning it here means a future
  // refactor of the helper can't quietly reorder generation (e.g.
  // running jackpot before H2H, which would matter if a generator
  // depends on the people pool churned by an earlier one).
  const counts = { updown: 0, h2h: 0, gainer: 0, jackpot: 0 };
  assert.deepEqual(decideMissingMarketTypes(counts), ["updown", "h2h", "gainer", "jackpot"]);
});

test("decideMissingMarketTypes only flags zero-count types — counts > 0 are 'open enough'", () => {
  // Fresh week always has count=1 per type. Higher counts (multiple
  // open H2H matchups in the same week) are still 'open enough' from
  // the ensure helper's perspective.
  const counts = { updown: 4, h2h: 12, gainer: 2, jackpot: 1 };
  assert.deepEqual(decideMissingMarketTypes(counts), []);
});
