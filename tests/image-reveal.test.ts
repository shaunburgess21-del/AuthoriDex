import test from "node:test";
import assert from "node:assert/strict";
import { imageRevealStatus } from "../client/src/lib/imageReveal";
import { leaderboardAvatarPriority, LEADERBOARD_AVATAR_IMAGE_WIDTH } from "../client/src/lib/leaderboardImageLoading";
import { withPostedVoice } from "../client/src/components/voices/seedPostedVoice";
import type { VoicesFeedItem } from "../client/src/components/voices/types";

test("cached images that already decoded count as loaded", () => {
  assert.equal(imageRevealStatus({ complete: true, naturalWidth: 280 }), "loaded");
  assert.equal(imageRevealStatus({ complete: true, naturalWidth: 0 }), "error");
  assert.equal(imageRevealStatus({ complete: false, naturalWidth: 0 }), "pending");
  assert.equal(imageRevealStatus(null), "pending");
});

test("leaderboard rows 6–20 load immediately at low priority and a small width", () => {
  assert.equal(leaderboardAvatarPriority(0), "high");
  assert.equal(leaderboardAvatarPriority(4), "high");
  assert.equal(leaderboardAvatarPriority(5), "low");
  assert.equal(leaderboardAvatarPriority(19), "low");
  assert.equal(leaderboardAvatarPriority(20), "lazy");
  assert.ok(LEADERBOARD_AVATAR_IMAGE_WIDTH <= 160);
});

function feedItem(id: string, createdAt: string): VoicesFeedItem {
  return {
    id,
    source: "comment",
    parentType: "voices_post",
    parentId: "global",
    body: id,
    author: { userId: "u", username: "VoxTester", avatarUrl: null, rank: "Citizen" },
    upvotes: 0,
    downvotes: 0,
    replyCount: 0,
    createdAt,
    entity: {
      surface: "timeline",
      refType: "timeline",
      refId: "global",
      title: "Timeline",
      subtitle: null,
      href: "/voices",
      slug: null,
      imageUrl: null,
      fallbackImageUrl: null,
      category: null,
      personIds: [],
    },
    badges: { topTake: false, rising: false },
    score: 1,
  };
}

test("the author's post is inserted when a stale feed refetch omitted it", () => {
  const existing = feedItem("older", "2026-11-19T18:00:00.000Z");
  const mine = feedItem("mine", "2026-11-19T21:20:38.520Z");
  const cached = {
    pages: [{ items: [existing], nextCursor: null, total: 1 }],
    pageParams: [null],
  };
  const next = withPostedVoice(cached, mine);
  assert.deepEqual(next?.pages[0]?.items.map((item) => item.id), ["mine", "older"]);

  const again = withPostedVoice(next, mine);
  assert.equal(again, next);
});

test("a pending-review post keeps its body for the author", () => {
  const mine = { ...feedItem("held", "2026-11-20T01:00:00.000Z"), pendingReview: true };
  const next = withPostedVoice(undefined, mine);
  assert.equal(next?.pages[0]?.items[0]?.pendingReview, true);
  assert.equal(next?.pages[0]?.items[0]?.body, "held");
});
