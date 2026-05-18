/**
 * Unit tests for `buildOrphanLedgerCheckResult` — the pure
 * result-builder behind `checkOrphanLedger` in `server/jobs/amm-health.ts`.
 *
 * The SQL halves of the check require a DB, but this helper exists so
 * the status/message contract (pass vs fail, reconciled-ignored
 * suffix, sample passthrough) can be locked down without one. Pins
 * the post-reconciliation behaviour added after the 2026-05-17
 * orphan-seed incident.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const { buildOrphanLedgerCheckResult } = await import("../server/jobs/amm-health");

test("orphan ledger check: zero unreconciled, zero reconciled → pass with clean message", () => {
  const result = buildOrphanLedgerCheckResult({
    unreconciled: 0,
    reconciled: 0,
    sampleRows: [],
  });
  assert.equal(result.status, "pass");
  assert.equal(result.rowCount, 0);
  assert.equal(result.details, "No unreconciled credit_ledger rows reference deleted markets.");
  assert.deepEqual(result.sample, []);
});

test("orphan ledger check: zero unreconciled with reconciled history → pass + reconciled-ignored suffix", () => {
  const result = buildOrphanLedgerCheckResult({
    unreconciled: 0,
    reconciled: 5,
    sampleRows: [],
  });
  assert.equal(result.status, "pass");
  assert.equal(result.rowCount, 0);
  assert.match(result.details, /5 previously reconciled orphans ignored/);
});

test("orphan ledger check: singular grammar when one reconciled", () => {
  const result = buildOrphanLedgerCheckResult({
    unreconciled: 0,
    reconciled: 1,
    sampleRows: [],
  });
  assert.match(result.details, /1 previously reconciled orphan ignored/);
  assert.doesNotMatch(result.details, /orphans ignored/);
});

test("orphan ledger check: unreconciled rows → fail with actionable hint", () => {
  const sample = [
    { id: "abc", market_id: "m1", txn_type: "amm_seed_debit", created_at: new Date() },
  ];
  const result = buildOrphanLedgerCheckResult({
    unreconciled: 3,
    reconciled: 0,
    sampleRows: sample,
  });
  assert.equal(result.status, "fail");
  assert.equal(result.rowCount, 3);
  assert.match(result.details, /Found 3 unreconciled ledger row/);
  assert.match(result.details, /npm run amm:reconcile-orphans/);
  assert.deepEqual(result.sample, sample);
});

test("orphan ledger check: unreconciled + previously reconciled → fail but mentions both counts", () => {
  const result = buildOrphanLedgerCheckResult({
    unreconciled: 2,
    reconciled: 7,
    sampleRows: [],
  });
  assert.equal(result.status, "fail");
  assert.equal(result.rowCount, 2);
  assert.match(result.details, /Found 2 unreconciled ledger row/);
  assert.match(result.details, /7 previously reconciled orphans ignored/);
});
