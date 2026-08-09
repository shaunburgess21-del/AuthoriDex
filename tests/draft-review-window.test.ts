import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const {
  draftReviewDeadline,
  sourceEventReofferable,
  DRAFT_UNREVIEWED_VOID_REASON,
  DRAFT_SOURCE_RESOLVED_VOID_REASON,
} = await import("../server/jobs/market-scout");

const NOW = new Date("2026-08-09T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600_000);
const COOLDOWN = 14 * 24 * 3600_000;

test("the review deadline is 72h after creation by default", () => {
  const created = new Date("2026-08-09T07:00:00.000Z");
  assert.equal(
    draftReviewDeadline(created, null).toISOString(),
    "2026-08-12T07:00:00.000Z",
  );
});

test("drafts predating the policy get a full window from its start date", () => {
  // The queue existed before the rule did. Without this, switching the policy
  // on would clear every older draft on the first sweep.
  const created = new Date("2026-07-20T07:00:00.000Z");
  const policyStart = new Date("2026-08-09T00:00:00.000Z");
  assert.equal(
    draftReviewDeadline(created, policyStart).toISOString(),
    "2026-08-12T00:00:00.000Z",
  );

  // A draft created after the policy start keeps its own clock.
  const later = new Date("2026-08-15T09:00:00.000Z");
  assert.equal(
    draftReviewDeadline(later, policyStart).toISOString(),
    "2026-08-18T09:00:00.000Z",
  );
});

test("only an unreviewed expiry becomes re-offerable, and only after the cooldown", () => {
  const expired = {
    status: "VOID",
    voidReason: DRAFT_UNREVIEWED_VOID_REASON,
    updatedAt: daysAgo(20),
  };
  assert.equal(sourceEventReofferable(expired, NOW, COOLDOWN), true);

  // Still inside the cooldown — don't put the same card back tomorrow.
  assert.equal(
    sourceEventReofferable(
      { ...expired, updatedAt: daysAgo(3) },
      NOW,
      COOLDOWN,
    ),
    false,
  );
});

test("deliberate outcomes stay blocked forever", () => {
  // Admin pressed Archive: a judgement, not an oversight.
  assert.equal(
    sourceEventReofferable(
      { status: "VOID", voidReason: "Consolidating", updatedAt: daysAgo(400) },
      NOW,
      COOLDOWN,
    ),
    false,
  );
  // Retired because the source settled — re-importing would be pointless.
  assert.equal(
    sourceEventReofferable(
      {
        status: "VOID",
        voidReason: DRAFT_SOURCE_RESOLVED_VOID_REASON,
        updatedAt: daysAgo(400),
      },
      NOW,
      COOLDOWN,
    ),
    false,
  );
  // A market that actually ran and resolved must never come back.
  assert.equal(
    sourceEventReofferable(
      { status: "RESOLVED", voidReason: null, updatedAt: daysAgo(400) },
      NOW,
      COOLDOWN,
    ),
    false,
  );
  // A live market obviously still blocks its own source event.
  assert.equal(
    sourceEventReofferable(
      { status: "OPEN", voidReason: null, updatedAt: daysAgo(400) },
      NOW,
      COOLDOWN,
    ),
    false,
  );
});

test("missing or malformed rows never unblock a source", () => {
  assert.equal(sourceEventReofferable({}, NOW, COOLDOWN), false);
  assert.equal(
    sourceEventReofferable(
      { status: "VOID", voidReason: DRAFT_UNREVIEWED_VOID_REASON, updatedAt: null },
      NOW,
      COOLDOWN,
    ),
    false,
  );
});
