import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  acquireDismissLock,
  claimDeleteAttempt,
  overlayBackdropShouldClose,
  releaseDeleteAttempt,
  releaseDismissLock,
  removeDeletedVoicesPost,
  resetVoicesPostTombstonesForTests,
  stripDeletedPost,
  voicesPostDeleteErrorCopy,
  voicesPostDeleteRequest,
} from "../client/src/components/voices/deleteVoicesPost";

describe("voicesPostDeleteRequest", () => {
  it("is DELETE /api/comments/:id", () => {
    assert.deepEqual(voicesPostDeleteRequest("post/1"), {
      method: "DELETE",
      path: "/api/comments/post%2F1",
    });
  });
});

describe("voicesPostDeleteErrorCopy", () => {
  it("explains 403 and 404 instead of failing quietly", () => {
    assert.equal(
      voicesPostDeleteErrorCopy({ status: 403 }).description,
      "You can only delete your own posts.",
    );
    assert.equal(
      voicesPostDeleteErrorCopy({ status: 404 }).description,
      "That post is no longer available.",
    );
    assert.match(voicesPostDeleteErrorCopy({ description: "offline" }).description, /offline/);
  });
});

describe("stripDeletedPost", () => {
  it("drops the post from infinite feed pages and profile lists", () => {
    const feed = stripDeletedPost({
      pages: [
        { items: [{ id: "keep" }, { id: "gone" }], nextCursor: null, total: 2 },
        { items: [{ id: "other" }], nextCursor: null, total: 2 },
      ],
      pageParams: [null],
    }, "gone");
    assert.deepEqual(feed.pages[0].items.map((item) => item.id), ["keep"]);
    assert.equal(feed.pages[0].total, 1);
    assert.deepEqual(feed.pages[1].items.map((item) => item.id), ["other"]);
    assert.deepEqual(feed.pageParams, [null]);

    const profilePosts = stripDeletedPost(
      [{ id: "gone", body: "hi" }, { id: "stay", body: "yo" }],
      "gone",
    );
    assert.deepEqual(profilePosts.map((item) => item.id), ["stay"]);
  });
});

describe("stripDeletedPost page", () => {
  it("drops a post from one feed page, not only infinite-query caches", () => {
    const page = stripDeletedPost(
      { items: [{ id: "gone" }, { id: "keep" }], nextCursor: null, total: 2 },
      "gone",
    );
    assert.deepEqual(page.items.map((item) => item.id), ["keep"]);
    assert.equal(page.total, 1);
    assert.equal(page.nextCursor, null);
  });
});

describe("voices delete confirm", () => {
  it("does not let the confirm click close the overlay, and ignores a second confirm", () => {
    const lock = { current: 0 };
    const attempt = { current: false };
    assert.equal(overlayBackdropShouldClose(lock, false), true);
    acquireDismissLock(lock);
    assert.equal(overlayBackdropShouldClose(lock, false), false);
    assert.equal(claimDeleteAttempt(attempt), true);
    assert.equal(claimDeleteAttempt(attempt), false);
    releaseDismissLock(lock);
    releaseDeleteAttempt(attempt);
    assert.equal(overlayBackdropShouldClose(lock, false), true);
    assert.equal(overlayBackdropShouldClose(lock, true), false);
  });
});

describe("removeDeletedVoicesPost", () => {
  it("clears every voices feed, comment history, and profile thread, then invalidates them", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["/api/voices/feed", "latest", "k"], {
      pages: [{ items: [{ id: "post-1" }, { id: "post-2" }], nextCursor: null, total: 2 }],
      pageParams: [null],
    });
    client.setQueryData(["/api/voices/feed", "for-you", "k"], {
      pages: [{ items: [{ id: "post-1" }], nextCursor: null, total: 1 }],
      pageParams: [null],
    });
    client.setQueryData(["/api/me/comments", "timeline"], {
      pages: [{ items: [{ id: "post-1" }, { id: "reply-9" }], stats: { totalTimelinePosts: 4 }, nextCursor: null }],
      pageParams: [null],
    });
    client.setQueryData(["/api/comments", "community_insight", "person-1", "thread"], [
      { id: "post-1", body: "profile post" },
      { id: "reply-1", body: "reply" },
    ]);
    client.setQueryData(["/api/profile/me"], { commentCount: 4 });

    removeDeletedVoicesPost(client, "post-1");

    const latest = client.getQueryData<{ pages: Array<{ items: Array<{ id: string }> }> }>([
      "/api/voices/feed", "latest", "k",
    ]);
    const forYou = client.getQueryData<{ pages: Array<{ items: Array<{ id: string }> }> }>([
      "/api/voices/feed", "for-you", "k",
    ]);
    const history = client.getQueryData<{ pages: Array<{ items: Array<{ id: string }> }> }>([
      "/api/me/comments", "timeline",
    ]);
    const profileThread = client.getQueryData<Array<{ id: string }>>([
      "/api/comments", "community_insight", "person-1", "thread",
    ]);

    assert.deepEqual(latest?.pages[0].items.map((item) => item.id), ["post-2"]);
    assert.deepEqual(forYou?.pages[0].items, []);
    assert.deepEqual(history?.pages[0].items.map((item) => item.id), ["reply-9"]);
    assert.deepEqual(profileThread?.map((item) => item.id), ["reply-1"]);
    assert.equal(client.getQueryState(["/api/profile/me"])?.isInvalidated, true);
    assert.equal(client.getQueryState(["/api/voices/feed", "latest", "k"])?.isInvalidated, true);
    assert.equal(
      client.getQueryState(["/api/comments", "community_insight", "person-1", "thread"])?.isInvalidated,
      true,
    );
  });

  it("does not let a stale refetch put a confirmed delete back", () => {
    resetVoicesPostTombstonesForTests();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["/api/voices/feed", "latest", "k"] as const;
    client.setQueryData(key, {
      pages: [{ items: [{ id: "post-1" }, { id: "post-2" }], nextCursor: null, total: 2 }],
      pageParams: [null],
    });

    removeDeletedVoicesPost(client, "post-1");
    client.setQueryData(key, {
      pages: [{ items: [{ id: "post-1" }, { id: "post-2" }], nextCursor: null, total: 2 }],
      pageParams: [null],
    });

    const latest = client.getQueryData<{ pages: Array<{ items: Array<{ id: string }> }> }>(key);
    assert.deepEqual(latest?.pages[0].items.map((item) => item.id), ["post-2"]);
    resetVoicesPostTombstonesForTests();
  });
});
