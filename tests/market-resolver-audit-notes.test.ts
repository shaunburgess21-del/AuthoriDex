/**
 * Unit tests for `buildAmmResolutionNotes` (Phase A3).
 *
 * The seed-return drift health check (server/jobs/amm-health.ts::
 * checkSeedReturnDrift) filters resolved AMM markets on:
 *
 *   resolution_notes::jsonb ? 'creditedToHouse' AND ? 'payoutLiability'
 *
 * Before A3, the auto-resolver wrote `{evidence, outcome, engine}` only —
 * those two keys were never present, so every native auto-resolved market
 * was silently excluded from the audit. These tests pin the helper that
 * every native auto-resolve path now flows through, so a future refactor
 * can't quietly drop the audit fields again.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const { _buildAmmResolutionNotesForTesting: buildAmmResolutionNotes } = await import(
  "../server/jobs/market-resolver"
);

import type { ResolveAmmMarketResult } from "../server/services/amm-resolver";

function ammSettlement(overrides: Partial<ResolveAmmMarketResult> = {}): ResolveAmmMarketResult {
  return {
    marketId: "m-1",
    outcome: "resolved",
    winnerEntryId: "e-1",
    payoutLiability: 1234,
    creditedToHouse: 567,
    settledUserCount: 12,
    idempotentSkip: false,
    ...overrides,
  };
}

test("includes creditedToHouse and payoutLiability — the audit-required keys", () => {
  const evidence = { type: "updown", openScore: 100, closeScore: 110 };
  const notes = buildAmmResolutionNotes(evidence, "Up", ammSettlement());
  assert.equal(notes.creditedToHouse, 567);
  assert.equal(notes.payoutLiability, 1234);
});

test("preserves the evidence payload (so resolution-summary cards keep working)", () => {
  const evidence = {
    type: "h2h",
    entryA: { personId: "p-a", label: "Alice", score: 90 },
    entryB: { personId: "p-b", label: "Bob", score: 80 },
  };
  const notes = buildAmmResolutionNotes(evidence, "Alice", ammSettlement());
  assert.equal((notes as any).type, "h2h");
  assert.deepEqual((notes as any).entryA, evidence.entryA);
  assert.deepEqual((notes as any).entryB, evidence.entryB);
});

test("stamps engine='amm' and the resolved outcome string", () => {
  const notes = buildAmmResolutionNotes({}, "Down", ammSettlement());
  assert.equal(notes.engine, "amm");
  assert.equal(notes.outcome, "Down");
});

test("works for the void path (zero credited to house, refund-equal payout)", () => {
  const notes = buildAmmResolutionNotes(
    { type: "h2h", reason: "tie" },
    "void_tie",
    ammSettlement({ outcome: "voided", creditedToHouse: 0, payoutLiability: 850 }),
  );
  assert.equal(notes.creditedToHouse, 0);
  assert.equal(notes.payoutLiability, 850);
  assert.equal(notes.outcome, "void_tie");
});

test("works for negative house P&L (LMSR loss bounded by b·ln(N))", () => {
  // Real-world failure mode: a market where the house's LMSR cost
  // function exceeded user buys, producing a negative net house P&L.
  // The audit must still see it (no filtering on sign).
  const notes = buildAmmResolutionNotes({}, "Up", ammSettlement({ creditedToHouse: -42 }));
  assert.equal(notes.creditedToHouse, -42);
});

test("settledUserCount is present so admin views can summarise without a re-query", () => {
  const notes = buildAmmResolutionNotes({}, "Alice", ammSettlement({ settledUserCount: 7 }));
  assert.equal(notes.settledUserCount, 7);
});

test("evidence keys do not override the audit keys (defence-in-depth)", () => {
  // If a future evidence builder accidentally includes a key with the
  // same name, the helper's audit values must win — this is the only
  // place we can guarantee the audit fields reflect the actual
  // ammSettlement result, not a stale value carried in evidence.
  const evidence = {
    type: "updown",
    creditedToHouse: 9999, // bogus
    payoutLiability: 9999, // bogus
  };
  const notes = buildAmmResolutionNotes(evidence, "Up", ammSettlement());
  assert.equal(notes.creditedToHouse, 567);
  assert.equal(notes.payoutLiability, 1234);
});

test("output is JSON-serialisable (we round-trip through JSON.stringify in the resolver)", () => {
  const notes = buildAmmResolutionNotes(
    { type: "gainer", rankings: [{ label: "Alice", pctChange: "12.34%" }] },
    "Alice",
    ammSettlement(),
  );
  const json = JSON.stringify(notes);
  const parsed = JSON.parse(json);
  assert.equal(parsed.creditedToHouse, 567);
  assert.equal(parsed.payoutLiability, 1234);
  assert.equal(parsed.outcome, "Alice");
  assert.equal(parsed.engine, "amm");
});
