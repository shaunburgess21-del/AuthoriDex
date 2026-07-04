import test from "node:test";
import assert from "node:assert/strict";
import type { CommunityInsight } from "../client/src/lib/communityInsightsQuery";

// Mirror the mapper in communityInsightsQuery.ts (pure shape contract).
function mapInsightToCommentItem(i: CommunityInsight) {
  return {
    id: i.id,
    userId: i.userId,
    username: i.username,
    avatarUrl: i.avatarUrl,
    authorRank: i.authorRank ?? null,
    body: i.content,
    parentId: null,
    upvotes: i.upvotes ?? 0,
    downvotes: i.downvotes ?? 0,
    userVote: null,
    deletedAt: i.deletedAt,
    parentVoteLabel: i.parentVoteLabel ?? null,
    createdAt: i.createdAt,
  };
}

test("community insight API row maps content to CommentItem.body", () => {
  const row: CommunityInsight = {
    id: "insight-1",
    personId: "person-1",
    userId: "user-1",
    username: "tester",
    avatarUrl: null,
    content: "Great profile pick",
    sentimentVote: 8,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    upvotes: 3,
    downvotes: 0,
  };

  const item = mapInsightToCommentItem(row);
  assert.equal(item.body, "Great profile pick");
  assert.equal((item as { content?: string }).content, undefined);
});
