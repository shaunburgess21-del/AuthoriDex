import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { computeDraftHealth } = await import("../server/jobs/market-scout");

const NOW = new Date("2026-08-09T12:00:00.000Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();

test("a healthy draft carries no flags", () => {
  const h = computeDraftHealth({
    endAt: inHours(30 * 24),
    sourceEndDate: inHours(30 * 24),
    openLegPrices: [0.5, 0.3, 0.2],
    now: NOW,
  });
  assert.deepEqual(h.flags, []);
  assert.equal(h.bookSum, 1);
});

test("deadline flags distinguish expired from merely imminent", () => {
  const expired = computeDraftHealth({
    endAt: inHours(-1),
    sourceEndDate: inHours(-1),
    openLegPrices: [],
    now: NOW,
  });
  assert.ok(expired.flags.includes("already_expired"));
  assert.ok(!expired.flags.includes("ends_soon"));

  const soon = computeDraftHealth({
    endAt: inHours(14),
    sourceEndDate: inHours(14),
    openLegPrices: [],
    now: NOW,
  });
  assert.ok(soon.flags.includes("ends_soon"));
  assert.ok(!soon.flags.includes("already_expired"));
});

test("schedule drift is measured against the live source date", () => {
  const drifted = computeDraftHealth({
    endAt: inHours(20 * 24),
    sourceEndDate: inHours(45 * 24),
    openLegPrices: [],
    now: NOW,
  });
  assert.ok(drifted.flags.includes("schedule_drift"));

  // Sub-hour differences are noise, not a reschedule.
  const jitter = computeDraftHealth({
    endAt: inHours(20 * 24),
    sourceEndDate: new Date(NOW.getTime() + 20 * 24 * 3600_000 + 60_000).toISOString(),
    openLegPrices: [],
    now: NOW,
  });
  assert.ok(!jitter.flags.includes("schedule_drift"));

  // A data-lags market pushes endAt out to the resolution backstop on
  // purpose. Measuring drift against endAt would flag every one of them
  // forever, so the comparison uses the synced source date instead.
  const dataLags = computeDraftHealth({
    endAt: inHours(45 * 24),
    nominalSourceEndAt: inHours(20 * 24),
    sourceEndDate: inHours(20 * 24),
    openLegPrices: [],
    now: NOW,
  });
  assert.deepEqual(dataLags.flags, []);

  // Real drift is still caught once the source moves off that baseline.
  const realDrift = computeDraftHealth({
    endAt: inHours(45 * 24),
    nominalSourceEndAt: inHours(20 * 24),
    sourceEndDate: inHours(30 * 24),
    openLegPrices: [],
    now: NOW,
  });
  assert.ok(realDrift.flags.includes("schedule_drift"));
});

test("book flags catch the illiquid mid-price blowout", () => {
  // The 37-candidate Oscars field priced to a book sum of 14.5 on $68/day.
  const blown = computeDraftHealth({
    endAt: inHours(200 * 24),
    sourceEndDate: inHours(200 * 24),
    openLegPrices: [0.615, 0.175, 0.45, 0.45, 0.45],
    now: NOW,
  });
  assert.ok(blown.flags.includes("book_oversubscribed"));
  assert.ok(blown.bookSum !== null && blown.bookSum > 1.15);

  const short = computeDraftHealth({
    endAt: inHours(200 * 24),
    sourceEndDate: inHours(200 * 24),
    openLegPrices: [0.2, 0.15, 0.1],
    now: NOW,
  });
  assert.ok(short.flags.includes("book_short"));

  // Same short book with a catch-all is exactly what the importer accepts:
  // the "Other" leg absorbs the remainder, and cumulative ladders sit well
  // under 1 by nature. Flagging it would contradict the import gate.
  const absorbed = computeDraftHealth({
    endAt: inHours(200 * 24),
    sourceEndDate: inHours(200 * 24),
    openLegPrices: [0.2, 0.15, 0.1],
    hasCatchAll: true,
    now: NOW,
  });
  assert.deepEqual(absorbed.flags, []);

  // The ceiling is unconditional — a catch-all cannot excuse odds over 100%.
  const blownWithOther = computeDraftHealth({
    endAt: inHours(200 * 24),
    sourceEndDate: inHours(200 * 24),
    openLegPrices: [0.615, 0.175, 0.45, 0.45, 0.45],
    hasCatchAll: true,
    now: NOW,
  });
  assert.ok(blownWithOther.flags.includes("book_oversubscribed"));

  // Ordinary vig must not trip either flag.
  const vig = computeDraftHealth({
    endAt: inHours(200 * 24),
    sourceEndDate: inHours(200 * 24),
    openLegPrices: [0.36, 0.3, 0.2, 0.15, 0.115],
    now: NOW,
  });
  assert.deepEqual(vig.flags, []);
});

test("a single open leg is not scored as a book", () => {
  // One remaining leg says nothing about exhaustiveness.
  const h = computeDraftHealth({
    endAt: inHours(48 * 24),
    sourceEndDate: inHours(48 * 24),
    openLegPrices: [0.42],
    now: NOW,
  });
  assert.equal(h.bookSum, null);
  assert.deepEqual(h.flags, []);
});
