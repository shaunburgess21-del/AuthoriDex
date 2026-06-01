/**
 * Configuration for the LMSR AMM engine.
 *
 * The single knob worth tuning per market type is `targetMaxLoss` — the
 * maximum number of virtual credits the house can lose on this market
 * if every share buyer goes one direction and that direction wins. The
 * LMSR liquidity parameter `b` is then derived as
 *
 *   b = targetMaxLoss / ln(numOutcomes)
 *
 * via `seedB(...)` in `shared/lib/amm/lmsr.ts`. Higher b → smoother
 * price impact (each share moves the price less) but bigger worst-case
 * loss. Phase 4 will revisit these per market type once we observe
 * real volume.
 */

/**
 * Fallback used by `getTargetMaxLoss` when no per-market-type override
 * exists. Sized to match the rough average parimutuel pool today
 * (per the SQL queries from the rebuild kickoff) so AMM markets feel
 * similar in scale to legacy parimutuel ones.
 */
export const DEFAULT_TARGET_MAX_LOSS_PER_MARKET = 5000;

/**
 * Per-market-type overrides. Empty for now — every market type uses the
 * default. Phase 4 will populate this as each type flips to AMM:
 *   - 'h2h' → ~3000 (only 2 outcomes, tighter)
 *   - 'updown' → ~3000 (also 2 outcomes)
 *   - 'gainer' → ~8000 (3-10 outcomes, ln(N) scales the loss)
 *   - 'community' → 5000 (default for now; admin-tunable per market later)
 */
export const TARGET_MAX_LOSS_BY_MARKET_TYPE: Record<string, number> = {
  updown: 2000,
  h2h: 2000,
};

/**
 * Pick the right targetMaxLoss for a market. Caller-supplied overrides
 * (e.g. an admin "create test market" form) win, then the
 * per-market-type map, then the default.
 */
export function getTargetMaxLoss(
  marketType: string | null | undefined,
  override?: number | null | undefined,
): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }
  if (marketType && TARGET_MAX_LOSS_BY_MARKET_TYPE[marketType] !== undefined) {
    return TARGET_MAX_LOSS_BY_MARKET_TYPE[marketType];
  }
  return DEFAULT_TARGET_MAX_LOSS_PER_MARKET;
}
