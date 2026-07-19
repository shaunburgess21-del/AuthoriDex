import test from "node:test";
import assert from "node:assert/strict";

const {
  AGGREGATE_LEADERBOARD_POST_END_GRACE_MS,
  hardenAggregateLeaderboardAssessment,
  isAggregateLeaderboardMarket,
  isAggregateLeaderboardWindowOpen,
} = await import("../shared/lib/aggregate-leaderboard-market");

test("detects Golden Boot / most-goals markets", () => {
  assert.equal(
    isAggregateLeaderboardMarket({
      title: "Who will score the most goals at the 2026 World Cup?",
      resolutionCriteria: [
        "The player officially awarded the 2026 FIFA World Cup Golden Boot award by FIFA.",
      ],
    }),
    true,
  );
  assert.equal(
    isAggregateLeaderboardMarket({ title: "Will Argentina win the final?" }),
    false,
  );
  assert.equal(
    isAggregateLeaderboardMarket({
      title: "World Cup award race",
      resolutionCriteria: ["Official FIFA Golden Boot winner"],
    }),
    true,
  );
});

test("window stays open through post-endAt grace (kickoff ≠ full-time)", () => {
  const endAt = new Date("2026-07-19T16:00:00.000Z");
  assert.equal(
    isAggregateLeaderboardWindowOpen(endAt, new Date("2026-07-19T08:00:00.000Z")),
    true,
  );
  // Exactly at endAt: still open because grace has not elapsed.
  assert.equal(
    isAggregateLeaderboardWindowOpen(endAt, new Date("2026-07-19T16:00:00.000Z")),
    true,
  );
  // Mid-match (~90m after kickoff): still held.
  assert.equal(
    isAggregateLeaderboardWindowOpen(endAt, new Date("2026-07-19T17:30:00.000Z")),
    true,
  );
  // After grace: window closed.
  assert.equal(
    isAggregateLeaderboardWindowOpen(
      endAt,
      new Date(endAt.getTime() + AGGREGATE_LEADERBOARD_POST_END_GRACE_MS),
    ),
    false,
  );
});

test("downgrades premature Other met on open Golden Boot market", () => {
  const entries = [
    { id: "messi", label: "Lionel Messi" },
    { id: "other", label: "Other" },
  ];
  const raw = {
    leaning: "Other",
    proposedWinnerEntryId: "other",
    confidence: 0.98,
    stage: "met" as const,
    recommendedAction: "resolve_now" as const,
    whatChanged:
      "Saka hat-trick put him on 10 goals, two clear of Messi’s eight, so none of the listed players can now win.",
    sources: ["https://example.com"],
    assessedAt: "2026-07-19T08:00:00.000Z",
    signature: "met|resolve_now|other",
  };

  const hardened = hardenAggregateLeaderboardAssessment(
    raw,
    {
      title: "Who will score the most goals at the 2026 World Cup?",
      resolutionCriteria: [
        "The player officially awarded the 2026 FIFA World Cup Golden Boot award by FIFA.",
      ],
      endAt: new Date("2026-07-19T16:00:00.000Z"),
    },
    entries,
    new Date("2026-07-19T08:00:00.000Z"),
  );

  assert.equal(hardened.stage, "likely");
  assert.equal(hardened.recommendedAction, "watch");
  assert.equal(hardened.proposedWinnerEntryId, null);
  assert.ok(hardened.confidence <= 0.85);
  assert.ok(hardened.leaning.toLowerCase().includes("provisional"));
  assert.ok(hardened.whatChanged.includes("Held: aggregate/leaderboard"));
  assert.equal(hardened.signature, "likely|watch|none");
});

test("downgrades premature named-winner met but keeps leaning entry", () => {
  const hardened = hardenAggregateLeaderboardAssessment(
    {
      leaning: "Lionel Messi",
      proposedWinnerEntryId: "messi",
      confidence: 0.96,
      stage: "near_certain" as const,
      recommendedAction: "resolve_soon" as const,
      whatChanged: "Messi leads the Golden Boot race.",
      sources: [],
      assessedAt: "2026-07-19T10:00:00.000Z",
      signature: "near_certain|resolve_soon|messi",
    },
    {
      title: "Who will score the most goals at the 2026 World Cup?",
      endAt: new Date("2026-07-19T16:00:00.000Z"),
    },
    [
      { id: "messi", label: "Lionel Messi" },
      { id: "other", label: "Other" },
    ],
    new Date("2026-07-19T10:00:00.000Z"),
  );

  assert.equal(hardened.stage, "likely");
  assert.equal(hardened.recommendedAction, "watch");
  assert.equal(hardened.proposedWinnerEntryId, "messi");
  assert.equal(hardened.signature, "likely|watch|messi");
});

test("still holds during post-endAt grace (final in progress)", () => {
  const endAt = new Date("2026-07-19T16:00:00.000Z");
  const hardened = hardenAggregateLeaderboardAssessment(
    {
      leaning: "Other",
      proposedWinnerEntryId: "other",
      confidence: 0.99,
      stage: "met" as const,
      recommendedAction: "resolve_now" as const,
      whatChanged: "Saka still leads mid-final.",
      sources: [],
      assessedAt: "2026-07-19T17:15:00.000Z",
      signature: "met|resolve_now|other",
    },
    {
      title: "Who will score the most goals at the 2026 World Cup?",
      endAt,
    },
    [
      { id: "messi", label: "Lionel Messi" },
      { id: "other", label: "Other" },
    ],
    new Date("2026-07-19T17:15:00.000Z"),
  );

  assert.equal(hardened.stage, "likely");
  assert.equal(hardened.recommendedAction, "watch");
});

test("does not downgrade after endAt + grace", () => {
  const endAt = new Date("2026-07-19T16:00:00.000Z");
  const raw = {
    leaning: "Other",
    proposedWinnerEntryId: "other",
    confidence: 0.99,
    stage: "met" as const,
    recommendedAction: "resolve_now" as const,
    whatChanged: "FIFA awarded Golden Boot to Bukayo Saka.",
    sources: [],
    assessedAt: "2026-07-20T00:00:00.000Z",
    signature: "met|resolve_now|other",
  };

  const hardened = hardenAggregateLeaderboardAssessment(
    raw,
    {
      title: "Who will score the most goals at the 2026 World Cup?",
      endAt,
    },
    [
      { id: "messi", label: "Lionel Messi" },
      { id: "other", label: "Other" },
    ],
    new Date(endAt.getTime() + AGGREGATE_LEADERBOARD_POST_END_GRACE_MS + 1),
  );

  assert.equal(hardened.stage, "met");
  assert.equal(hardened.recommendedAction, "resolve_now");
  assert.equal(hardened.proposedWinnerEntryId, "other");
});

test("does not touch non-leaderboard markets", () => {
  const raw = {
    leaning: "Yes",
    proposedWinnerEntryId: "yes",
    confidence: 0.99,
    stage: "met" as const,
    recommendedAction: "resolve_now" as const,
    whatChanged: "Confirmed.",
    sources: [],
    assessedAt: "2026-07-19T08:00:00.000Z",
    signature: "met|resolve_now|yes",
  };

  const hardened = hardenAggregateLeaderboardAssessment(
    raw,
    {
      title: "Will the Fed cut rates in July?",
      endAt: new Date("2026-07-31T00:00:00.000Z"),
    },
    [{ id: "yes", label: "Yes" }],
    new Date("2026-07-19T08:00:00.000Z"),
  );

  assert.equal(hardened, raw);
});
