import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL before any import that could transitively load
// server/db.ts. Same pattern as tests/amm-house.test.ts.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { readSourceFairByEntryId } = await import("../server/agents/sourceFair");
const { computeArbPredictionCommunity } = await import("../server/agents/arbAgent");
const { COMMUNITY_ARB_MIN_EDGE_PP } = await import("../server/agents/constants");

// ---------------------------------------------------------------------------
// readSourceFairByEntryId
// ---------------------------------------------------------------------------

const entries = [
  { id: "e-yes", label: "Yes" },
  { id: "e-no", label: "No" },
];

function scoutedMeta(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      provider: "polymarket",
      externalId: "12345",
      outcomeMapping: [
        { entryLabel: "Yes", sourceLabel: "Yes" },
        { entryLabel: "No", sourceLabel: "No" },
      ],
      pricesAtImport: [0.7, 0.3],
      fetchedAt: "2026-07-01T00:00:00.000Z",
      ...overrides,
    },
  };
}

test("sourceFair maps import prices to entries by label", () => {
  const result = readSourceFairByEntryId(scoutedMeta(), entries)!;
  assert.ok(result);
  assert.equal(result.anchor, "import");
  assert.ok(Math.abs(result.fairByEntryId["e-yes"] - 0.7) < 1e-9);
  assert.ok(Math.abs(result.fairByEntryId["e-no"] - 0.3) < 1e-9);
});

test("sourceFair prefers livePrices over pricesAtImport", () => {
  const meta = scoutedMeta({
    livePrices: [0.9, 0.1],
    livePricesAt: "2026-07-03T00:00:00.000Z",
  });
  const result = readSourceFairByEntryId(meta, entries)!;
  assert.equal(result.anchor, "live");
  assert.equal(result.anchorAt, "2026-07-03T00:00:00.000Z");
  assert.ok(Math.abs(result.fairByEntryId["e-yes"] - 0.9) < 1e-9);
});

test("sourceFair follows entries even when reordered (label-matched)", () => {
  const reordered = [entries[1], entries[0]]; // No first
  const result = readSourceFairByEntryId(scoutedMeta(), reordered)!;
  assert.ok(result);
  assert.ok(Math.abs(result.fairByEntryId["e-yes"] - 0.7) < 1e-9);
  assert.ok(Math.abs(result.fairByEntryId["e-no"] - 0.3) < 1e-9);
});

test("sourceFair normalizes prices to sum 1 and clamps extremes", () => {
  const meta = scoutedMeta({ pricesAtImport: [0.999, 0.001] });
  const result = readSourceFairByEntryId(meta, entries)!;
  const sum = Object.values(result.fairByEntryId).reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(result.fairByEntryId["e-no"] >= 0.014); // clamped away from 0
});

test("sourceFair rejects unusable metadata", () => {
  // Not scouted.
  assert.equal(readSourceFairByEntryId(null, entries), null);
  assert.equal(readSourceFairByEntryId({}, entries), null);
  assert.equal(readSourceFairByEntryId({ source: { provider: "other" } }, entries), null);
  // Upstream already resolved — anchor deactivates.
  assert.equal(
    readSourceFairByEntryId(scoutedMeta({ upstreamResolvedAt: "2026-07-02T00:00:00.000Z" }), entries),
    null,
  );
  // Renamed entry beyond recognition.
  assert.equal(
    readSourceFairByEntryId(scoutedMeta(), [
      { id: "e-yes", label: "Definitely" },
      { id: "e-no", label: "No" },
    ]),
    null,
  );
  // Entry count drift.
  assert.equal(readSourceFairByEntryId(scoutedMeta(), [entries[0]]), null);
  // Malformed price vectors.
  assert.equal(readSourceFairByEntryId(scoutedMeta({ pricesAtImport: [0.7] }), entries), null);
  assert.equal(readSourceFairByEntryId(scoutedMeta({ pricesAtImport: [0.7, NaN] }), entries), null);
  // Duplicate labels are ambiguous.
  assert.equal(
    readSourceFairByEntryId(scoutedMeta(), [
      { id: "a", label: "Yes" },
      { id: "b", label: "Yes" },
    ]),
    null,
  );
});

test("sourceFair falls back to import when livePrices malformed", () => {
  const meta = scoutedMeta({ livePrices: [0.9] }); // wrong length
  const result = readSourceFairByEntryId(meta, entries)!;
  assert.equal(result.anchor, "import");
});

// ---------------------------------------------------------------------------
// computeArbPredictionCommunity
// ---------------------------------------------------------------------------

const entryData = [
  { id: "e-yes", label: "Yes", totalStake: 0 },
  { id: "e-no", label: "No", totalStake: 0 },
];

test("community arb buys the most underpriced outcome", () => {
  // Fair 0.7/0.3, market prices 0.5/0.5 → Yes underpriced by 0.2.
  const decision = computeArbPredictionCommunity(
    entryData,
    { "e-yes": 0.7, "e-no": 0.3 },
    { "e-yes": 0.5, "e-no": 0.5 },
    { minEdgePp: COMMUNITY_ARB_MIN_EDGE_PP },
  );
  assert.equal(decision.abstain, false);
  assert.equal(decision.entryId, "e-yes");
  assert.equal(decision.direction, "yes");
  assert.ok(Math.abs((decision.edge ?? 0) - 0.2) < 1e-9);
  assert.ok(Math.abs((decision.confidence ?? 0) - 0.7) < 1e-9);
});

test("community arb corrects an overpriced favorite by buying the other side", () => {
  // Fair 0.7/0.3 but the favorite trades at 0.95 → No is the underpriced side.
  const decision = computeArbPredictionCommunity(
    entryData,
    { "e-yes": 0.7, "e-no": 0.3 },
    { "e-yes": 0.95, "e-no": 0.05 },
    { minEdgePp: COMMUNITY_ARB_MIN_EDGE_PP },
  );
  assert.equal(decision.abstain, false);
  assert.equal(decision.entryId, "e-no");
});

test("community arb abstains below the edge bar", () => {
  const decision = computeArbPredictionCommunity(
    entryData,
    { "e-yes": 0.7, "e-no": 0.3 },
    { "e-yes": 0.68, "e-no": 0.32 }, // 2pp edge < 6pp bar
    { minEdgePp: COMMUNITY_ARB_MIN_EDGE_PP },
  );
  assert.equal(decision.abstain, true);
  assert.equal(decision.abstainReason, "low_edge");
});

test("community arb handles multi-outcome markets", () => {
  const multi = [
    { id: "a", label: "A", totalStake: 0 },
    { id: "b", label: "B", totalStake: 0 },
    { id: "c", label: "C", totalStake: 0 },
  ];
  const decision = computeArbPredictionCommunity(
    multi,
    { a: 0.6, b: 0.3, c: 0.1 },
    { a: 0.34, b: 0.33, c: 0.33 },
    { minEdgePp: 0.06 },
  );
  assert.equal(decision.abstain, false);
  assert.equal(decision.entryId, "a"); // biggest fair-minus-price
});

test("community arb abstains on degenerate inputs", () => {
  assert.equal(
    computeArbPredictionCommunity([entryData[0]], { "e-yes": 0.9 }, {}).abstain,
    true,
  );
  assert.equal(
    computeArbPredictionCommunity(entryData, {}, { "e-yes": 0.5, "e-no": 0.5 }).abstain,
    true,
  );
});

test("community arb confidence is capped below 1", () => {
  const decision = computeArbPredictionCommunity(
    entryData,
    { "e-yes": 0.999, "e-no": 0.001 },
    { "e-yes": 0.5, "e-no": 0.5 },
    { minEdgePp: 0.06 },
  );
  assert.equal(decision.abstain, false);
  assert.ok((decision.confidence ?? 1) <= 0.985);
});
