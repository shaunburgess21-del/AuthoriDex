import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMMENT_ACTIVITY_WINDOW_MS,
  MIN_COMMENTS_FOR_REPLY,
  UNSTICK_COMMENT_FLOOR,
  attachCommentStats,
  canReplyOnCard,
  effectiveCommentCount,
  filterReplyEligibleParents,
  pickLeastCommentedFirst,
  pickLeastCommentedParent,
  pickFocusedCommentParent,
  THIN_CARD_MAX_COMMENTS,
} from "../server/agents/commentSelection";

const now = new Date("2026-09-13T10:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const daysAgo = (days: number) => hoursAgo(days * 24);

describe("attachCommentStats", () => {
  it("maps counts onto parents by type+id", () => {
    const out = attachCommentStats(
      [
        { parentType: "matchup", parentId: "a" },
        { parentType: "matchup", parentId: "b" },
      ],
      [
        { parentType: "matchup", parentId: "a", c: 7, lastAt: now },
        { parentType: "matchup", parentId: "b", c: "3", lastAt: "2026-09-12T00:00:00.000Z" },
      ],
    );
    assert.equal(out[0].commentCount, 7);
    assert.equal(out[1].commentCount, 3);
    assert.ok(out[1].lastCommentAt instanceof Date);
  });

  it("defaults parents with no count row to zero", () => {
    const out = attachCommentStats([{ parentType: "matchup", parentId: "fresh" }], []);
    assert.deepEqual(out, [
      { parentType: "matchup", parentId: "fresh", commentCount: 0, lastCommentAt: null },
    ]);
  });

  it("does not mix counts across parent types that share an id", () => {
    const out = attachCommentStats(
      [
        { parentType: "matchup", parentId: "same" },
        { parentType: "opinion_poll", parentId: "same" },
      ],
      [{ parentType: "matchup", parentId: "same", c: 4, lastAt: now }],
    );
    assert.equal(out[0].commentCount, 4);
    assert.equal(out[1].commentCount, 0);
  });

  it("ignores null ids from left-joined count rows", () => {
    const out = attachCommentStats(
      [{ parentType: "matchup", parentId: "a" }],
      [{ parentType: "matchup", parentId: null, c: 99, lastAt: now }],
    );
    assert.equal(out[0].commentCount, 0);
  });

  it("attaches rows even if parentType is a non-string enum-like value", () => {
    const out = attachCommentStats(
      [{ parentType: "matchup", parentId: "a" }],
      [{ parentType: "matchup" as unknown as string, parentId: "a", c: 2, lastAt: now }],
    );
    assert.equal(out[0].commentCount, 2);
  });
});

describe("effectiveCommentCount (D)", () => {
  it("returns 0 for a never-commented card", () => {
    assert.equal(effectiveCommentCount(0, null, now), 0);
  });

  it("keeps a fresh single comment as 1", () => {
    assert.equal(effectiveCommentCount(1, hoursAgo(2), now), 1);
  });

  it("collapses a stale single comment to 0 so it ties with empty cards", () => {
    assert.equal(effectiveCommentCount(1, daysAgo(11), now), 0);
  });

  it("collapses two stale comments to 0 (below the unstick floor)", () => {
    assert.equal(effectiveCommentCount(2, daysAgo(8), now), 0);
  });

  it("does not unstick a quiet but already-full thread", () => {
    assert.equal(effectiveCommentCount(UNSTICK_COMMENT_FLOOR, daysAgo(30), now), UNSTICK_COMMENT_FLOOR);
    assert.equal(effectiveCommentCount(13, daysAgo(30), now), 13);
  });

  it("treats a missing last-comment timestamp on a thin card as empty", () => {
    assert.equal(effectiveCommentCount(2, null, now), 0);
  });

  it("uses the same 7-day window as the reply probe", () => {
    const justInside = new Date(now.getTime() - COMMENT_ACTIVITY_WINDOW_MS + 1);
    const justOutside = new Date(now.getTime() - COMMENT_ACTIVITY_WINDOW_MS);
    assert.equal(effectiveCommentCount(2, justInside, now), 2);
    assert.equal(effectiveCommentCount(2, justOutside, now), 0);
  });

  it("clamps negative counts", () => {
    assert.equal(effectiveCommentCount(-3, hoursAgo(1), now), 0);
  });
});

describe("canReplyOnCard (B)", () => {
  it("blocks replies on empty cards", () => {
    assert.equal(canReplyOnCard(0, null, now), false);
  });

  it("blocks replies on a single fresh comment so a second top-level can land", () => {
    assert.equal(canReplyOnCard(1, hoursAgo(1), now), false);
  });

  it("blocks replies on a stale Ronaldo-vs-Messi style card", () => {
    assert.equal(canReplyOnCard(1, daysAgo(11), now), false);
  });

  it("allows replies once a card has a live thread of 2+", () => {
    assert.equal(canReplyOnCard(MIN_COMMENTS_FOR_REPLY, hoursAgo(3), now), true);
    assert.equal(canReplyOnCard(13, hoursAgo(1), now), true);
  });

  it("blocks replies on a 2-comment thread that went stale (unstick instead)", () => {
    assert.equal(canReplyOnCard(2, daysAgo(8), now), false);
  });

  it("filters a mixed pool down to reply-eligible cards only", () => {
    const pool = [
      { id: "empty", commentCount: 0, lastCommentAt: null },
      { id: "stale", commentCount: 1, lastCommentAt: daysAgo(11) },
      { id: "thin-fresh", commentCount: 1, lastCommentAt: hoursAgo(2) },
      { id: "thread", commentCount: 4, lastCommentAt: hoursAgo(1) },
    ];
    assert.deepEqual(
      filterReplyEligibleParents(pool, now).map((p) => p.id),
      ["thread"],
    );
  });
});

describe("pickLeastCommentedFirst (A)", () => {
  it("returns the only candidate", () => {
    assert.equal(pickLeastCommentedFirst([{ commentCount: 42 }]).commentCount, 42);
  });

  it("throws on an empty list instead of returning undefined", () => {
    assert.throws(() => pickLeastCommentedFirst([]), /no candidates/);
  });

  it("picks the empty card far more often than the saturated one", () => {
    const pool = [{ commentCount: 0 }, { commentCount: 19 }];
    let empty = 0;
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      if (pickLeastCommentedFirst(pool).commentCount === 0) empty += 1;
    }
    assert.ok(
      empty / runs > 0.85,
      `expected the empty card to win >85% of the time, got ${((empty / runs) * 100).toFixed(1)}%`,
    );
  });

  it("still reaches well-commented cards — the bias is a weight, not a filter", () => {
    const pool = [{ commentCount: 0 }, { commentCount: 50 }];
    const picks = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      picks.add(pickLeastCommentedFirst(pool).commentCount);
    }
    assert.deepEqual([...picks].sort((a, b) => a - b), [0, 50]);
  });
});

describe("pickLeastCommentedParent (A + D together)", () => {
  it("prefers a stale one-comment card over a busy live thread", () => {
    // Ronaldo vs Messi (1 comment, 11 days old) vs Brady vs Manning (13, recent).
    const pool = [
      { id: "ronaldo-messi", commentCount: 1, lastCommentAt: daysAgo(11) },
      { id: "brady-manning", commentCount: 13, lastCommentAt: hoursAgo(2) },
    ];
    let unstuck = 0;
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      if (pickLeastCommentedParent(pool, now).id === "ronaldo-messi") unstuck += 1;
    }
    assert.ok(
      unstuck / runs > 0.85,
      `expected the stale thin card to win >85% of the time, got ${((unstuck / runs) * 100).toFixed(1)}%`,
    );
  });

  it("treats a stale thin card as a tie with a never-commented card", () => {
    const pool = [
      { id: "stale", commentCount: 1, lastCommentAt: daysAgo(11) },
      { id: "empty", commentCount: 0, lastCommentAt: null },
    ];
    let stale = 0;
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      if (pickLeastCommentedParent(pool, now).id === "stale") stale += 1;
    }
    assert.ok(
      stale > 1600 && stale < 2400,
      `expected a ~50/50 split, got ${stale}/4000`,
    );
  });
});

describe("pickFocusedCommentParent (0–1 first)", () => {
  it("never picks a busy card while a 0–1 card exists", () => {
    const pool = [
      { id: "empty", commentCount: 0, lastCommentAt: null, category: "sports" },
      { id: "one", commentCount: 1, lastCommentAt: hoursAgo(2), category: "sports" },
      { id: "busy", commentCount: 13, lastCommentAt: hoursAgo(1), category: "sports" },
    ];
    for (let i = 0; i < 400; i++) {
      const picked = pickFocusedCommentParent(pool, ["sports"], now, 0.7);
      assert.notEqual(picked.id, "busy");
      assert.ok(picked.commentCount <= THIN_CARD_MAX_COMMENTS);
    }
  });

  it("falls back to the full pool once every card has 2+ comments", () => {
    const pool = [
      { id: "a", commentCount: 2, lastCommentAt: hoursAgo(1), category: "sports" },
      { id: "b", commentCount: 13, lastCommentAt: hoursAgo(1), category: "sports" },
    ];
    const picks = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      picks.add(pickFocusedCommentParent(pool, ["sports"], now, 0).id);
    }
    assert.ok(picks.has("a"));
    assert.ok(picks.has("b"));
  });
});
