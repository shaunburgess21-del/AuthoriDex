import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isQuickVoteCardVoted,
  readHideVotedPreference,
  writeHideVotedPreference,
  hasSeenHideVotedTip,
  markHideVotedTipSeen,
  type QuickVoteVotedSources,
} from "../client/src/lib/quickVoteHideVoted";

function memoryStorage(): Storage {
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
}

const sources = (): QuickVoteVotedSources => ({
  matchupUserVotes: { m1: "option_a" },
  sentimentPolls: [
    { id: "s1", userVote: "agree" },
    { id: "s2", userVote: null },
  ],
  opinionPolls: [
    { id: "o1", userVote: "opt-1" },
    { id: "o2", userVote: undefined },
  ],
  ratingPeople: [
    { id: "r1", userApprovalRating: 4 } as QuickVoteVotedSources["ratingPeople"][number],
    { id: "r2", userApprovalRating: null } as QuickVoteVotedSources["ratingPeople"][number],
  ],
});

describe("isQuickVoteCardVoted", () => {
  const g = globalThis as unknown as { window?: { localStorage: Storage } };
  let prevWindow: typeof g.window;

  beforeEach(() => {
    prevWindow = g.window;
    g.window = { localStorage: memoryStorage() };
  });
  afterEach(() => {
    g.window = prevWindow;
  });

  it("detects matchup votes from the user-votes map", () => {
    assert.equal(isQuickVoteCardVoted("matchup", "m1", sources()), true);
    assert.equal(isQuickVoteCardVoted("matchup", "m2", sources()), false);
  });

  it("detects sentiment and opinion votes from the list payloads", () => {
    assert.equal(isQuickVoteCardVoted("sentiment", "s1", sources()), true);
    assert.equal(isQuickVoteCardVoted("sentiment", "s2", sources()), false);
    assert.equal(isQuickVoteCardVoted("opinion", "o1", sources()), true);
    assert.equal(isQuickVoteCardVoted("opinion", "o2", sources()), false);
  });

  it("detects ratings from the server field, falling back to localStorage", () => {
    assert.equal(isQuickVoteCardVoted("rating", "r1", sources()), true);
    assert.equal(isQuickVoteCardVoted("rating", "r2", sources()), false);
    g.window!.localStorage.setItem("sentiment-vote-r2", "3");
    assert.equal(isQuickVoteCardVoted("rating", "r2", sources()), true);
    g.window!.localStorage.setItem("sentiment-vote-r2", "9");
    assert.equal(isQuickVoteCardVoted("rating", "r2", sources()), false);
  });

  it("treats unknown types as unvoted", () => {
    assert.equal(isQuickVoteCardVoted(undefined, "m1", sources()), false);
  });

  it("round-trips the preference and tip flags", () => {
    assert.equal(readHideVotedPreference(), false);
    writeHideVotedPreference(true);
    assert.equal(readHideVotedPreference(), true);
    writeHideVotedPreference(false);
    assert.equal(readHideVotedPreference(), false);
    assert.equal(hasSeenHideVotedTip(), false);
    markHideVotedTipSeen();
    assert.equal(hasSeenHideVotedTip(), true);
  });
});
