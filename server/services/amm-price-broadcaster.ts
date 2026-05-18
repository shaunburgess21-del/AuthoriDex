/**
 * Singleton in-process pub/sub for AMM price ticks.
 *
 * Lifecycle:
 *   - `executeBuy` / `executeSell` call `notifyPriceChange(marketId,
 *     snapshot)` AFTER the trade transaction commits. This is a
 *     best-effort fire-and-forget — broadcaster failures must never
 *     roll back or surface to the caller.
 *   - The `GET /api/markets/:marketId/amm/stream` SSE route calls
 *     `subscribe(marketId, handler)` for each connected client and
 *     invokes the returned `unsubscribe()` on disconnect / cleanup.
 *
 * Scope and limitations:
 *   - Single-process only. Today the Railway deployment runs one
 *     instance so this is sufficient. For horizontal scaling we'd
 *     swap the EventEmitter for Redis Pub/Sub (or NATS) behind the
 *     same `subscribe` / `notifyPriceChange` interface. The route +
 *     trade-execution callers wouldn't change.
 *   - No persistence. If the process dies, subscribers will receive
 *     the next event after they re-connect (EventSource handles the
 *     reconnect itself; the SSE route sends a fresh snapshot on
 *     reconnect). We do NOT replay missed ticks — a 50 ms gap on
 *     restart is acceptable; the UI's next poll-refresh closes it
 *     anyway.
 *
 * Why a singleton EventEmitter and not `node:events`'s default
 * unbounded warnings? The default `maxListeners` is 10; we wire each
 * SSE connection as its own listener and a popular market page
 * could have many tabs open at once. `setMaxListeners(0)` removes
 * the cap for THIS emitter without changing the process default.
 */

import { EventEmitter } from "node:events";

/**
 * Payload of a single price-change event. Kept intentionally small
 * so the SSE wire footprint is minimal — the receiving client
 * merges this into the existing market query cache.
 *
 * `shareQuantities` is included alongside `outcomePrices` because
 * the detail-page UI computes its quotes (Buy receipt, Sell receipt,
 * "price after fill") from the q-vector, NOT from the price vector.
 * Sending both lets us pick the right one on the client: prices for
 * the headline rendering, shareQuantities for the math helpers in
 * `client/src/lib/ammClient.ts`.
 */
export interface AmmPriceSnapshot {
  /** entryId -> 0..1 probability. */
  outcomePrices: Record<string, number>;
  /** entryId -> q (LMSR share quantity). Matches the schema of
   *  `market_amm_state.share_quantities` exactly. */
  shareQuantities: Record<string, number>;
  /** LMSR liquidity parameter — useful for the receipt sidebar so
   *  it can show "depth" without a separate fetch. */
  liquidityB: number;
  /** ISO timestamp of the trade that triggered this event. The
   *  client uses this to debounce stale events (e.g. when two
   *  trades fire in quick succession). */
  lastTradeAt: string;
}

export type PriceChangeHandler = (snapshot: AmmPriceSnapshot) => void;

const EVENT_PREFIX = "priceChange:";

class AmmPriceBroadcaster {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  /**
   * Subscribe to price changes for a single market. Returns an
   * unsubscribe function the caller MUST invoke on cleanup
   * (`req.on('close')` from the SSE route handler).
   */
  subscribe(marketId: string, handler: PriceChangeHandler): () => void {
    const key = `${EVENT_PREFIX}${marketId}`;
    this.emitter.on(key, handler);
    return () => {
      this.emitter.off(key, handler);
    };
  }

  /**
   * Broadcast a fresh price snapshot for a market. Synchronous,
   * non-throwing — listener handlers run on the same tick.
   *
   * Isolation guarantee: each handler runs inside its own
   * try/catch so a single misbehaved listener (e.g. an SSE
   * connection that's half-broken and `res.write` throws) cannot
   * starve the rest of the subscriber list. The default
   * `EventEmitter#emit` would bubble the first throw and skip
   * every subsequent handler — that's precisely the failure mode
   * we don't want when one popular market has hundreds of
   * connected users.
   */
  notifyPriceChange(marketId: string, snapshot: AmmPriceSnapshot): void {
    const handlers = this.emitter.listeners(
      `${EVENT_PREFIX}${marketId}`,
    ) as PriceChangeHandler[];
    for (const handler of handlers) {
      try {
        handler(snapshot);
      } catch (err) {
        console.error(
          "[amm-price-broadcaster] subscriber handler threw (continuing):",
          err,
        );
      }
    }
  }

  /**
   * Diagnostics: how many active subscribers do we have for this
   * market? Used by the AMM health audit job to flag a leaking
   * deployment (listener count climbs without trades happening).
   */
  subscriberCount(marketId: string): number {
    return this.emitter.listenerCount(`${EVENT_PREFIX}${marketId}`);
  }

  /**
   * Diagnostics: total active subscribers across all markets.
   * Cheap O(n) over the registered event names.
   */
  totalSubscribers(): number {
    let total = 0;
    for (const name of this.emitter.eventNames()) {
      if (typeof name === "string" && name.startsWith(EVENT_PREFIX)) {
        total += this.emitter.listenerCount(name);
      }
    }
    return total;
  }
}

const broadcaster = new AmmPriceBroadcaster();

export function subscribe(
  marketId: string,
  handler: PriceChangeHandler,
): () => void {
  return broadcaster.subscribe(marketId, handler);
}

export function notifyPriceChange(
  marketId: string,
  snapshot: AmmPriceSnapshot,
): void {
  broadcaster.notifyPriceChange(marketId, snapshot);
}

export function subscriberCount(marketId: string): number {
  return broadcaster.subscriberCount(marketId);
}

export function totalSubscribers(): number {
  return broadcaster.totalSubscribers();
}

/**
 * Exported for tests only. Lets a test build its own isolated
 * instance instead of sharing the module-level singleton across
 * test files.
 */
export const __testing__ = {
  AmmPriceBroadcaster,
};
