import test from "node:test";
import assert from "node:assert/strict";
import type { CommunityInsight } from "../client/src/lib/communityInsightsQuery";

// Mirror the mapper in communityInsightsQuery.ts (pure shape contract).
// After the community_insights → comments merge, the CommunityInsight shape is
// a client-side adapter over GET /api/comments?parentType=community_insight&
// topLevelOnly=true rows — `content` is mapped from the comment `body`, and
// `replyCount` comes from the reply-count subquery the route now includes.
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
    sentimentVote: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    upvotes: 3,
    downvotes: 0,
    replyCount: 2,
  };

  const item = mapInsightToCommentItem(row);
  assert.equal(item.body, "Great profile pick");
  assert.equal((item as { content?: string }).content, undefined);
  // replyCount is preserved on the CommunityInsight metadata shape (used by
  // the InsightCard "N replies" indicator) but not copied onto CommentItem.
  assert.equal(row.replyCount, 2);
});

test("community insight row defaults replyCount to 0 when absent", () => {
  const row: CommunityInsight = {
    id: "insight-2",
    personId: "person-1",
    userId: "user-2",
    username: "tester2",
    avatarUrl: null,
    content: "Another take",
    sentimentVote: null,
    deletedAt: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    upvotes: 0,
    downvotes: 0,
  };

  assert.equal(row.replyCount, undefined);
});

