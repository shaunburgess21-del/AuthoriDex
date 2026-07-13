import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const {
  OTHER_OUTCOME_LABEL,
  OTHER_OUTCOME_RESIDUAL_THRESHOLD,
  isOtherStyleOutcomeLabel,
} = await import("../shared/lib/other-outcome");
const { maybeAppendOtherOutcome } = await import("../server/providers/polymarket");
const { readSourceFairByEntryId } = await import("../server/agents/sourceFair");

test("isOtherStyleOutcomeLabel matches catch-all variants", () => {
  assert.equal(isOtherStyleOutcomeLabel("Other"), true);
  assert.equal(isOtherStyleOutcomeLabel("Other candidates"), true);
  assert.equal(isOtherStyleOutcomeLabel("none of the listed"), true);
  assert.equal(isOtherStyleOutcomeLabel("None of the above"), true);
  assert.equal(isOtherStyleOutcomeLabel("The Field"), true);
  assert.equal(isOtherStyleOutcomeLabel("field"), true);
  assert.equal(isOtherStyleOutcomeLabel("Trinity Tatum"), false);
  assert.equal(isOtherStyleOutcomeLabel(""), false);
  assert.equal(isOtherStyleOutcomeLabel(null), false);
});

test("isOtherStyleOutcomeLabel rejects contestant-name false positives", () => {
  // Bare includes("field") used to match these and could mis-propose a
  // winner or block residual Other import.
  assert.equal(isOtherStyleOutcomeLabel("Greenfield"), false);
  assert.equal(isOtherStyleOutcomeLabel("Midfield"), false);
  assert.equal(isOtherStyleOutcomeLabel("Fielding"), false);
  assert.equal(isOtherStyleOutcomeLabel("Mother"), false);
  assert.equal(isOtherStyleOutcomeLabel("Brother"), false);
  assert.equal(isOtherStyleOutcomeLabel("Another"), false);
});

test("maybeAppendOtherOutcome appends residual Other on non-exhaustive multi", () => {
  process.env.SCOUT_OTHER_OUTCOME_ENABLED = "true";
  const outcomes = [
    { label: "Alice", price: 0.4, sourceMarketId: "m1", sourceOutcomeIndex: 0 },
    { label: "Bob", price: 0.35, sourceMarketId: "m2", sourceOutcomeIndex: 0 },
    { label: "Carol", price: 0.15, sourceMarketId: "m3", sourceOutcomeIndex: 0 },
  ];
  const residual = 1 - (0.4 + 0.35 + 0.15);
  assert.ok(residual >= OTHER_OUTCOME_RESIDUAL_THRESHOLD);

  const result = maybeAppendOtherOutcome(outcomes, "multi", 30);
  assert.equal(result.length, 4);
  const other = result[3];
  assert.equal(other.label, OTHER_OUTCOME_LABEL);
  assert.equal(other.isResidual, true);
  assert.equal(other.sourceMarketId, "");
  assert.ok(Math.abs(other.price - residual) < 1e-9);

  // After append, probability vector is exhaustive (~1).
  const sum = result.reduce((s, o) => s + o.price, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("maybeAppendOtherOutcome skips exhaustive multi (tiny residual)", () => {
  process.env.SCOUT_OTHER_OUTCOME_ENABLED = "true";
  const outcomes = [
    { label: "Alice", price: 0.5, sourceMarketId: "m1", sourceOutcomeIndex: 0 },
    { label: "Bob", price: 0.49, sourceMarketId: "m2", sourceOutcomeIndex: 0 },
  ];
  // residual = 0.01 < 0.03 threshold
  const result = maybeAppendOtherOutcome(outcomes, "multi", 30);
  assert.equal(result.length, 2);
  assert.ok(!result.some((o) => o.isResidual));
});

test("maybeAppendOtherOutcome skips binary and existing Other", () => {
  process.env.SCOUT_OTHER_OUTCOME_ENABLED = "true";
  const binary = [
    { label: "Yes", price: 0.6, sourceMarketId: "m1", sourceOutcomeIndex: 0 },
    { label: "No", price: 0.4, sourceMarketId: "m1", sourceOutcomeIndex: 1 },
  ];
  assert.equal(maybeAppendOtherOutcome(binary, "binary", 30).length, 2);

  const withOther = [
    { label: "Alice", price: 0.4, sourceMarketId: "m1", sourceOutcomeIndex: 0 },
    { label: "Other", price: 0.3, sourceMarketId: "m2", sourceOutcomeIndex: 0 },
  ];
  const result = maybeAppendOtherOutcome(withOther, "multi", 30);
  assert.equal(result.length, 2);
  assert.ok(!result.some((o) => o.isResidual));
});

test("maybeAppendOtherOutcome does not treat Greenfield as existing Other", () => {
  process.env.SCOUT_OTHER_OUTCOME_ENABLED = "true";
  const outcomes = [
    { label: "Alice", price: 0.4, sourceMarketId: "m1", sourceOutcomeIndex: 0 },
    { label: "Greenfield", price: 0.35, sourceMarketId: "m2", sourceOutcomeIndex: 0 },
  ];
  const result = maybeAppendOtherOutcome(outcomes, "multi", 30);
  assert.equal(result.length, 3);
  assert.equal(result[2].label, OTHER_OUTCOME_LABEL);
  assert.equal(result[2].isResidual, true);
});

test("maybeAppendOtherOutcome respects kill switch", () => {
  process.env.SCOUT_OTHER_OUTCOME_ENABLED = "false";
  const outcomes = [
    { label: "Alice", price: 0.4, sourceMarketId: "m1", sourceOutcomeIndex: 0 },
    { label: "Bob", price: 0.3, sourceMarketId: "m2", sourceOutcomeIndex: 0 },
  ];
  assert.equal(maybeAppendOtherOutcome(outcomes, "multi", 30).length, 2);
  delete process.env.SCOUT_OTHER_OUTCOME_ENABLED;
});

test("readSourceFairByEntryId anchors markets that include residual Other", () => {
  const metadata = {
    source: {
      provider: "polymarket",
      outcomeMapping: [
        { entryLabel: "Alice", sourceLabel: "Alice", sourceMarketId: "m1", sourceOutcomeIndex: 0 },
        { entryLabel: "Bob", sourceLabel: "Bob", sourceMarketId: "m2", sourceOutcomeIndex: 0 },
        {
          entryLabel: "Other",
          sourceLabel: "Other",
          sourceMarketId: "",
          sourceOutcomeIndex: 0,
          isResidual: true,
        },
      ],
      pricesAtImport: [0.45, 0.35, 0.2],
      fetchedAt: "2026-07-13T00:00:00.000Z",
    },
  };
  const entries = [
    { id: "e1", label: "Alice" },
    { id: "e2", label: "Bob" },
    { id: "e3", label: "Other" },
  ];
  const fair = readSourceFairByEntryId(metadata, entries);
  assert.ok(fair);
  assert.equal(fair!.anchor, "import");
  const sum = fair!.fairByEntryId.e1 + fair!.fairByEntryId.e2 + fair!.fairByEntryId.e3;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(fair!.fairByEntryId.e3 > 0);
});

test("readSourceFairByEntryId still works when Other is reordered in entries", () => {
  const metadata = {
    source: {
      provider: "polymarket",
      outcomeMapping: [
        { entryLabel: "Alice", sourceLabel: "Alice", sourceMarketId: "m1", sourceOutcomeIndex: 0 },
        { entryLabel: "Other", sourceLabel: "Other", sourceMarketId: "", sourceOutcomeIndex: 0, isResidual: true },
        { entryLabel: "Bob", sourceLabel: "Bob", sourceMarketId: "m2", sourceOutcomeIndex: 0 },
      ],
      pricesAtImport: [0.5, 0.2, 0.3],
      fetchedAt: "2026-07-13T00:00:00.000Z",
    },
  };
  // Entries in different order than mapping — label match must still work.
  const entries = [
    { id: "e-other", label: "Other" },
    { id: "e-bob", label: "Bob" },
    { id: "e-alice", label: "Alice" },
  ];
  const fair = readSourceFairByEntryId(metadata, entries);
  assert.ok(fair);
  assert.equal(Object.keys(fair!.fairByEntryId).sort().join(","), "e-alice,e-bob,e-other");
  // Alice (0.5) should remain highest after clamp+renormalize.
  assert.ok(fair!.fairByEntryId["e-alice"] > fair!.fairByEntryId["e-bob"]);
  assert.ok(fair!.fairByEntryId["e-bob"] > fair!.fairByEntryId["e-other"]);
});
