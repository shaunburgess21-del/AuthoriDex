import test from "node:test";
import assert from "node:assert/strict";

import { retryWithBackoff } from "../server/agents/retry";

// Pure helper tests. The DB-touching consumer (server/agents/
// runtime-state.ts) wires this into `loadFromDbWithRetry`; pinning
// the helper's behaviour here keeps the live path honest without
// needing test DB scaffolding.

/** Mock sleep so the test suite isn't gated on real wall-clock time.
 *  Captures every (ms) call so assertions can verify the backoff
 *  schedule the caller asked for. */
function makeFakeSleep() {
  const calls: number[] = [];
  const sleep = async (ms: number) => {
    calls.push(ms);
  };
  return { sleep, calls };
}

test("retryWithBackoff: returns immediately when the first attempt succeeds", async () => {
  const { sleep, calls } = makeFakeSleep();
  let invocations = 0;
  const fn = async () => {
    invocations += 1;
    return "ok";
  };

  const result = await retryWithBackoff(fn, {
    attempts: 3,
    delayMs: (n) => 100 * (n + 1),
    sleep,
  });

  assert.equal(result, "ok");
  assert.equal(invocations, 1, "should only invoke fn once on success");
  assert.deepEqual(calls, [], "should not sleep when first attempt succeeds");
});

test("retryWithBackoff: recovers from a single transient error (mirrors boot hiccup)", async () => {
  const { sleep, calls } = makeFakeSleep();
  let invocations = 0;
  const fn = async () => {
    invocations += 1;
    if (invocations === 1) throw new Error("ECONNREFUSED");
    return "ok";
  };

  const result = await retryWithBackoff(fn, {
    attempts: 3,
    delayMs: (n) => 100 * (n + 1),
    sleep,
  });

  assert.equal(result, "ok");
  assert.equal(invocations, 2, "should retry once and succeed");
  assert.deepEqual(calls, [100], "should sleep 100ms once before the retry");
});

test("retryWithBackoff: recovers when the second attempt fails but the third succeeds", async () => {
  const { sleep, calls } = makeFakeSleep();
  let invocations = 0;
  const fn = async () => {
    invocations += 1;
    if (invocations < 3) throw new Error("transient");
    return "ok";
  };

  const result = await retryWithBackoff(fn, {
    attempts: 3,
    delayMs: (n) => 100 * (n + 1),
    sleep,
  });

  assert.equal(result, "ok");
  assert.equal(invocations, 3);
  assert.deepEqual(
    calls,
    [100, 200],
    "linear backoff should sleep 100ms then 200ms before the surviving attempt",
  );
});

test("retryWithBackoff: surfaces the final error when ALL attempts fail (fail-open path stays reachable)", async () => {
  const { sleep, calls } = makeFakeSleep();
  let invocations = 0;
  const fn = async () => {
    invocations += 1;
    throw new Error(`fail-${invocations}`);
  };

  await assert.rejects(
    retryWithBackoff(fn, {
      attempts: 3,
      delayMs: (n) => 100 * (n + 1),
      sleep,
    }),
    /fail-3/,
    "should surface the LAST error so the caller's catch (fail-open) fires",
  );
  assert.equal(invocations, 3, "should exhaust the attempts budget");
  assert.deepEqual(
    calls,
    [100, 200],
    "should NOT sleep after the final attempt — only between attempts",
  );
});

test("retryWithBackoff: attempts=1 means no retry (zero sleeps)", async () => {
  const { sleep, calls } = makeFakeSleep();
  let invocations = 0;
  const fn = async () => {
    invocations += 1;
    throw new Error("fail");
  };

  await assert.rejects(
    retryWithBackoff(fn, {
      attempts: 1,
      delayMs: () => 100,
      sleep,
    }),
    /fail/,
  );
  assert.equal(invocations, 1);
  assert.deepEqual(calls, []);
});

test("retryWithBackoff: rejects attempts < 1", async () => {
  await assert.rejects(
    retryWithBackoff(async () => "x", {
      attempts: 0,
      delayMs: () => 0,
    }),
    /attempts must be >= 1/,
  );
});

test("retryWithBackoff: respects a fixed-delay schedule", async () => {
  const { sleep, calls } = makeFakeSleep();
  let invocations = 0;
  const fn = async () => {
    invocations += 1;
    if (invocations < 4) throw new Error("transient");
    return "ok";
  };

  const result = await retryWithBackoff(fn, {
    attempts: 4,
    delayMs: () => 50,
    sleep,
  });

  assert.equal(result, "ok");
  assert.deepEqual(calls, [50, 50, 50]);
});

test("retryWithBackoff: works with the default sleep when no override is provided", async () => {
  // Smoke test the real sleep path — keep delay tiny so the test stays fast.
  let invocations = 0;
  const fn = async () => {
    invocations += 1;
    if (invocations === 1) throw new Error("transient");
    return "ok";
  };

  const start = Date.now();
  const result = await retryWithBackoff(fn, {
    attempts: 2,
    delayMs: () => 5,
  });
  const elapsed = Date.now() - start;

  assert.equal(result, "ok");
  assert.equal(invocations, 2);
  // Real sleep was invoked at least once — allow generous slack on CI.
  assert.ok(elapsed >= 4, `expected >= 4ms wall clock, got ${elapsed}ms`);
});
