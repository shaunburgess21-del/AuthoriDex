import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  clearRequestMemo,
  memoizeAsync,
  singleFlight,
} from "../server/services/insights/request-memo";

describe("memoizeAsync", () => {
  beforeEach(() => {
    clearRequestMemo();
  });

  it("dedupes concurrent loaders (single-flight)", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return calls;
    };

    const [a, b, c] = await Promise.all([
      memoizeAsync("k", 60_000, loader),
      memoizeAsync("k", 60_000, loader),
      memoizeAsync("k", 60_000, loader),
    ]);

    assert.equal(a, 1);
    assert.equal(b, 1);
    assert.equal(c, 1);
    assert.equal(calls, 1);
  });

  it("reuses cached value within TTL", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return "v";
    };

    await memoizeAsync("k2", 60_000, loader);
    await memoizeAsync("k2", 60_000, loader);
    assert.equal(calls, 1);
  });
});

describe("singleFlight", () => {
  beforeEach(() => {
    clearRequestMemo();
  });

  it("dedupes concurrent calls but does not cache after settle", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return calls;
    };

    const [a, b] = await Promise.all([
      singleFlight("sf", fn),
      singleFlight("sf", fn),
    ]);
    assert.equal(a, 1);
    assert.equal(b, 1);
    assert.equal(calls, 1);

    // After settle, the flight is released — a subsequent call recomputes.
    const c = await singleFlight("sf", fn);
    assert.equal(c, 2);
    assert.equal(calls, 2);
  });

  it("releases the flight on rejection", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("boom");
    };

    await assert.rejects(singleFlight("sf-err", fn));
    await assert.rejects(singleFlight("sf-err", fn));
    assert.equal(calls, 2);
  });
});
