/**
 * Pure slippage-cap helpers for the LMSR trade path.
 *
 * The trade route handlers accept an optional `maxPricePerShare`
 * (buy) or `minPricePerShare` (sell) from the client. Once
 * `executeBuy` / `executeSell` have computed the LMSR quote inside
 * the per-market `FOR UPDATE` lock, they call into these helpers
 * with the actual credits-spent / shares-out figures to decide
 * whether to commit the trade or abort with `slippage_exceeded`.
 *
 * The pricing question the cap is answering: "given the cost I
 * actually paid and the shares I actually got, what was my
 * AVERAGE per-share fill price, and did it slip beyond what the
 * client said it would tolerate?"
 *
 * Using average price (not final price) is the same convention
 * Polymarket uses for its quote receipts. It's also the fill price
 * the user actually experienced; the final-price-after-fill is a
 * different number (the next user's quote price) and shouldn't
 * gate this user's trade.
 *
 * No DB. No imports. Pure / side-effect-free. Tests live in
 * tests/amm-slippage.test.ts.
 */

export interface CheckBuySlippageInput {
  /** Credits the user would spend on this fill. From the LMSR
   *  quote: `buyCost(state.shareQuantities, b, entryId, shares)`. */
  creditsSpent: number;
  /** Shares the user would receive on this fill. */
  sharesOut: number;
  /** Per-share cap supplied by the client. `null` / `undefined`
   *  means the client did not opt in to slippage protection;
   *  the helper returns ok in that case (backward-compatible
   *  with older clients and the agent runner). Expressed in the
   *  same units as the LMSR price (0..1 probability). */
  cap: number | null | undefined;
}

export interface CheckSellSlippageInput {
  /** Credits the user would receive on this fill. From the LMSR
   *  quote: `sellProceeds(state.shareQuantities, b, entryId, shares)`. */
  creditsReceived: number;
  /** Shares the user would deliver on this fill. */
  sharesIn: number;
  /** Per-share floor supplied by the client. `null` / `undefined`
   *  means the client did not opt in to slippage protection. */
  floor: number | null | undefined;
}

export interface SlippageOk {
  ok: true;
  /** Computed average fill price, for the receipt / logging. */
  avgPrice: number;
}

export interface SlippageFail {
  ok: false;
  /** Computed average fill price — included so the client can show
   *  the user the exact price that would have filled. */
  avgPrice: number;
  /** Echoed back so the client doesn't need to remember what it
   *  sent. */
  capOrFloor: number;
}

export type SlippageResult = SlippageOk | SlippageFail;

/**
 * BUY direction: ok when the average per-share price paid is at
 * or below the client-supplied cap.
 *
 * Edge cases:
 *   - `cap` null/undefined → ok (opt-in, not opt-out).
 *   - `sharesOut <= 0` → ok with avgPrice 0 (the upstream LMSR
 *     guards already rejected zero-share fills with
 *     `trade_too_small`; we never see this in practice but
 *     defending against div-by-zero is cheap).
 *   - Non-finite inputs → ok (defensive — we don't want to spuriously
 *     reject a valid trade because of a NaN cap; the upstream Zod
 *     schema is the authoritative validator).
 */
export function checkBuySlippage(input: CheckBuySlippageInput): SlippageResult {
  const { creditsSpent, sharesOut, cap } = input;
  if (cap === null || cap === undefined) {
    return { ok: true, avgPrice: sharesOut > 0 ? creditsSpent / sharesOut : 0 };
  }
  if (!Number.isFinite(cap) || cap <= 0) {
    // Bogus cap — treat as "no cap supplied". Defensive only;
    // route-layer Zod refuses negatives.
    return { ok: true, avgPrice: sharesOut > 0 ? creditsSpent / sharesOut : 0 };
  }
  if (sharesOut <= 0) {
    return { ok: true, avgPrice: 0 };
  }
  const avgPrice = creditsSpent / sharesOut;
  if (avgPrice <= cap) {
    return { ok: true, avgPrice };
  }
  return { ok: false, avgPrice, capOrFloor: cap };
}

/**
 * SELL direction: ok when the average per-share price received is
 * at or above the client-supplied floor. Mirror of the buy helper.
 */
export function checkSellSlippage(input: CheckSellSlippageInput): SlippageResult {
  const { creditsReceived, sharesIn, floor } = input;
  if (floor === null || floor === undefined) {
    return { ok: true, avgPrice: sharesIn > 0 ? creditsReceived / sharesIn : 0 };
  }
  if (!Number.isFinite(floor) || floor <= 0) {
    return { ok: true, avgPrice: sharesIn > 0 ? creditsReceived / sharesIn : 0 };
  }
  if (sharesIn <= 0) {
    return { ok: true, avgPrice: 0 };
  }
  const avgPrice = creditsReceived / sharesIn;
  if (avgPrice >= floor) {
    return { ok: true, avgPrice };
  }
  return { ok: false, avgPrice, capOrFloor: floor };
}

/**
 * Parse and validate a slippage bound (cap or floor) from the
 * request body. Accepts:
 *   - Finite number in (0, 1] → returned as-is.
 *   - Anything else (undefined, null, NaN, string, negative, > 1)
 *     → `null`, meaning "no bound supplied".
 *
 * The 0..1 bound mirrors the LMSR probability range. A cap >= 1
 * is meaningless (every share price is in [0, 1]) and a cap <= 0
 * would reject every trade — both collapse to "no cap".
 *
 * Used by all three trade route handlers so the parsing behaviour
 * is identical across `/api/open-markets/:slug/bet`,
 * `/api/native-markets/updown/:marketId/bet`, and
 * `/api/native-markets/:marketId/bet`.
 */
export function parseSlippageBound(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value <= 0 || value > 1) return null;
  return value;
}
