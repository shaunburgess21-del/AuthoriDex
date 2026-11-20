import test from "node:test";
import assert from "node:assert/strict";
import {
  rankVoiceOrder,
  voiceVisibleToViewer,
  type RankableVoice,
} from "../server/services/voices/rank-order";

const NOW = Date.parse("2026-11-20T06:00:00.000Z");
const HOUR = 3_600_000;

function post(partial: Partial<RankableVoice> & Pick<RankableVoice, "id" | "createdAtMs">): RankableVoice {
  return {
    entityRefKey: "timeline:global",
    upvotes: 0,
    downvotes: 0,
    replyCount: 0,
    authorUserId: "author",
    category: null,
    personIds: [],
    ...partial,
  };
}

test("latest is reverse-chronological and for-you ranks by hot score instead", () => {
  // A slightly older, well-liked post outranks a newer quiet one on For You.
  // Latest ignores engagement and stays newest-first.
  const fresh = post({ id: "fresh", createdAtMs: NOW - 2 * HOUR, upvotes: 0 });
  const popular = post({
    id: "popular",
    createdAtMs: NOW - 3 * HOUR,
    upvotes: 40,
    entityRefKey: "person:zendaya",
    category: "Film & TV",
    personIds: ["zendaya"],
  });
  const latest = rankVoiceOrder([popular, fresh], { mode: "latest", now: NOW, userId: null });
  const forYou = rankVoiceOrder([popular, fresh], { mode: "for-you", now: NOW, userId: null });

  assert.deepEqual(latest.map((row) => row.id), ["fresh", "popular"]);
  assert.deepEqual(forYou.map((row) => row.id), ["popular", "fresh"]);
  assert.ok(latest[0]!.score > latest[1]!.score);
  assert.ok(forYou[0]!.score > forYou[1]!.score);
});

test("for-you caps a busy entity at 3 but still keeps the viewer's own posts", () => {
  const items = [1, 2, 3, 4].map((n) =>
    post({
      id: `p${n}`,
      createdAtMs: NOW - n * HOUR,
      upvotes: 10 - n,
      entityRefKey: "opinion_poll:messaging",
      authorUserId: n === 4 ? "me" : "someone-else",
    }),
  );
  const anon = rankVoiceOrder(items, { mode: "for-you", now: NOW, userId: null });
  assert.deepEqual(anon.map((row) => row.id), ["p1", "p2", "p3"]);

  const mine = rankVoiceOrder(items, { mode: "for-you", now: NOW, userId: "me" });
  assert.deepEqual(mine.map((row) => row.id), ["p1", "p2", "p3", "p4"]);
});

test("latest does not apply the per-entity cap", () => {
  const items = [1, 2, 3, 4].map((n) =>
    post({
      id: `p${n}`,
      createdAtMs: NOW - n * HOUR,
      entityRefKey: "opinion_poll:messaging",
    }),
  );
  const latest = rankVoiceOrder(items, { mode: "latest", now: NOW, userId: null });
  assert.equal(latest.length, 4);
  assert.deepEqual(latest.map((row) => row.id), ["p1", "p2", "p3", "p4"]);
});

test("hidden posts are author-only and marked pending review", () => {
  assert.deepEqual(voiceVisibleToViewer("visible", "author", null), {
    include: true,
    pendingReview: false,
  });
  assert.deepEqual(voiceVisibleToViewer("hidden", "author", "someone-else"), {
    include: false,
    pendingReview: false,
  });
  assert.deepEqual(voiceVisibleToViewer("hidden", "author", "author"), {
    include: true,
    pendingReview: true,
  });
  assert.deepEqual(voiceVisibleToViewer(undefined, "author", null), {
    include: true,
    pendingReview: false,
  });
});
