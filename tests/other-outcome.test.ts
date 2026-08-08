import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const {
  OTHER_OUTCOME_LABEL,
  OTHER_OUTCOME_RESIDUAL_THRESHOLD,
  isOtherStyleOutcomeLabel,
  isPlaceholderOutcomeLabel,
  computeOtherOutcomeAdvice,
  detectCumulativeLadder,
} = await import("../shared/lib/other-outcome");
const { maybeAppendOtherOutcome, detectAugmentedNegRisk, isUnsettleableLadder } =
  await import("../server/providers/polymarket");
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

test("isPlaceholderOutcomeLabel matches augmented-negRisk slots only", () => {
  assert.equal(isPlaceholderOutcomeLabel("Movie B"), true);
  assert.equal(isPlaceholderOutcomeLabel("Person A"), true);
  assert.equal(isPlaceholderOutcomeLabel("Team 1"), true);
  assert.equal(isPlaceholderOutcomeLabel("Candidate C"), true);
  assert.equal(isPlaceholderOutcomeLabel("Movie O"), true);
  assert.equal(isPlaceholderOutcomeLabel("Movie Night"), false);
  assert.equal(isPlaceholderOutcomeLabel("Avengers: Doomsday"), false);
  // Real short names must NOT be treated as placeholders (single-char only).
  assert.equal(isPlaceholderOutcomeLabel("Team USA"), false);
  assert.equal(isPlaceholderOutcomeLabel("Team GB"), false);
  assert.equal(isPlaceholderOutcomeLabel("Movie 10"), false);
  assert.equal(isPlaceholderOutcomeLabel(""), false);
  assert.equal(isPlaceholderOutcomeLabel(null), false);
});

test("maybeAppendOtherOutcome force appends Other even on an exhaustive book", () => {
  process.env.SCOUT_OTHER_OUTCOME_ENABLED = "true";
  const outcomes = [
    { label: "Alice", price: 0.5, sourceMarketId: "m1", sourceOutcomeIndex: 0 },
    { label: "Bob", price: 0.49, sourceMarketId: "m2", sourceOutcomeIndex: 0 },
    { label: "Carol", price: 0.005, sourceMarketId: "m3", sourceOutcomeIndex: 0 },
  ];
  // residual ~0.005 < threshold — no append without force.
  assert.equal(maybeAppendOtherOutcome(outcomes, "multi", 30).length, 3);
  // With force (augmented negRisk source), Other is appended anyway.
  const forced = maybeAppendOtherOutcome(outcomes, "multi", 30, { force: true });
  assert.equal(forced.length, 4);
  assert.equal(forced[3].label, OTHER_OUTCOME_LABEL);
  assert.equal(forced[3].isResidual, true);
  assert.ok(forced[3].price >= 0);
});

test("detectAugmentedNegRisk finds explicit Other and placeholder slots", () => {
  const ev = {
    negRisk: true,
    markets: [
      { groupItemTitle: "Avengers: Doomsday" },
      { groupItemTitle: "Spider-Man: Brand New Day" },
      { groupItemTitle: "Movie B" },
      { groupItemTitle: "Movie C" },
      { groupItemTitle: "Other" },
    ],
  };
  const res = detectAugmentedNegRisk(ev as any);
  assert.equal(res.augmented, true);
  assert.equal(res.hasExplicitOther, true);
  assert.equal(res.placeholderCount, 2);
});

test("detectAugmentedNegRisk is inert for a closed negRisk field", () => {
  const ev = {
    negRisk: true,
    markets: [
      { groupItemTitle: "Last Week Tonight" },
      { groupItemTitle: "Jimmy Kimmel Live!" },
      { groupItemTitle: "Saturday Night Live" },
    ],
  };
  const res = detectAugmentedNegRisk(ev as any);
  assert.equal(res.augmented, false);
  assert.equal(res.placeholderCount, 0);
  assert.equal(res.hasExplicitOther, false);
});

test("computeOtherOutcomeAdvice recommends Other for augmented negRisk", () => {
  const advice = computeOtherOutcomeAdvice({
    structure: "multi",
    entryLabels: ["Avengers: Doomsday", "Spider-Man", "Toy Story 5", "Dune: Messiah"],
    namedPriceSum: 0.953,
    augmentedNegRisk: true,
    hasExplicitOther: true,
    placeholderCount: 14,
    title: "Which 2026 movie will have the biggest opening weekend?",
  });
  assert.equal(advice.recommended, true);
  assert.equal(advice.signal, "augmented_negrisk");
  assert.equal(advice.hasOther, false);
});

test("computeOtherOutcomeAdvice recommends Other on a large residual", () => {
  const advice = computeOtherOutcomeAdvice({
    structure: "multi",
    entryLabels: ["Alice", "Bob", "Carol"],
    namedPriceSum: 0.9,
    title: "Who wins the thing?",
  });
  assert.equal(advice.recommended, true);
  assert.equal(advice.signal, "residual");
});

test("computeOtherOutcomeAdvice uses semantic title signal without prices", () => {
  const advice = computeOtherOutcomeAdvice({
    structure: "multi",
    entryLabels: ["Movie 1", "Movie 2", "Movie 3"],
    title: "Which movie will have the biggest box office in 2027?",
  });
  assert.equal(advice.recommended, true);
  assert.equal(advice.signal, "semantic");
});

test("computeOtherOutcomeAdvice stays quiet on closed / binary fields", () => {
  const nominees = computeOtherOutcomeAdvice({
    structure: "multi",
    entryLabels: ["Last Week Tonight", "Jimmy Kimmel Live!", "Saturday Night Live", "The Daily Show"],
    namedPriceSum: 1.0,
    title: "Which show wins the 2026 Emmy for Outstanding Variety Series?",
  });
  assert.equal(nominees.recommended, false);

  const alreadyHasOther = computeOtherOutcomeAdvice({
    structure: "multi",
    entryLabels: ["Alice", "Bob", "Other"],
    namedPriceSum: 0.8,
  });
  assert.equal(alreadyHasOther.recommended, false);
  assert.equal(alreadyHasOther.hasOther, true);

  const binary = computeOtherOutcomeAdvice({
    structure: "binary",
    entryLabels: ["Yes", "No"],
    title: "Will the biggest thing happen?",
  });
  assert.equal(binary.recommended, false);
});

// ---------------------------------------------------------------------------
// Cumulative ladder detection. Fixtures are the real Polymarket shapes that
// produced unsettleable VoxDex markets (Iran withdrawal, Alito retirement,
// Bieber listeners) plus the exclusive fields that must NOT be flagged.
// ---------------------------------------------------------------------------

test("detectCumulativeLadder flags a date ladder of independent binaries", () => {
  const res = detectCumulativeLadder({
    labels: ["August 15", "July 31", "July 24", "July 17"],
    prices: [0.395, 0.305, 0.255, 0.17],
    sourceEndDates: [
      "2026-08-15T23:59:00.000Z",
      "2026-07-31T23:59:00.000Z",
      "2026-07-24T23:59:00.000Z",
      "2026-07-17T23:59:00.000Z",
    ],
    mutuallyExclusiveSource: false,
  });
  assert.equal(res.isLadder, true);
  assert.ok(res.signals.includes("independent_binaries"));
  assert.ok(res.signals.includes("distinct_end_dates"));
  assert.ok(res.signals.includes("oversubscribed"));
  // Ordered earliest rung first, regardless of the price-desc input order.
  assert.deepEqual(res.order, [3, 2, 1, 0]);
});

test("detectCumulativeLadder flags a threshold ladder that is not over-subscribed", () => {
  // Bieber: Σ = 0.994, so the residual guard saw nothing wrong. Only the
  // monotone threshold rungs give it away.
  const res = detectCumulativeLadder({
    labels: ["↑ 130m", "↑ 140m", "↑ 150m", "↑ 160m"],
    prices: [0.53, 0.33, 0.085, 0.049],
    sourceEndDates: new Array(4).fill("2026-08-31T23:59:00.000Z"),
    mutuallyExclusiveSource: false,
  });
  assert.equal(res.isLadder, true);
  assert.ok(res.signals.includes("cumulative_labels"));
  assert.ok(res.signals.includes("monotone_prices"));
  assert.ok(!res.signals.includes("oversubscribed"));
});

test("detectCumulativeLadder flags a date ladder with mixed explicit years", () => {
  // Alito: "June 30, 2027" sorts before "December 31" on label text alone, so
  // no order is established — the verdict must still come from the structural
  // and over-subscription signals.
  const res = detectCumulativeLadder({
    labels: ["June 30, 2027", "December 31", "September 30", "July 15"],
    prices: [0.535, 0.315, 0.2, 0.0895],
    sourceEndDates: [
      "2027-06-30T23:59:00.000Z",
      "2026-12-31T23:59:00.000Z",
      "2026-12-31T23:59:00.000Z",
      "2026-12-31T23:59:00.000Z",
    ],
    mutuallyExclusiveSource: false,
  });
  assert.equal(res.isLadder, true);
  assert.ok(res.signals.includes("oversubscribed"));
  // Shared end dates cannot order the rungs.
  assert.ok(!res.signals.includes("distinct_end_dates"));
  assert.equal(res.order, null);
});

test("detectCumulativeLadder flags a two-rung ladder", () => {
  const res = detectCumulativeLadder({
    labels: ["September Meeting", "October Meeting"],
    prices: [0.63, 0.51],
    mutuallyExclusiveSource: false,
  });
  assert.equal(res.isLadder, true);
});

test("detectCumulativeLadder ignores an over-subscribed exclusive field", () => {
  // Emmy nominees at Σ = 1.125 from bid/ask mid — exclusive, needs no
  // catch-all. Price sum alone must never drive the verdict.
  const res = detectCumulativeLadder({
    labels: ["Hacks", "Widow's Bay", "Shrinking", "The Bear", "Abbott Elementary"],
    prices: [0.36, 0.3, 0.2, 0.15, 0.115],
    sourceEndDates: new Array(5).fill("2026-09-14T20:00:00.000Z"),
    mutuallyExclusiveSource: true,
  });
  assert.equal(res.isLadder, false);
});

test("detectCumulativeLadder ignores exhaustive band partitions", () => {
  // Ranges and a "<15m" lower tail mean the set already covers every case.
  const res = detectCumulativeLadder({
    labels: ["<15m", "15-20m", "20-25m", "25-30m", "30m+"],
    prices: [0.1, 0.35, 0.28, 0.17, 0.1],
    mutuallyExclusiveSource: true,
  });
  assert.equal(res.isLadder, false);
  assert.match(res.reason, /band partition/i);
});

test("detectCumulativeLadder ignores point-value outcomes without direction markers", () => {
  const res = detectCumulativeLadder({
    labels: ["No change", "25 bps increase", "25 bps decrease", "50+ bps decrease"],
    prices: [0.6, 0.15, 0.2, 0.06],
    mutuallyExclusiveSource: false,
  });
  assert.equal(res.isLadder, false);
});

test("detectCumulativeLadder ignores name fields and existing catch-alls", () => {
  const names = detectCumulativeLadder({
    labels: ["Sofia", "Burgas", "Varna", "Plovdiv"],
    prices: [0.6, 0.2, 0.12, 0.09],
    mutuallyExclusiveSource: false,
  });
  assert.equal(names.isLadder, false);

  // The catch-all itself must not be read as a rung.
  const laddered = detectCumulativeLadder({
    labels: ["August 31", "October 31", "December 31", "Other"],
    prices: [0.2, 0.15, 0.1, 0.55],
    mutuallyExclusiveSource: false,
  });
  assert.equal(laddered.isLadder, true);
  assert.deepEqual(laddered.order, [0, 1, 2]);
});

test("computeOtherOutcomeAdvice recommends Other for a cumulative ladder", () => {
  const advice = computeOtherOutcomeAdvice({
    structure: "multi",
    entryLabels: ["August 15", "July 31", "July 24", "July 17"],
    namedPriceSum: 1.125,
    prices: [0.395, 0.305, 0.255, 0.17],
    sourceEndDates: [
      "2026-08-15T23:59:00.000Z",
      "2026-07-31T23:59:00.000Z",
      "2026-07-24T23:59:00.000Z",
      "2026-07-17T23:59:00.000Z",
    ],
    mutuallyExclusiveSource: false,
    title: "When will Iran announce it is quitting the current U.S. talks?",
  });
  assert.equal(advice.recommended, true);
  assert.equal(advice.signal, "cumulative_ladder");
  // The clamped residual is still 0 — but it must no longer read as complete.
  assert.equal(advice.residual, 0);
  assert.equal(advice.oversubscribed, true);
  assert.equal(advice.namedPriceSum, 1.125);
});

test("computeOtherOutcomeAdvice never calls an over-subscribed book complete", () => {
  const advice = computeOtherOutcomeAdvice({
    structure: "multi",
    entryLabels: ["Alpha", "Beta", "Gamma", "Delta"],
    namedPriceSum: 1.09,
    mutuallyExclusiveSource: false,
    title: "Some field",
  });
  assert.equal(advice.recommended, false);
  assert.equal(advice.oversubscribed, true);
  assert.doesNotMatch(advice.reason, /look complete/i);
  assert.match(advice.reason, /not mutually exclusive/i);
});

test("computeOtherOutcomeAdvice advises on a hand-built date ladder with no prices", () => {
  const advice = computeOtherOutcomeAdvice({
    structure: "multi",
    entryLabels: ["July 15", "September 30", "December 31"],
    title: "When will the thing happen?",
  });
  assert.equal(advice.recommended, true);
  assert.equal(advice.signal, "cumulative_ladder");
});

test("import gate skips the ladders that produced unsettleable markets", () => {
  process.env.SCOUT_OTHER_OUTCOME_ENABLED = "true";

  // Price vectors are the real `metadata.source.pricesAtImport` from each
  // market, i.e. what the scout saw on the day it created them.
  const fixtures: Array<{
    name: string;
    labels: string[];
    prices: number[];
    endDates?: Array<string | null>;
    negRisk: boolean;
    expectSkip: boolean;
  }> = [
    {
      name: "Iran quitting talks",
      labels: ["August 15", "July 31", "July 24", "July 17"],
      prices: [0.395, 0.305, 0.255, 0.17],
      endDates: [
        "2026-08-15T23:59:00.000Z",
        "2026-07-31T23:59:00.000Z",
        "2026-07-24T23:59:00.000Z",
        "2026-07-17T23:59:00.000Z",
      ],
      negRisk: false,
      expectSkip: true,
    },
    {
      name: "Alito retirement",
      labels: ["June 30, 2027", "December 31", "September 30", "July 15"],
      prices: [0.535, 0.315, 0.2, 0.0895],
      negRisk: false,
      expectSkip: true,
    },
    {
      // Σ = 0.994 — the residual guard saw nothing wrong here.
      name: "Bieber listeners",
      labels: ["↑ 130m", "↑ 140m", "↑ 150m", "↑ 160m"],
      prices: [0.53, 0.33, 0.085, 0.049],
      negRisk: false,
      expectSkip: true,
    },
    {
      name: "Rotten Tomatoes score",
      labels: ["50+", "55+", "60+", "70+", "80+", "90+"],
      prices: [0.34, 0.26, 0.2, 0.14, 0.09, 0.045],
      negRisk: false,
      expectSkip: true,
    },
    {
      // Exclusive nominee field at the same Σ = 1.125 as the Iran ladder.
      name: "Emmy Outstanding Comedy Series",
      labels: ["Hacks", "Widow's Bay", "Shrinking", "The Bear", "Abbott Elementary"],
      prices: [0.36, 0.3, 0.2, 0.15, 0.115],
      negRisk: true,
      expectSkip: false,
    },
    {
      // Ladder whose source book left room for a residual catch-all.
      name: "Hormuz fees",
      labels: ["August 31", "October 31", "December 31", "September 30"],
      prices: [0.2, 0.15, 0.1, 0.12],
      negRisk: false,
      expectSkip: false,
    },
  ];

  for (const f of fixtures) {
    const named = f.labels
      .map((label, i) => ({
        label,
        price: f.prices[i],
        sourceMarketId: `m${i}`,
        sourceOutcomeIndex: 0,
        sourceEndDate: f.endDates?.[i] ?? null,
      }))
      .sort((a, b) => b.price - a.price);

    const ladder = detectCumulativeLadder({
      labels: named.map((o) => o.label),
      prices: named.map((o) => o.price),
      sourceEndDates: named.map((o) => o.sourceEndDate),
      mutuallyExclusiveSource: f.negRisk,
    });
    const withOther = maybeAppendOtherOutcome(named, "multi", 12);

    assert.equal(
      isUnsettleableLadder(withOther, ladder),
      f.expectSkip,
      `${f.name}: expected skip=${f.expectSkip}`,
    );
  }

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

test("readSourceFairByEntryId synthesizes orphan Other when entries = mapping + 1", () => {
  const metadata = {
    source: {
      provider: "polymarket",
      outcomeMapping: [
        { entryLabel: "Alice", sourceLabel: "Alice", sourceMarketId: "m1", sourceOutcomeIndex: 0 },
        { entryLabel: "Bob", sourceLabel: "Bob", sourceMarketId: "m2", sourceOutcomeIndex: 0 },
      ],
      pricesAtImport: [0.6, 0.3],
      fetchedAt: "2026-07-13T00:00:00.000Z",
    },
  };
  const entries = [
    { id: "e1", label: "Alice" },
    { id: "e2", label: "Bob" },
    { id: "e3", label: "Other" },
  ];
  const fair = readSourceFairByEntryId(metadata, entries);
  assert.ok(fair, "orphan Other should still produce an anchor");
  assert.equal(fair!.anchor, "import");
  const sum = fair!.fairByEntryId.e1 + fair!.fairByEntryId.e2 + fair!.fairByEntryId.e3;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(fair!.fairByEntryId.e1 > fair!.fairByEntryId.e2);
  assert.ok(fair!.fairByEntryId.e3 > 0);
});

test("readSourceFairByEntryId skips residual mapping when entry was removed", () => {
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
      pricesAtImport: [0.5, 0.35, 0.15],
      fetchedAt: "2026-07-13T00:00:00.000Z",
    },
  };
  const entries = [
    { id: "e1", label: "Alice" },
    { id: "e2", label: "Bob" },
  ];
  const fair = readSourceFairByEntryId(metadata, entries);
  assert.ok(fair, "removed Other entry should still produce an anchor");
  assert.equal(Object.keys(fair!.fairByEntryId).sort().join(","), "e1,e2");
  const sum = fair!.fairByEntryId.e1 + fair!.fairByEntryId.e2;
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("reconcileSourceMappingWithEntries appends residual Other on add", async () => {
  const { reconcileSourceMappingWithEntries } = await import("../server/agents/sourceSync");
  const source = {
    provider: "polymarket",
    outcomeMapping: [
      { entryLabel: "Alice", sourceLabel: "Alice", sourceMarketId: "m1", sourceOutcomeIndex: 0 },
      { entryLabel: "Bob", sourceLabel: "Bob", sourceMarketId: "m2", sourceOutcomeIndex: 0 },
    ],
    pricesAtImport: [0.55, 0.35],
    livePrices: [0.6, 0.3],
  };
  const patched = reconcileSourceMappingWithEntries(source, [
    { label: "Alice" },
    { label: "Bob" },
    { label: "Other" },
  ]);
  assert.ok(patched);
  assert.equal((patched!.outcomeMapping as unknown[]).length, 3);
  const residual = (patched!.outcomeMapping as Array<{ isResidual?: boolean }>).at(-1);
  assert.equal(residual?.isResidual, true);
  assert.equal((patched!.pricesAtImport as number[]).length, 3);
  assert.equal((patched!.livePrices as number[]).length, 3);
  assert.ok(Math.abs((patched!.pricesAtImport as number[])[2] - 0.1) < 1e-9);
});

test("reconcileSourceMappingWithEntries fails closed when prices cannot be extended", async () => {
  const { reconcileSourceMappingWithEntries } = await import("../server/agents/sourceSync");
  const source = {
    provider: "polymarket",
    outcomeMapping: [
      { entryLabel: "Alice", sourceLabel: "Alice", sourceMarketId: "m1", sourceOutcomeIndex: 0 },
      { entryLabel: "Bob", sourceLabel: "Bob", sourceMarketId: "m2", sourceOutcomeIndex: 0 },
    ],
    // Missing / wrong-length price vectors — must not patch mapping alone.
    pricesAtImport: [0.5],
  };
  const patched = reconcileSourceMappingWithEntries(source, [
    { label: "Alice" },
    { label: "Bob" },
    { label: "Other" },
  ]);
  assert.equal(patched, null);
});

test("reconcileSourceMappingWithEntries drops residual Other on remove", async () => {
  const { reconcileSourceMappingWithEntries } = await import("../server/agents/sourceSync");
  const source = {
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
    pricesAtImport: [0.5, 0.35, 0.15],
    livePrices: [0.5, 0.4, 0.1],
  };
  const patched = reconcileSourceMappingWithEntries(source, [
    { label: "Alice" },
    { label: "Bob" },
  ]);
  assert.ok(patched);
  assert.equal((patched!.outcomeMapping as unknown[]).length, 2);
  assert.deepEqual(patched!.pricesAtImport, [0.5, 0.35]);
  assert.deepEqual(patched!.livePrices, [0.5, 0.4]);
});

test("detectSourceAnchorDesync flags entry/mapping mismatch", async () => {
  const { detectSourceAnchorDesync } = await import("../server/agents/sourceSync");
  const rows = detectSourceAnchorDesync([
    {
      marketId: "m1",
      title: "Broken Emmy",
      entryCount: 9,
      metadata: {
        scoutedByMarketScout: true,
        source: {
          provider: "polymarket",
          outcomeMapping: new Array(8).fill({ entryLabel: "x" }),
          pricesAtImport: new Array(8).fill(0.1),
          livePrices: new Array(8).fill(0.1),
        },
      },
    },
    {
      marketId: "m2",
      title: "Healthy",
      entryCount: 3,
      metadata: {
        scoutedByMarketScout: true,
        source: {
          provider: "polymarket",
          outcomeMapping: [{}, {}, {}],
          livePrices: [0.3, 0.3, 0.4],
        },
      },
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].marketId, "m1");
  assert.equal(rows[0].reason, "entry_mapping_mismatch");
  assert.equal(rows[0].anchorable, true); // ±1 length gap is healable without labels
});

test("detectSourceAnchorDesync marks healable orphan Other as anchorable", async () => {
  const { detectSourceAnchorDesync } = await import("../server/agents/sourceSync");
  const metadata = {
    scoutedByMarketScout: true,
    source: {
      provider: "polymarket",
      outcomeMapping: [
        { entryLabel: "Alice", sourceLabel: "Alice", sourceMarketId: "m1", sourceOutcomeIndex: 0 },
        { entryLabel: "Bob", sourceLabel: "Bob", sourceMarketId: "m2", sourceOutcomeIndex: 0 },
      ],
      pricesAtImport: [0.6, 0.3],
      fetchedAt: "2026-07-13T00:00:00.000Z",
    },
  };
  const entries = [
    { id: "e1", label: "Alice" },
    { id: "e2", label: "Bob" },
    { id: "e3", label: "Other" },
  ];
  const rows = detectSourceAnchorDesync([
    {
      marketId: "m1",
      title: "Orphan Other",
      entryCount: 3,
      metadata,
      entries,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, "entry_mapping_mismatch");
  assert.equal(rows[0].anchorable, true);
});

test("getEffectiveBettingCutoff prefers earlier closeAt", async () => {
  const { getEffectiveBettingCutoff } = await import("../server/native-markets/lifecycle");
  const endAt = new Date("2026-07-22T00:00:00.000Z");
  const earlyClose = new Date("2026-07-14T13:54:00.000Z");
  const cutoff = getEffectiveBettingCutoff(endAt, "amm", "community", earlyClose);
  assert.equal(cutoff.toISOString(), earlyClose.toISOString());

  const lateClose = new Date("2026-12-01T00:00:00.000Z");
  const derived = getEffectiveBettingCutoff(endAt, "amm", "community", lateClose);
  assert.ok(derived < lateClose);

  const fromString = getEffectiveBettingCutoff(
    endAt,
    "amm",
    "community",
    "2026-07-14T13:54:00.000Z",
  );
  assert.equal(fromString.toISOString(), earlyClose.toISOString());
});

test("sourceAnchorDesyncCheck softens healable mismatches", async () => {
  const { sourceAnchorDesyncCheck } = await import("../server/services/amm-audit");
  const healable = sourceAnchorDesyncCheck([
    { marketId: "m1", anchorable: true, reason: "entry_mapping_mismatch" },
  ]);
  assert.equal(healable.severity, "warn");
  assert.match(healable.message, /healable/i);

  const broken = sourceAnchorDesyncCheck([
    { marketId: "m1", anchorable: false, reason: "unanchorable" },
  ]);
  assert.equal(broken.severity, "warn");
  assert.match(broken.message, /cannot source-anchor/i);
});
