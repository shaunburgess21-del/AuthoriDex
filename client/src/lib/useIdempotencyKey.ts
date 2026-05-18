import { useMemo } from "react";

/**
 * Returns a stable UUID v4 for a single "user intent" — typically the
 * lifetime of an open trade modal or a single render-pass of a detail-
 * page trade form. The key is forwarded on AMM trade requests as the
 * HTTP `Idempotency-Key` header (see `apiRequest` in
 * `client/src/lib/queryClient.ts`); the server short-circuits any
 * duplicate request bearing the same `(userId, key)` against
 * `credit_ledger` so a double-tap on the buy/sell button can never
 * produce two trades.
 *
 * Pass a dep array that captures "what counts as a NEW intent". For a
 * modal-based flow that's typically `[open, selectionId, intent]` so:
 *   - close+reopen → new key
 *   - swap to a different selection → new key
 *   - flip buy↔sell on the same selection → new key
 *   - hold position + retry click → SAME key (the protection we want)
 *
 * The hook returns `undefined` if `crypto.randomUUID` is unavailable
 * (very old browsers / non-secure-context Safari). In that case the
 * client just skips sending the header and the server falls back to
 * the legacy bet-id-based ledger key. No protection, but no breakage.
 *
 * Pass `enabled: false` (e.g. for a closed modal) to avoid generating
 * a key while no trade is possible — keeps memo allocation minimal.
 */
export function useIdempotencyKey(
  enabled: boolean,
  deps: ReadonlyArray<unknown>,
): string | undefined {
  return useMemo<string | undefined>(() => {
    if (!enabled) return undefined;
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}
