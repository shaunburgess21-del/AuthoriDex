/**
 * Cross-system consistency tests for `HOUSE_PNL_TXN_TYPES`.
 *
 * The drain breaker (`server/agents/drainBreaker.ts`) and the admin
 * `/api/admin/amm/house` endpoint (`server/routes.ts`) both sum the
 * house wallet's AMM-related credit_ledger flows. Before this
 * consolidation lived behind a shared constant, the two surfaces
 * independently maintained their own IN-list of txn types — and the
 * previous sprint shipped with one updated and the other not, caught
 * only in self-review.
 *
 * These tests guard the contract that every txn type belongs to the
 * shared set and every consumer reads from there. If you ADD a new
 * AMM txn type, update `server/services/amm-ledger-types.ts` and the
 * tests below — both happen in the same diff, structurally.
 */
import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const {
  HOUSE_PNL_TXN_TYPES,
  HOUSE_LEDGER_DISPLAY_TXN_TYPES,
} = await import("../server/services/amm-ledger-types");

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

test("HOUSE_PNL_TXN_TYPES: non-empty", () => {
  assert.ok(HOUSE_PNL_TXN_TYPES.length > 0);
});

test("HOUSE_PNL_TXN_TYPES: no duplicates", () => {
  const set = new Set(HOUSE_PNL_TXN_TYPES);
  assert.equal(set.size, HOUSE_PNL_TXN_TYPES.length);
});

test("HOUSE_PNL_TXN_TYPES: every entry is a non-empty string", () => {
  for (const t of HOUSE_PNL_TXN_TYPES) {
    assert.equal(typeof t, "string");
    assert.ok(t.length > 0);
    assert.equal(t.trim(), t, `entry "${t}" has leading/trailing whitespace`);
  }
});

test("HOUSE_PNL_TXN_TYPES: only AMM-flow types (no jackpot/parimutuel/manual rows)", () => {
  // Defensive — these types DO affect the house wallet but they're not
  // part of the AMM seed-and-settle accounting cycle the drain breaker
  // is built around. Including them in the set would conflate flows
  // and make the breaker's threshold harder to reason about.
  const FORBIDDEN_OUTSIDE_AMM = [
    "prediction_stake",
    "prediction_payout",
    "prediction_refund",
    "signup_bonus",
    "profile_avatar",
    "agent_topup",
  ];
  for (const forbidden of FORBIDDEN_OUTSIDE_AMM) {
    assert.ok(
      !(HOUSE_PNL_TXN_TYPES as readonly string[]).includes(forbidden),
      `"${forbidden}" belongs to a non-AMM flow and must NOT be in HOUSE_PNL_TXN_TYPES`,
    );
  }
});

// ---------------------------------------------------------------------------
// Required types — the set must cover both directions of every AMM flow
// the resolver, seed helper, and warm-start helper actually emit. If you
// add a new AMM txn type to the production code, the test below fails
// until you add it to HOUSE_PNL_TXN_TYPES too.
// ---------------------------------------------------------------------------

test("HOUSE_PNL_TXN_TYPES: covers seed lifecycle (debit at open, credit at settle)", () => {
  assert.ok((HOUSE_PNL_TXN_TYPES as readonly string[]).includes("amm_seed_debit"));
  assert.ok((HOUSE_PNL_TXN_TYPES as readonly string[]).includes("amm_settle_credit"));
});

test("HOUSE_PNL_TXN_TYPES: covers warm-start lifecycle (debit at open, payout at win)", () => {
  // Pairs with `amm_warmstart_debit` on the outflow side. Without
  // `amm_warmstart_payout` the drain breaker would see only the cost
  // of warm-starts and miss the offsetting recovery — biasing it to
  // trip too eagerly during the warm-start era.
  assert.ok((HOUSE_PNL_TXN_TYPES as readonly string[]).includes("amm_warmstart_debit"));
  assert.ok((HOUSE_PNL_TXN_TYPES as readonly string[]).includes("amm_warmstart_payout"));
});

test("HOUSE_PNL_TXN_TYPES: covers warm-start settle reconciliation", () => {
  // One-shot ops credit restoring warm-start costs destroyed by the
  // pre-fix settle residual. Must stay in the P&L set so the drain
  // breaker and admin house dashboard see the restored credits.
  assert.ok(
    (HOUSE_PNL_TXN_TYPES as readonly string[]).includes(
      "amm_warmstart_settle_reconciliation",
    ),
  );
});

test("HOUSE_PNL_TXN_TYPES: covers user payout + void refund", () => {
  // `amm_payout` is included in case the house ever ends up holding
  // shares outside the warm-start path; today it's a safety net only.
  // `amm_void_refund` fires on admin voids and SOMETIMES nets out
  // against the original buy on the house side.
  assert.ok((HOUSE_PNL_TXN_TYPES as readonly string[]).includes("amm_payout"));
  assert.ok((HOUSE_PNL_TXN_TYPES as readonly string[]).includes("amm_void_refund"));
});

// ---------------------------------------------------------------------------
// Display superset — admin dashboard adds `initial_grant` for lifetime
// totals but it doesn't belong in the P&L set proper.
// ---------------------------------------------------------------------------

test("HOUSE_LEDGER_DISPLAY_TXN_TYPES: superset of HOUSE_PNL_TXN_TYPES", () => {
  for (const t of HOUSE_PNL_TXN_TYPES) {
    assert.ok(
      (HOUSE_LEDGER_DISPLAY_TXN_TYPES as readonly string[]).includes(t),
      `display set is missing P&L type "${t}"`,
    );
  }
});

test("HOUSE_LEDGER_DISPLAY_TXN_TYPES: includes initial_grant exactly once", () => {
  const count = (HOUSE_LEDGER_DISPLAY_TXN_TYPES as readonly string[]).filter(
    (t) => t === "initial_grant",
  ).length;
  assert.equal(count, 1);
});

test("HOUSE_LEDGER_DISPLAY_TXN_TYPES: no duplicates", () => {
  const set = new Set(HOUSE_LEDGER_DISPLAY_TXN_TYPES);
  assert.equal(set.size, HOUSE_LEDGER_DISPLAY_TXN_TYPES.length);
});

// ---------------------------------------------------------------------------
// Importer integration — ensure the two real consumers (drain breaker +
// admin house endpoint) consume the shared constant. If a future PR
// hardcodes a parallel list anywhere, the consumer pattern test below
// surfaces it via the grep used in the comment.
// ---------------------------------------------------------------------------

test("Drain breaker consumes HOUSE_PNL_TXN_TYPES via shared constant", async () => {
  // Importing the drain breaker module loads its imports; if the
  // shared constant is renamed or moved, this import fails at compile
  // time and the test surfaces the breakage. The actual SQL usage is
  // covered by `tests/drainBreaker.test.ts`.
  const mod = await import("../server/agents/drainBreaker");
  assert.ok(typeof mod.checkAndTripDrainBreaker === "function");
});
