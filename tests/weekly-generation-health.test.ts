/**
 * Weekly native generation shortfall detection.
 *
 * The point of these tests is the partial-week case: the alert this replaced
 * only fired when a week produced zero markets across all four types, which
 * production never reaches. A type at 12 of 20 must now be caught.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ANCHORED_FIELD_SIZE } from "../shared/constants";
import {
  NATIVE_WEEKLY_MARKET_TYPES,
  buildWeeklyExpectations,
  buildShortfallIdempotencyKey,
  checkWeeklyGenerationHealth,
  describeShortfall,
  detectWeeklyShortfalls,
  type WeeklyTypeCounts,
} from "../server/jobs/weekly-generation-health";

/** A week matching production weeks 24-33: 20 / 20 / 9 / 20. */
function healthyWeek(): WeeklyTypeCounts {
  return { updown: 20, h2h: 20, gainer: 9, jackpot: 20 };
}

const TRAILING = { h2h: 20, gainer: 9 };

test("the anchored field size drives Up/Down and Jackpot, not a magic number", () => {
  const e = buildWeeklyExpectations(TRAILING);
  assert.equal(e.updown.expected, ANCHORED_FIELD_SIZE);
  assert.equal(e.jackpot.expected, ANCHORED_FIELD_SIZE);
  assert.equal(e.updown.basis, "field-size");
  assert.equal(e.jackpot.basis, "field-size");
});

test("per-category types calibrate off the trailing max", () => {
  const e = buildWeeklyExpectations(TRAILING);
  assert.equal(e.h2h.expected, 20);
  assert.equal(e.gainer.expected, 9);
  assert.equal(e.h2h.basis, "trailing-max");
  assert.equal(e.gainer.basis, "trailing-max");
});

test("a healthy production week is silent", () => {
  const shortfalls = detectWeeklyShortfalls(
    healthyWeek(),
    buildWeeklyExpectations(TRAILING),
  );
  assert.deepEqual(shortfalls, []);
});

test("the partial week the old alert missed is now caught", () => {
  // 12 of 20 Up/Down: the old `openCount === 0` guard saw 61 total markets
  // and said nothing.
  const counts = { ...healthyWeek(), updown: 12 };
  const shortfalls = detectWeeklyShortfalls(counts, buildWeeklyExpectations(TRAILING));

  assert.equal(shortfalls.length, 1);
  assert.equal(shortfalls[0]!.marketType, "updown");
  assert.equal(shortfalls[0]!.actual, 12);
  assert.equal(shortfalls[0]!.expected, 20);
  assert.equal(shortfalls[0]!.missing, 8);
  assert.equal(shortfalls[0]!.severity, "warning");
});

test("a single missing market is still a shortfall", () => {
  const shortfalls = detectWeeklyShortfalls(
    { ...healthyWeek(), gainer: 8 },
    buildWeeklyExpectations(TRAILING),
  );
  assert.equal(shortfalls.length, 1);
  assert.equal(shortfalls[0]!.marketType, "gainer");
  assert.equal(shortfalls[0]!.missing, 1);
});

test("a type at zero escalates to critical", () => {
  const shortfalls = detectWeeklyShortfalls(
    { ...healthyWeek(), h2h: 0 },
    buildWeeklyExpectations(TRAILING),
  );
  assert.equal(shortfalls.length, 1);
  assert.equal(shortfalls[0]!.severity, "critical");
});

test("overshooting the expectation is never a shortfall", () => {
  // A new category would legitimately push H2H above the trailing max.
  const shortfalls = detectWeeklyShortfalls(
    { updown: 20, h2h: 22, gainer: 10, jackpot: 20 },
    buildWeeklyExpectations(TRAILING),
  );
  assert.deepEqual(shortfalls, []);
});

test("criticals sort ahead of warnings, then by size of the gap", () => {
  const shortfalls = detectWeeklyShortfalls(
    { updown: 19, h2h: 0, gainer: 4, jackpot: 20 },
    buildWeeklyExpectations(TRAILING),
  );
  assert.deepEqual(
    shortfalls.map((s) => s.marketType),
    ["h2h", "gainer", "updown"],
  );
  assert.equal(shortfalls[0]!.severity, "critical");
  assert.equal(shortfalls[1]!.missing, 5);
  assert.equal(shortfalls[2]!.missing, 1);
});

test("a cold database cannot judge per-category shortfalls, only zeroes", () => {
  const e = buildWeeklyExpectations({});
  assert.equal(e.h2h.basis, "unknown");
  assert.equal(e.gainer.basis, "unknown");

  // A plausible-looking H2H count with no baseline must not alert...
  const quiet = detectWeeklyShortfalls({ updown: 20, h2h: 14, gainer: 7, jackpot: 20 }, e);
  assert.deepEqual(quiet, []);

  // ...but zero still does, because that is broken under any baseline.
  const loud = detectWeeklyShortfalls({ updown: 20, h2h: 0, gainer: 0, jackpot: 20 }, e);
  assert.deepEqual(
    loud.map((s) => s.marketType),
    ["h2h", "gainer"],
  );
  assert.ok(loud.every((s) => s.severity === "critical"));
});

test("trailing MAX not average — one bad week cannot ratchet the bar down", () => {
  // Weeks of 20,20,20 then a broken 5. Max keeps expecting 20; a mean would
  // have dropped to ~16 and gone quiet on the next 18-market week.
  const e = buildWeeklyExpectations({ h2h: 20, gainer: 9 });
  const shortfalls = detectWeeklyShortfalls({ ...healthyWeek(), h2h: 18 }, e);
  assert.equal(shortfalls.length, 1);
  assert.equal(shortfalls[0]!.expected, 20);
});

test("a totally failed week reports every type as critical", () => {
  const shortfalls = detectWeeklyShortfalls(
    { updown: 0, h2h: 0, gainer: 0, jackpot: 0 },
    buildWeeklyExpectations(TRAILING),
  );
  assert.equal(shortfalls.length, NATIVE_WEEKLY_MARKET_TYPES.length);
  assert.ok(shortfalls.every((s) => s.severity === "critical"));
});

test("missing counts default to zero rather than throwing", () => {
  const shortfalls = detectWeeklyShortfalls(
    {} as WeeklyTypeCounts,
    buildWeeklyExpectations(TRAILING),
  );
  assert.equal(shortfalls.length, 4);
});

test("idempotency key is stable per week and set of short types", () => {
  const a = detectWeeklyShortfalls({ ...healthyWeek(), updown: 1, gainer: 1 }, buildWeeklyExpectations(TRAILING));
  const b = detectWeeklyShortfalls({ ...healthyWeek(), gainer: 1, updown: 1 }, buildWeeklyExpectations(TRAILING));
  assert.equal(
    buildShortfallIdempotencyKey(34, a),
    buildShortfallIdempotencyKey(34, b),
  );

  // A newly failing type must change the key so it pings immediately.
  const c = detectWeeklyShortfalls({ updown: 1, gainer: 1, h2h: 1, jackpot: 20 }, buildWeeklyExpectations(TRAILING));
  assert.notEqual(
    buildShortfallIdempotencyKey(34, a),
    buildShortfallIdempotencyKey(34, c),
  );

  // Different weeks never share a key.
  assert.notEqual(
    buildShortfallIdempotencyKey(34, a),
    buildShortfallIdempotencyKey(35, a),
  );
});

test("the check swallows a dead database instead of breaking generation", async () => {
  // This suite runs with no DATABASE_URL, so importing ../db throws — which is
  // the exact condition being asserted. A monitor that took down the generator
  // it monitors would be worse than the blind spot it replaced, and it runs in
  // a `finally` on a path with no per-generator isolation.
  const result = await checkWeeklyGenerationHealth(34, new Date("2026-08-17T00:00:00Z"));
  assert.equal(result, null);
});

test("known counts do not spare the check from needing a baseline", async () => {
  // Passing counts avoids one query but still needs the trailing baseline, so
  // this must fail soft in the same way rather than half-reporting.
  const result = await checkWeeklyGenerationHealth(
    34,
    new Date("2026-08-17T00:00:00Z"),
    { updown: 12, h2h: 20, gainer: 9, jackpot: 20 },
  );
  assert.equal(result, null);
});

test("shortfall descriptions name the basis so the operator can judge it", () => {
  const [updown] = detectWeeklyShortfalls(
    { ...healthyWeek(), updown: 12 },
    buildWeeklyExpectations(TRAILING),
  );
  const text = describeShortfall(updown!);
  assert.match(text, /12 of 20/);
  assert.match(text, /anchored field size/);

  const [h2h] = detectWeeklyShortfalls(
    { ...healthyWeek(), h2h: 15 },
    buildWeeklyExpectations(TRAILING),
  );
  assert.match(describeShortfall(h2h!), /trailing 4 weeks/);

  const [cold] = detectWeeklyShortfalls(
    { updown: 20, h2h: 0, gainer: 9, jackpot: 20 },
    buildWeeklyExpectations({}),
  );
  assert.match(describeShortfall(cold!), /no trailing baseline/);
});
