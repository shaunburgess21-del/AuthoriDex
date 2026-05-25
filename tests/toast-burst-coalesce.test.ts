import test from "node:test";
import assert from "node:assert/strict";

import {
  ToastBurstCoalescer,
  TOAST_BURST_LIMIT,
  TOAST_BURST_WINDOW_MS,
} from "../client/src/lib/notifications/toast-burst-coalesce";

test("first N toasts per kind render full", () => {
  const c = new ToastBurstCoalescer();
  const t0 = 1_000_000;
  for (let i = 0; i < TOAST_BURST_LIMIT; i++) {
    assert.deepEqual(c.record("market_resolved", t0 + i), { action: "full" });
  }
});

test("beyond limit returns summary with extra count", () => {
  const c = new ToastBurstCoalescer();
  const t0 = 2_000_000;
  for (let i = 0; i < TOAST_BURST_LIMIT; i++) {
    c.record("market_resolved", t0 + i);
  }
  assert.deepEqual(c.record("market_resolved", t0 + TOAST_BURST_LIMIT), {
    action: "summary",
    extra: 1,
  });
  assert.deepEqual(c.record("market_resolved", t0 + TOAST_BURST_LIMIT + 1), {
    action: "summary",
    extra: 2,
  });
  assert.equal(
    c.summaryTitle("market_resolved", 3),
    "3 more markets resolved — view all",
  );
});

test("window slides so burst resets after silence", () => {
  const c = new ToastBurstCoalescer();
  const t0 = 3_000_000;
  for (let i = 0; i < TOAST_BURST_LIMIT + 1; i++) {
    c.record("market_resolved", t0 + i);
  }
  assert.deepEqual(
    c.record("market_resolved", t0 + TOAST_BURST_WINDOW_MS + 100),
    { action: "full" },
  );
});

test("kinds are tracked independently", () => {
  const c = new ToastBurstCoalescer();
  const t0 = 4_000_000;
  assert.deepEqual(c.record("market_resolved", t0), { action: "full" });
  assert.deepEqual(c.record("credits_granted", t0), { action: "full" });
});

test("reset clears burst state", () => {
  const c = new ToastBurstCoalescer();
  const t0 = 5_000_000;
  for (let i = 0; i < TOAST_BURST_LIMIT + 1; i++) {
    c.record("market_resolved", t0 + i);
  }
  c.reset();
  assert.deepEqual(c.record("market_resolved", t0 + 100), { action: "full" });
});
