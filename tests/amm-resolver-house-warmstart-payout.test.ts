/**
 * Unit tests for `selectPayoutLedgerShape` — the pure helper in
 * `server/services/amm-resolver.ts` that decides whether a winning-
 * share payout for a given userId lands in `credit_ledger` as
 * `amm_payout` (regular user) or `amm_warmstart_payout` (the house).
 *
 * Why this matters: when warm-start fires, the house holds shares of
 * the prior-favoured side. At resolution, if those shares win, the
 * AMM resolver writes a payout ledger row. The drain breaker and the
 * admin house dashboard both sum that ledger row into their P&L
 * accounting; splitting the txn type at the source lets them
 * distinguish "regular user payout" from "warm-start offset payout"
 * without joining `market_bets`.
 *
 * The DB-touching `resolveAmmMarket` itself is intentionally NOT
 * covered here — its transaction-bound flow is exercised end-to-end
 * by `scripts/amm-smoke.ts`. Pinning the helper contract here keeps
 * the txn-type/idempotency-key shape stable without spinning up a DB.
 */
import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL set BEFORE any import that transitively loads
// server/db.ts. pg.Pool is lazy, so this only fails if we actually
// issue a query — the pure helper tested here never touches the DB.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { selectPayoutLedgerShape } = await import("../server/services/amm-resolver");
const { HOUSE_PROFILE_ID } = await import("../server/services/amm-house");

const MARKET = "01J5ABCDEF1234567890ABCDEF";
const REGULAR_USER = "11111111-1111-1111-1111-111111111111";

test("selectPayoutLedgerShape: regular user → amm_payout with user-scoped key", () => {
  const shape = selectPayoutLedgerShape(REGULAR_USER, MARKET);
  assert.equal(shape.txnType, "amm_payout");
  assert.equal(shape.idempotencyKey, `amm_payout_${MARKET}_${REGULAR_USER}`);
  assert.equal(
    shape.source,
    undefined,
    "regular user payouts must NOT carry a `source` tag — that field is reserved for house warm-start payouts",
  );
});

test("selectPayoutLedgerShape: house user → amm_warmstart_payout with market-scoped key", () => {
  const shape = selectPayoutLedgerShape(HOUSE_PROFILE_ID, MARKET);
  assert.equal(shape.txnType, "amm_warmstart_payout");
  assert.equal(shape.idempotencyKey, `amm_warmstart_payout_${MARKET}`);
  assert.equal(shape.source, "house_warm_start");
});

test("selectPayoutLedgerShape: house idempotency key has NO userId suffix (one row per market)", () => {
  // The user-scoped form would let two parallel runs each insert their
  // own house payout row for the same market. Using a market-scoped
  // key guarantees a single warm-start payout row per market — the
  // same convention `amm_settle_${marketId}` uses for seed returns.
  const shape = selectPayoutLedgerShape(HOUSE_PROFILE_ID, MARKET);
  assert.ok(!shape.idempotencyKey.includes(HOUSE_PROFILE_ID));
});

test("selectPayoutLedgerShape: house key is unique per market", () => {
  const a = selectPayoutLedgerShape(HOUSE_PROFILE_ID, "market-a");
  const b = selectPayoutLedgerShape(HOUSE_PROFILE_ID, "market-b");
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);
});

test("selectPayoutLedgerShape: regular-user key includes both marketId and userId", () => {
  // Both pieces are needed for uniqueness: same user across multiple
  // markets, multiple users on one market.
  const a = selectPayoutLedgerShape(REGULAR_USER, "market-a");
  const b = selectPayoutLedgerShape(REGULAR_USER, "market-b");
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);

  const c = selectPayoutLedgerShape("user-other", "market-a");
  assert.notEqual(a.idempotencyKey, c.idempotencyKey);
});

test("selectPayoutLedgerShape: house and regular-user txn types never collide", () => {
  // Even if some future bug accidentally passed HOUSE_PROFILE_ID to a
  // non-warmstart code path, the txn types stay distinct and the
  // ledger row is unambiguously attributable to one source.
  const house = selectPayoutLedgerShape(HOUSE_PROFILE_ID, MARKET);
  const regular = selectPayoutLedgerShape(REGULAR_USER, MARKET);
  assert.notEqual(house.txnType, regular.txnType);
  assert.notEqual(house.idempotencyKey, regular.idempotencyKey);
});
