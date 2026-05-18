import test from "node:test";
import assert from "node:assert/strict";

import { __testing__, type AmmPriceSnapshot } from "../server/services/amm-price-broadcaster";

const { AmmPriceBroadcaster } = __testing__;

const SAMPLE_SNAPSHOT: AmmPriceSnapshot = {
  outcomePrices: { "entry-yes": 0.62, "entry-no": 0.38 },
  shareQuantities: { "entry-yes": 120, "entry-no": 80 },
  liquidityB: 250,
  lastTradeAt: "2025-01-01T00:00:00.000Z",
};

test("subscribe -> notify delivers the snapshot to the handler", () => {
  const bus = new AmmPriceBroadcaster();
  const received: AmmPriceSnapshot[] = [];
  const unsubscribe = bus.subscribe("m1", (s) => received.push(s));

  bus.notifyPriceChange("m1", SAMPLE_SNAPSHOT);

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], SAMPLE_SNAPSHOT);
  unsubscribe();
});

test("notify for a different marketId does NOT call the handler", () => {
  const bus = new AmmPriceBroadcaster();
  const received: AmmPriceSnapshot[] = [];
  bus.subscribe("m1", (s) => received.push(s));

  bus.notifyPriceChange("m-other", SAMPLE_SNAPSHOT);

  assert.equal(received.length, 0);
});

test("multiple subscribers on the same market all receive the event", () => {
  const bus = new AmmPriceBroadcaster();
  const r1: AmmPriceSnapshot[] = [];
  const r2: AmmPriceSnapshot[] = [];
  bus.subscribe("m1", (s) => r1.push(s));
  bus.subscribe("m1", (s) => r2.push(s));

  bus.notifyPriceChange("m1", SAMPLE_SNAPSHOT);

  assert.equal(r1.length, 1);
  assert.equal(r2.length, 1);
});

test("unsubscribe stops further deliveries to that handler only", () => {
  const bus = new AmmPriceBroadcaster();
  const r1: AmmPriceSnapshot[] = [];
  const r2: AmmPriceSnapshot[] = [];
  const off1 = bus.subscribe("m1", (s) => r1.push(s));
  bus.subscribe("m1", (s) => r2.push(s));

  bus.notifyPriceChange("m1", SAMPLE_SNAPSHOT);
  off1();
  bus.notifyPriceChange("m1", SAMPLE_SNAPSHOT);

  assert.equal(r1.length, 1, "handler 1 unsubscribed before second notify");
  assert.equal(r2.length, 2, "handler 2 should still receive both events");
});

test("subscriberCount reports active handlers for that market", () => {
  const bus = new AmmPriceBroadcaster();
  assert.equal(bus.subscriberCount("m1"), 0);
  const off1 = bus.subscribe("m1", () => {});
  const off2 = bus.subscribe("m1", () => {});
  bus.subscribe("m-other", () => {});

  assert.equal(bus.subscriberCount("m1"), 2);
  assert.equal(bus.subscriberCount("m-other"), 1);
  off1();
  assert.equal(bus.subscriberCount("m1"), 1);
  off2();
  assert.equal(bus.subscriberCount("m1"), 0);
});

test("totalSubscribers sums across all markets", () => {
  const bus = new AmmPriceBroadcaster();
  assert.equal(bus.totalSubscribers(), 0);
  bus.subscribe("m1", () => {});
  bus.subscribe("m1", () => {});
  bus.subscribe("m2", () => {});

  assert.equal(bus.totalSubscribers(), 3);
});

test("notify with no subscribers is a no-op (does not throw)", () => {
  const bus = new AmmPriceBroadcaster();
  assert.doesNotThrow(() => bus.notifyPriceChange("m1", SAMPLE_SNAPSHOT));
});

test("isolation: a throwing handler does NOT break delivery to other handlers", () => {
  // Critical guarantee for production: with hundreds of SSE
  // connections on a popular market, a single half-broken socket
  // whose `res.write` throws must not starve everyone else. The
  // broadcaster runs each handler in its own try/catch and logs
  // (we don't assert on the log here; just on the success of the
  // sibling delivery).
  const bus = new AmmPriceBroadcaster();
  const r1Calls: number[] = [];
  const r2: AmmPriceSnapshot[] = [];
  const r3: AmmPriceSnapshot[] = [];
  bus.subscribe("m1", () => {
    r1Calls.push(1);
    throw new Error("handler 1 explodes");
  });
  bus.subscribe("m1", (s) => r2.push(s));
  bus.subscribe("m1", (s) => r3.push(s));

  assert.doesNotThrow(() => bus.notifyPriceChange("m1", SAMPLE_SNAPSHOT));
  assert.equal(r1Calls.length, 1, "handler 1 was invoked");
  assert.equal(r2.length, 1, "handler 2 still received the event");
  assert.equal(r3.length, 1, "handler 3 still received the event");
});
