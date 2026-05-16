import test from "node:test";
import assert from "node:assert/strict";
import {
  AMM_PRE_RESOLVE_COOLDOWN_MS,
  deriveNativeMarketLifecycle,
  getWeeklyBettingCutoff,
} from "../server/native-markets/lifecycle";
import { getWeekContext } from "../server/native-markets/week-context";

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
