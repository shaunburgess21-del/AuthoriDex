import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterCardsByVoteActivity } from "../client/src/lib/hub-activity-filter";
import { hasOverallRatingVote } from "../client/src/lib/quickVoteHideVoted";

const cards = [
  { id: "voted", voted: true },
  { id: "open", voted: false },
];

describe("filterCardsByVoteActivity", () => {
  it("keeps every card on all", () => {
    const result = filterCardsByVoteActivity(cards, "all", (card) => card.voted);
    assert.deepEqual(result.map((card) => card.id), ["voted", "open"]);
  });

  it("keeps only acted cards on votes only", () => {
    const result = filterCardsByVoteActivity(cards, "show-mine", (card) => card.voted);
    assert.deepEqual(result.map((card) => card.id), ["voted"]);
  });

  it("keeps only unacted cards on not voted", () => {
    const result = filterCardsByVoteActivity(cards, "hide-mine", (card) => card.voted);
    assert.deepEqual(result.map((card) => card.id), ["open"]);
  });

  it("retains a just-voted card through hide-exit, then drops it", () => {
    const retained = filterCardsByVoteActivity(
      cards,
      "hide-mine",
      (card) => card.voted,
      {
        keyOf: (card) => card.id,
        isRetained: (key) => key === "voted",
      },
    );
    assert.deepEqual(retained.map((card) => card.id), ["voted", "open"]);

    const hidden = filterCardsByVoteActivity(
      cards,
      "hide-mine",
      (card) => card.voted,
      {
        keyOf: (card) => card.id,
        isHidden: (key) => key === "open",
      },
    );
    assert.deepEqual(hidden.map((card) => card.id), []);
  });

  it("reports an empty list when every card is filtered out", () => {
    const votedOnly = cards.filter((card) => card.voted);
    assert.deepEqual(
      filterCardsByVoteActivity(votedOnly, "hide-mine", (card) => card.voted),
      [],
    );
    assert.deepEqual(
      filterCardsByVoteActivity(cards.filter((card) => !card.voted), "show-mine", (card) => card.voted),
      [],
    );
  });
});

describe("hasOverallRatingVote", () => {
  const g = globalThis as unknown as { window?: { localStorage: Storage } };
  const memory = () => {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (k: string) => map.get(k) ?? null,
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      removeItem: (k: string) => void map.delete(k),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
    } as Storage;
  };

  it("prefers the server rating and falls back to the card's localStorage key", () => {
    const prev = g.window;
    g.window = { localStorage: memory() };
    try {
      assert.equal(hasOverallRatingVote({ id: "p1", userApprovalRating: 5 }), true);
      assert.equal(hasOverallRatingVote({ id: "p2", userApprovalRating: null }), false);
      g.window.localStorage.setItem("sentiment-vote-p2", "4");
      assert.equal(hasOverallRatingVote({ id: "p2", userApprovalRating: null }), true);
      g.window.localStorage.setItem("sentiment-vote-p2", "0");
      assert.equal(hasOverallRatingVote({ id: "p2", userApprovalRating: null }), false);
      assert.equal(hasOverallRatingVote(null), false);
    } finally {
      g.window = prev;
    }
  });
});
