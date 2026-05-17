/**
 * Unit tests for `deriveTrendDirection` — the priority ladder that
 * collapses noisier signals (`pctChangeVsOpen`, `change24h`, `change7d`,
 * snapshot `momentum`) into a single UP/DOWN/FLAT bucket consumed by the
 * decision engine.
 *
 * Conservative-by-design: we only emit UP/DOWN when the underlying
 * signals agree. These tests pin every rung of the ladder so a future
 * tweak to thresholds doesn't silently flip the ranking semantics.
 */

import test from "node:test";
import assert from "node:assert/strict";

// Importing from agentRunner pulls server/db transitively. db throws on
// module load without DATABASE_URL — drizzle is lazy-connected so a fake
// URL is enough; we never query in these tests.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const { _deriveTrendDirectionForTesting: deriveTrendDirection } = await import(
  "../server/agents/agentRunner"
);

// ---------------------------------------------------------------------------
// Rung 1 — pctChangeVsOpen
// ---------------------------------------------------------------------------

test("rung 1: pctChangeVsOpen > 0.02 wins everything else", () => {
  // Even if 24h and 7d are flat and momentum is Cooling, a clear vsOpen
  // up-move should produce UP.
  const dir = deriveTrendDirection({
    pctChangeVsOpen: 0.05,
    change24h: 0,
    change7d: 0,
    momentum: "Cooling",
  });
  assert.equal(dir, "UP");
});

test("rung 1: pctChangeVsOpen < -0.02 wins everything else", () => {
  const dir = deriveTrendDirection({
    pctChangeVsOpen: -0.10,
    change24h: 5,
    change7d: 5,
    momentum: "Breakout",
  });
  assert.equal(dir, "DOWN");
});

test("rung 1: |pctChangeVsOpen| <= 0.02 falls through (does NOT short-circuit)", () => {
  // Tiny vsOpen below threshold; rung 2 should kick in if windows agree.
  const dir = deriveTrendDirection({
    pctChangeVsOpen: 0.015,
    change24h: 1.0,
    change7d: 5,
    momentum: "Stable",
  });
  assert.equal(dir, "UP");
});

// ---------------------------------------------------------------------------
// Rung 2 — change24h + change7d agreement
// ---------------------------------------------------------------------------

test("rung 2: change24h > 0.5 AND change7d >= 0 -> UP", () => {
  const dir = deriveTrendDirection({
    change24h: 0.8,
    change7d: 3,
    momentum: "Stable",
  });
  assert.equal(dir, "UP");
});

test("rung 2: change24h < -0.5 AND change7d <= 0 -> DOWN", () => {
  const dir = deriveTrendDirection({
    change24h: -1.2,
    change7d: -4,
    momentum: "Stable",
  });
  assert.equal(dir, "DOWN");
});

test("rung 2: change24h and change7d disagree -> FLAT (noise/mean-reversion)", () => {
  // 24h up but 7d down — this is exactly the case the ladder should
  // refuse to commit on.
  const dir = deriveTrendDirection({
    change24h: 0.8,
    change7d: -2,
    momentum: "Stable",
  });
  assert.equal(dir, "FLAT");
});

test("rung 2: |change24h| <= 0.5 falls through to rung 3 even with directional 7d", () => {
  // 24h too small to lock in direction; momentum becomes the tiebreaker.
  const dir = deriveTrendDirection({
    change24h: 0.3,
    change7d: 5,
    momentum: "Cooling",
  });
  assert.equal(dir, "DOWN");
});

// ---------------------------------------------------------------------------
// Rung 3 — momentum label
// ---------------------------------------------------------------------------

test("rung 3: momentum 'Breakout' with no other signals -> UP", () => {
  assert.equal(
    deriveTrendDirection({ change24h: 0, change7d: 0, momentum: "Breakout" }),
    "UP",
  );
});

test("rung 3: momentum 'Cooling' with no other signals -> DOWN", () => {
  assert.equal(
    deriveTrendDirection({ change24h: 0, change7d: 0, momentum: "Cooling" }),
    "DOWN",
  );
});

test("rung 3: momentum 'Sustained' / 'Stable' / 'Unknown' -> FLAT", () => {
  for (const m of ["Sustained", "Stable", "Unknown"] as const) {
    assert.equal(
      deriveTrendDirection({ change24h: 0, change7d: 0, momentum: m }),
      "FLAT",
      `momentum=${m}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Default fallback
// ---------------------------------------------------------------------------

test("everything zero / Stable -> FLAT", () => {
  assert.equal(
    deriveTrendDirection({ change24h: 0, change7d: 0, momentum: "Stable" }),
    "FLAT",
  );
});

test("undefined pctChangeVsOpen does not crash the ladder", () => {
  // Regression guard: pctChangeVsOpen is optional; the ladder must never
  // crash when it's missing. (Earlier draft used `pctChangeVsOpen != null`
  // before checking abs — keep that contract.)
  const dir = deriveTrendDirection({
    pctChangeVsOpen: undefined,
    change24h: 0.7,
    change7d: 5,
    momentum: "Stable",
  });
  assert.equal(dir, "UP");
});

test("non-finite pctChangeVsOpen is ignored, ladder continues", () => {
  // A stray Infinity / NaN must not get treated as "huge upward move".
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const dir = deriveTrendDirection({
      pctChangeVsOpen: bad,
      change24h: -0.8,
      change7d: -3,
      momentum: "Stable",
    });
    assert.equal(dir, "DOWN", `pctChangeVsOpen=${bad}`);
  }
});
