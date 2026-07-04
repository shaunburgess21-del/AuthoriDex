import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  clearRequestMemo,
  memoizeAsync,
  memoizeAsyncSwr,
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

describe("memoizeAsyncSwr", () => {
  beforeEach(() => {
    clearRequestMemo();
  });

  it("serves fresh value within TTL without reloading", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return calls;
    };

    assert.equal(await memoizeAsyncSwr("swr1", 60_000, 60_000, loader), 1);
    assert.equal(await memoizeAsyncSwr("swr1", 60_000, 60_000, loader), 1);
    assert.equal(calls, 1);
  });

  it("serves stale value immediately and refreshes in background", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return calls;
    };

    // ttl=0 → value is stale immediately, but within the stale window.
    assert.equal(await memoizeAsyncSwr("swr2", 0, 60_000, loader), 1);

    // Stale hit: returns the old value without waiting for the refresh.
    assert.equal(await memoizeAsyncSwr("swr2", 0, 60_000, loader), 1);

    // Let the background refresh land, then the new value is served.
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(await memoizeAsyncSwr("swr2", 0, 60_000, loader), 2);
    assert.equal(calls >= 2, true);
  });

  it("only one background refresh runs for concurrent stale hits", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return calls;
    };

    await memoizeAsyncSwr("swr3", 0, 60_000, loader); // cold compute (call 1)
    const [a, b, c] = await Promise.all([
      memoizeAsyncSwr("swr3", 0, 60_000, loader),
      memoizeAsyncSwr("swr3", 0, 60_000, loader),
      memoizeAsyncSwr("swr3", 0, 60_000, loader),
    ]);
    assert.equal(a, 1);
    assert.equal(b, 1);
    assert.equal(c, 1);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls, 2); // cold + exactly one background refresh
  });

  it("keeps the stale value when the background refresh fails", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      if (calls > 1) throw new Error("refresh boom");
      return "good";
    };

    assert.equal(await memoizeAsyncSwr("swr4", 0, 60_000, loader), "good");
    // Stale hit triggers a failing refresh — stale value still served.
    assert.equal(await memoizeAsyncSwr("swr4", 0, 60_000, loader), "good");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(await memoizeAsyncSwr("swr4", 0, 60_000, loader), "good");
  });

  it("blocks and recomputes when older than the stale window", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return calls;
    };

    assert.equal(await memoizeAsyncSwr("swr5", 0, 0, loader), 1);
    // ttl=0 AND staleMax=0 → entry is beyond the stale window: cold path.
    assert.equal(await memoizeAsyncSwr("swr5", 0, 0, loader), 2);
    assert.equal(calls, 2);
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
