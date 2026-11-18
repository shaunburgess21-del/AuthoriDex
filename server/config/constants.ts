import { JACKPOT_MAX_PREDICTED_SCORE } from "@shared/fame-scale";

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
 * Hard ceiling on a jackpot's predicted closing Trend Score. Defined in
 * `shared/fame-scale.ts` (twice the engine ceiling) and re-exported here so
 * existing server imports keep working. Nov 2026: was 2,000,000.
 */
export { JACKPOT_MAX_PREDICTED_SCORE };
