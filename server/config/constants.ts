/**
 * Flat per-ticket cost for the weekly parimutuel jackpot. 100 credits is
 * ~1% of the starting 10,000-credit user balance — high enough that a
 * jackpot entry is a deliberate weekly decision (not impulse spam) but
 * low enough that a typical user can comfortably enter every week. Tied
 * to virtual credits only; will need a real-money equivalent when we
 * move to crypto/blockchain in Phase 2.
 */
export const JACKPOT_TICKET_COST = 100;

/**
 * Hard ceiling on a jackpot's predicted closing Trend Score. Set at 2M
 * because the highest live Trend Score in the catalogue today sits
 * around 1.0M-1.4M, so 2M leaves comfortable headroom for breakout-week
 * gains without letting users (or buggy agent code) submit absurd
 * predictions that distort the "closest guess" winner-pick math.
 */
export const JACKPOT_MAX_PREDICTED_SCORE = 2_000_000;
