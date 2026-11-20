import test from "node:test";
import assert from "node:assert/strict";
import {
  invalidateVoicesFeedCache,
  readVoicesFeedCache,
  voicesFeedCacheSignature,
  voicesFeedCacheSize,
  writeVoicesFeedCache,
} from "../server/services/voices/feed-cache";
import type { VoicesFeedItem } from "../server/services/voices/ranking";

function item(id: string): VoicesFeedItem {
  return {
    id,
    source: "comment",
    parentType: "voices_post",
    parentId: "global",
    body: id,
    author: { userId: "u", username: "u", avatarUrl: null, rank: null },
    upvotes: 0,
    downvotes: 0,
    replyCount: 0,
    createdAt: "2026-11-20T00:00:00.000Z",
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

test("a new post drops the cached ranked list so the next read includes it", () => {
  invalidateVoicesFeedCache();
  const sig = voicesFeedCacheSignature({
    mode: "latest",
    surfaces: null,
    personIds: null,
    categories: null,
    userId: null,
  });
  writeVoicesFeedCache(sig, [item("old")], 1_000);
  assert.equal(readVoicesFeedCache(sig, 1_000)?.length, 1);
  assert.equal(voicesFeedCacheSize(), 1);

  invalidateVoicesFeedCache();
  assert.equal(voicesFeedCacheSize(), 0);
  assert.equal(readVoicesFeedCache(sig, 1_000), null);
});

test("for-you and latest do not share a cache entry", () => {
  const base = {
    surfaces: null,
    personIds: null,
    categories: null,
    userId: null,
  };
  const latest = voicesFeedCacheSignature({ ...base, mode: "latest" });
  const forYou = voicesFeedCacheSignature({ ...base, mode: "for-you" });
  assert.notEqual(latest, forYou);
});
