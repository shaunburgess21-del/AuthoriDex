/**
 * Tier 1.1: live AMM price stream hook.
 *
 * Subscribes to `GET /api/markets/:marketId/amm/stream` via the
 * browser's native `EventSource` and merges each push event into
 * the React Query cache for `["/api/open-markets", slug]`. Because
 * the existing detail-page UI reads its price + quote state from
 * that cache, the SSE plumbing requires zero extra wiring on the
 * render side — components update as if their query had refetched.
 *
 * Single-process broadcaster on the server today; horizontal scale
 * follow-up is documented in
 * `server/services/amm-price-broadcaster.ts`.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface PriceStreamPayload {
  outcomePrices: Record<string, number>;
  shareQuantities: Record<string, number>;
  liquidityB: number;
  lastTradeAt: string;
}

interface UseAmmPriceStreamOptions {
  /** When set, the hook will updates the cached entry under this
   *  React Query key. Pass `["/api/open-markets", slug]` from
   *  detail pages so the existing bindings (price tiles, receipt
   *  card, position rows) light up without extra plumbing. */
  queryKey?: readonly unknown[];
  /** Override the default endpoint. Tests / future routes can
   *  point this at a different SSE URL. */
  endpoint?: string;
}

/**
 * Mount once per market detail page. Opens a single EventSource
 * for the lifetime of the component, cleans it up on unmount.
 *
 * Reconnect strategy: EventSource handles reconnects automatically
 * with the browser's default backoff (typically 3 s). We add a
 * simple guard so a server outage doesn't churn the React tree
 * with constant connect/disconnect renders — the hook only
 * remounts the EventSource when `marketId` changes.
 */
export function useAmmPriceStream(
  marketId: string | null | undefined,
  options: UseAmmPriceStreamOptions = {},
): void {
  const queryClient = useQueryClient();
  const { queryKey, endpoint } = options;
  // Stash the latest queryKey + queryClient in refs so the
  // EventSource handler closes over the freshest values without
  // re-opening the connection on every render.
  const queryKeyRef = useRef(queryKey);
  const queryClientRef = useRef(queryClient);
  useEffect(() => {
    queryKeyRef.current = queryKey;
    queryClientRef.current = queryClient;
  });

  useEffect(() => {
    if (!marketId) return;
    if (typeof EventSource === "undefined") return;

    const url =
      endpoint ?? `/api/markets/${encodeURIComponent(marketId)}/amm/stream`;
    const es = new EventSource(url);

    // Drop out-of-order events on the client too. The server already
    // enforces a low-water mark for the initial snapshot, but once
    // we move the broadcaster to Redis Pub/Sub (multi-instance) the
    // server cannot fully order across processes. Defending here
    // means the rendered price never regresses even under that
    // upgrade path.
    let lastAppliedAt = 0;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as PriceStreamPayload;
        const eventAt = new Date(data.lastTradeAt).getTime();
        if (Number.isFinite(eventAt) && eventAt < lastAppliedAt) return;
        if (Number.isFinite(eventAt)) lastAppliedAt = eventAt;
        const key = queryKeyRef.current;
        if (!key) return;
        // Merge the new prices + q-vector into the cached market
        // payload. `setQueryData` updates synchronously and triggers
        // a re-render of every component selecting from this key
        // (the detail page, position card, modal hero tiles).
        queryClientRef.current.setQueryData(key, (old: unknown) => {
          if (!old || typeof old !== "object") return old;
          const market = old as {
            ammState?: {
              shareQuantities?: Record<string, number>;
              liquidityB?: number;
            } | null;
          };
          const prevAmmState = market.ammState ?? null;
          return {
            ...market,
            ammState: prevAmmState
              ? {
                  ...prevAmmState,
                  liquidityB: data.liquidityB,
                  shareQuantities: data.shareQuantities,
                }
              : {
                  liquidityB: data.liquidityB,
                  // Best-effort fallback: if the market query hadn't
                  // populated ammState yet, we synthesise just enough
                  // for the price math helpers to render. The next
                  // query refetch will fill in the rest.
                  outcomeOrder: Object.keys(data.shareQuantities),
                  shareQuantities: data.shareQuantities,
                },
          };
        });
      } catch (err) {
        console.error("[useAmmPriceStream] parse failed:", err);
      }
    };

    es.onerror = (event) => {
      // EventSource auto-reconnects on transient errors. We don't
      // close on the first error — the browser will retry. Log so
      // a permanent failure (404 / 500) shows up in DevTools.
      if (es.readyState === EventSource.CLOSED) {
        console.warn("[useAmmPriceStream] stream closed", event);
      }
    };

    return () => {
      es.close();
    };
  }, [marketId, endpoint]);
}
