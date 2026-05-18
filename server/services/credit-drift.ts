/**
 * Wallet-vs-ledger drift helpers.
 *
 * A "drifted" non-agent profile is one where
 * `predict_credits != SUM(credit_ledger.amount)`. The drift is a real-world
 * artefact of the parimutuel→AMM sunset, which reset every human's
 * `predict_credits` to a 10,000-cr baseline without writing matching
 * ledger rows in all cases. We treat the wallet (`predict_credits`) as
 * the source of truth: the reconciliation action writes one compensating
 * `manual_drift_reconciliation` ledger entry to bring the ledger sum
 * back into line.
 *
 * Sign convention: `delta = wallet − ledgerSum`.
 *   - `delta > 0` means the wallet is richer than the ledger says it
 *     should be (the user benefits — we credit a positive ledger row).
 *   - `delta < 0` means the wallet is poorer than the ledger sum (the
 *     user paid into the system more than the wallet reflects — we
 *     debit a negative ledger row to align the audit trail).
 *   - `delta === 0` means already reconciled — short-circuit, no row.
 *
 * Kept here (not inline in `server/routes.ts`) so the contract can be
 * unit-tested without a DB and so a future "bulk reconcile" or CLI
 * version can share the math.
 */

export interface DriftInput {
  wallet: number;
  ledgerSum: number;
}

/**
 * Compute the delta that, applied as a single ledger row, brings
 * `SUM(credit_ledger.amount)` for a user back into line with their
 * `predict_credits` wallet balance. Throws on non-finite inputs so a
 * malformed DB row can't quietly write `NaN` into the ledger.
 */
export function computeDriftDelta(input: DriftInput): number {
  const { wallet, ledgerSum } = input;
  if (!Number.isFinite(wallet)) {
    throw new Error(`computeDriftDelta: wallet must be finite, got ${wallet}`);
  }
  if (!Number.isFinite(ledgerSum)) {
    throw new Error(`computeDriftDelta: ledgerSum must be finite, got ${ledgerSum}`);
  }
  return Math.trunc(wallet) - Math.trunc(ledgerSum);
}
