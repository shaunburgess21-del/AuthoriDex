/**
 * Shared ledger-type constants for AMM accounting.
 *
 * Centralises the set of `credit_ledger.txn_type` values that affect
 * the house's P&L so the drain breaker, the admin house dashboard, and
 * any future audit consumer all read from one source of truth.
 *
 * Why this exists as its own module:
 *
 * Before the consolidation, the drain breaker (`drainBreaker.ts`) and
 * the `/api/admin/amm/house` endpoint each kept their own inline list
 * of AMM txn types. The post-launch hardening sprint added a new type
 * (`amm_warmstart_debit`) and we shipped with one updated and the
 * other not — caught in self-review, but a single source of truth +
 * a consistency test (`tests/amm-house-pnl-consistency.test.ts`)
 * makes it structurally impossible for the next person who adds a
 * type to repeat the omission.
 *
 * --------------------------------------------------------------------------
 * Rule for adding a new AMM txn type
 * --------------------------------------------------------------------------
 *
 * Every call site that sums house P&L must consume `HOUSE_PNL_TXN_TYPES`.
 * Adding a new AMM ledger txn type means updating exactly THIS file —
 * the consistency test fails if you forget the surface where it should
 * be referenced.
 */

/**
 * AMM-related ledger txn types that affect house P&L.
 *
 * Sign convention (from the house wallet's perspective):
 *   - `amm_seed_debit`         NEGATIVE — house funds market open
 *   - `amm_warmstart_debit`    NEGATIVE — house funds a warm-start prior
 *   - `amm_payout`             POSITIVE/NEGATIVE — POSITIVE only on the
 *                              extremely rare case the house ends up
 *                              holding shares OUTSIDE warm-start. Today
 *                              this is structurally impossible (warm-start
 *                              is the only path that puts shares in the
 *                              house's name). Kept in the set for
 *                              forward-compat in case we add other house
 *                              trading paths.
 *   - `amm_warmstart_payout`   POSITIVE — house's warm-bought shares win
 *                              at resolution. Critical to include: without
 *                              this, the drain breaker counts the outflow
 *                              (`amm_warmstart_debit`) but not the
 *                              offsetting recovery.
 *   - `amm_void_refund`        POSITIVE — net effect on house when an
 *                              admin voids a market (depends on whether
 *                              the house was net debited or credited;
 *                              `SUM(amount)` handles both signs).
 *   - `amm_settle_credit`      POSITIVE — seed-return at settlement.
 *
 * `SUM(amount)` over these rows for the house user gives the net delta
 * directly — no sign-flipping at the call site needed.
 */
export const HOUSE_PNL_TXN_TYPES = [
  "amm_seed_debit",
  "amm_warmstart_debit",
  "amm_payout",
  "amm_warmstart_payout",
  "amm_void_refund",
  "amm_settle_credit",
] as const;

export type HousePnlTxnType = (typeof HOUSE_PNL_TXN_TYPES)[number];

/**
 * Superset used by `/api/admin/amm/house` to show lifetime aggregates
 * including the one-off `initial_grant` row. Strictly a display-side
 * concern — `initial_grant` is the historical bootstrap credit, not a
 * P&L flow, so it doesn't belong in `HOUSE_PNL_TXN_TYPES` proper.
 */
export const HOUSE_LEDGER_DISPLAY_TXN_TYPES = [
  ...HOUSE_PNL_TXN_TYPES,
  "initial_grant",
] as const;

export type HouseLedgerDisplayTxnType = (typeof HOUSE_LEDGER_DISPLAY_TXN_TYPES)[number];
