import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL before importing anything that could transitively load
// server/db.ts. Same pattern as the other tests.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { awaitingPostPublishAssessment, stampedMarketNeedsRecheck } = await import(
  "../server/jobs/market-scout"
);

const assessment = { stage: "met", recommendedAction: "resolve_now" };

test("a draft stamped upstreamResolvedAt owes nothing while it stays hidden", () => {
  // Drafts are not settlement-eligible, so the watcher is right to stay quiet.
  assert.equal(
    awaitingPostPublishAssessment({ visibility: "draft", metadata: { source: {} } }),
    false,
  );
  assert.equal(
    awaitingPostPublishAssessment({ visibility: "archived", metadata: {} }),
    false,
  );
});

test("publishing a market stamped while hidden reopens the watch", () => {
  // The LeBron case: resolved upstream on 27 Jul as a draft, published later.
  // Without this the poll loop skips it forever on upstreamResolvedAt and the
  // resolve dialog never shows a recommendation.
  assert.equal(
    awaitingPostPublishAssessment({
      visibility: "live",
      metadata: { source: { upstreamResolvedAt: "2026-07-27T15:23:52.790Z" } },
    }),
    true,
  );
  assert.equal(
    awaitingPostPublishAssessment({ visibility: "inactive", metadata: {} }),
    true,
  );
});

test("the watch closes again once an assessment exists", () => {
  assert.equal(
    awaitingPostPublishAssessment({
      visibility: "live",
      metadata: {
        source: { upstreamResolvedAt: "2026-07-27T15:23:52.790Z" },
        scoutAssessment: assessment,
      },
    }),
    false,
  );
});

test("a stamped draft stays in the watch so it can be retired", () => {
  // Six drafts were stamped before retirement existed. If the stamp alone
  // ended the watch they would sit in the review queue forever.
  assert.equal(
    stampedMarketNeedsRecheck({
      visibility: "draft",
      metadata: { source: { upstreamResolvedAt: "2026-07-27T15:23:52.790Z" } },
    }),
    true,
  );
  // Published-and-assessed is genuinely finished; archived is already retired.
  assert.equal(
    stampedMarketNeedsRecheck({
      visibility: "live",
      metadata: { scoutAssessment: assessment },
    }),
    false,
  );
  assert.equal(stampedMarketNeedsRecheck({ visibility: "archived", metadata: {} }), false);
});

test("missing or malformed metadata does not crash the guard", () => {
  assert.equal(awaitingPostPublishAssessment({ visibility: "live" }), true);
  assert.equal(
    awaitingPostPublishAssessment({ visibility: "live", metadata: null }),
    true,
  );
  assert.equal(awaitingPostPublishAssessment({ visibility: null, metadata: {} }), false);
});
