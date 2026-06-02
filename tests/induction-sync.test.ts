import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrackedPersonBackfillFromCandidate,
  isEmptyish,
} from "../server/services/induction-sync-build";
import type { InductionCandidate, TrackedPerson } from "@shared/schema";

function mockTp(overrides: Partial<TrackedPerson> = {}): TrackedPerson {
  return {
    id: "tp-1",
    name: "Dave Chappelle",
    category: "film-tv",
    status: "induction",
    avatar: null,
    imageSlug: "dave-chappelle",
    wikiSlug: null,
    xHandle: null,
    instagramHandle: null,
    tiktokHandle: null,
    youtubeId: null,
    spotifyId: null,
    searchQueryOverride: null,
    googleTrendsTopicId: null,
    displayOrder: 0,
    ...overrides,
  } as TrackedPerson;
}

function mockCandidate(overrides: Partial<InductionCandidate> = {}): InductionCandidate {
  return {
    id: "ic-1",
    displayName: "Dave Chappelle",
    category: "comedy",
    imageSlug: "dave-chappelle",
    seedVotes: 6,
    wikiSlug: "Dave_Chappelle",
    xHandle: "DaveChappelle",
    instagramHandle: "davechappelle",
    tiktokHandle: null,
    youtubeId: "UConXPkFXreU0_i-JDjTzK0A",
    spotifyId: null,
    searchQueryOverride: null,
    googleTrendsTopicId: null,
    inductionStatus: "Queue",
    isActive: true,
    ...overrides,
  } as InductionCandidate;
}

test("isEmptyish treats null and blank as empty", () => {
  assert.equal(isEmptyish(null), true);
  assert.equal(isEmptyish(""), true);
  assert.equal(isEmptyish("  "), true);
  assert.equal(isEmptyish("x"), false);
});

test("buildTrackedPersonBackfillFromCandidate fills empty shadow fields from candidate", () => {
  const updates = buildTrackedPersonBackfillFromCandidate(mockTp(), mockCandidate());
  assert.equal(updates.wikiSlug, "Dave_Chappelle");
  assert.equal(updates.xHandle, "DaveChappelle");
  assert.equal(updates.instagramHandle, "davechappelle");
  assert.equal(updates.category, "comedy");
  assert.equal(updates.status, undefined);
});

test("buildTrackedPersonBackfillFromCandidate does not overwrite existing shadow wiki", () => {
  const updates = buildTrackedPersonBackfillFromCandidate(
    mockTp({ wikiSlug: "Existing" }),
    mockCandidate(),
  );
  assert.equal(updates.wikiSlug, undefined);
});

test("buildTrackedPersonBackfillFromCandidate promotes to main_leaderboard on approve", () => {
  const updates = buildTrackedPersonBackfillFromCandidate(mockTp(), mockCandidate(), {
    promoteToMainLeaderboard: true,
  });
  assert.equal(updates.status, "main_leaderboard");
});

test("buildTrackedPersonBackfillFromCandidate skips non-induction tracked rows for category sync", () => {
  const updates = buildTrackedPersonBackfillFromCandidate(
    mockTp({ status: "main_leaderboard", category: "film-tv" }),
    mockCandidate({ category: "comedy" }),
  );
  assert.equal(updates.category, undefined);
});

test("buildTrackedPersonBackfillFromCandidate updates imageSlug for induction when candidate slug differs", () => {
  const updates = buildTrackedPersonBackfillFromCandidate(
    mockTp({ imageSlug: "old-slug" }),
    mockCandidate({ imageSlug: "dave-chappelle" }),
  );
  assert.equal(updates.imageSlug, "dave-chappelle");
});
