import { FAME_INDEX_MAX } from "../scoring/scale";

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
 * Hard ceiling on a jackpot's predicted closing Trend Score. Set at twice
 * the engine's own ceiling (FAME_INDEX_MAX = 100,000 — see
 * server/scoring/scale.ts), so there is comfortable headroom for
 * breakout-week guesses without letting users (or buggy agent code) submit
 * absurd predictions that distort the "closest guess" winner-pick math.
 *
 * Nov 2026: was 2,000,000 on the legacy x10,000 score scale.
 */
export const JACKPOT_MAX_PREDICTED_SCORE = 2 * FAME_INDEX_MAX;
