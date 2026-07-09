import test from "node:test";
import assert from "node:assert/strict";
import {
  toPersonThreadCommentItem,
  type InsightCommentResponse,
} from "../client/src/lib/communityInsightsQuery";

test("top-level profile post maps parentCommentId null to parentId null", () => {
  const row: InsightCommentResponse = {
    id: "post-1",
    parentCommentId: null,
    userId: "user-1",
    username: "tester",
    avatarUrl: null,
    body: "Haaland is a true modern day Viking!",
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    upvotes: 3,
    downvotes: 0,
    replyCount: 2,
  };

  const item = toPersonThreadCommentItem(row);
  assert.equal(item.body, "Haaland is a true modern day Viking!");
  assert.equal(item.parentId, null);
  assert.equal(item.upvotes, 3);
});

test("nested reply maps parentCommentId onto CommentItem.parentId", () => {
  const row: InsightCommentResponse = {
    id: "reply-1",
    parentCommentId: "post-1",
    userId: "user-2",
    username: "replier",
    avatarUrl: null,
    body: "Agreed",
    deletedAt: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    upvotes: 0,
    downvotes: 0,
  };

  const item = toPersonThreadCommentItem(row);
  assert.equal(item.parentId, "post-1");
  assert.equal(item.body, "Agreed");
});
