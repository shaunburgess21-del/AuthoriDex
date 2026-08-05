import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attachVoteCounts,
  pickLeastVotedFirst,
  selectionWeight,
} from "../server/agents/voteSelection";

describe("attachVoteCounts", () => {
  it("maps counts onto candidates by id", () => {
    const out = attachVoteCounts(
      [{ id: "a" }, { id: "b" }],
      [
        { id: "a", c: 7 },
        { id: "b", c: "3" },
      ],
    );
    assert.deepEqual(out, [
      { id: "a", voteCount: 7 },
      { id: "b", voteCount: 3 },
    ]);
  });

  it("defaults candidates with no count row to zero", () => {
    // A card nobody has voted on has no GROUP BY row at all — that's exactly
    // the case the bias exists to serve, so it must read 0 rather than drop out.
    const out = attachVoteCounts([{ id: "fresh" }], []);
    assert.deepEqual(out, [{ id: "fresh", voteCount: 0 }]);
  });

  it("ignores null ids from left-joined count rows", () => {
    const out = attachVoteCounts([{ id: "a" }], [{ id: null, c: 99 }]);
    assert.deepEqual(out, [{ id: "a", voteCount: 0 }]);
  });

  it("preserves the other candidate fields", () => {
    const out = attachVoteCounts(
      [{ id: "a", headline: "Tipping culture has gone too far" }],
      [{ id: "a", c: 2 }],
    );
    assert.equal(out[0].headline, "Tipping culture has gone too far");
  });
});

describe("selectionWeight", () => {
  it("decays as votes accumulate", () => {
    assert.equal(selectionWeight(0), 1);
    assert.equal(selectionWeight(1), 0.5);
    assert.equal(selectionWeight(9), 0.1);
  });

  it("favours an empty card ~10x over one with nine votes", () => {
    assert.equal(selectionWeight(0) / selectionWeight(9), 10);
  });

  it("clamps negative counts so a bad read can't produce a negative weight", () => {
    assert.equal(selectionWeight(-5), 1);
  });
});

describe("pickLeastVotedFirst", () => {
  it("returns the only candidate", () => {
    assert.equal(pickLeastVotedFirst([{ voteCount: 42 }]).voteCount, 42);
  });

  it("throws on an empty list instead of returning undefined", () => {
    // The signature promises T; silently handing back undefined would surface
    // as an unrelated crash further into the vote transaction.
    assert.throws(() => pickLeastVotedFirst([]), /no candidates/);
  });

  it("treats a card with a negative count as empty, not as highest priority", () => {
    // Guards against a bad count read inverting the weighting.
    const pool = [{ voteCount: -3, tag: "bad" }, { voteCount: 0, tag: "fresh" }];
    let bad = 0;
    for (let i = 0; i < 2000; i++) {
      if (pickLeastVotedFirst(pool).tag === "bad") bad += 1;
    }
    // Both clamp to weight 1, so this should be a coin flip.
    assert.ok(
      bad > 800 && bad < 1200,
      `expected a ~50/50 split between clamped-equal cards, got ${bad}/2000`,
    );
  });

  it("always returns a member of the input", () => {
    const pool = [{ voteCount: 0 }, { voteCount: 5 }, { voteCount: 20 }];
    for (let i = 0; i < 200; i++) {
      assert.ok(pool.includes(pickLeastVotedFirst(pool)));
    }
  });

  it("still reaches well-voted cards — the bias is a weight, not a filter", () => {
    // If heavily-voted cards were excluded outright, established cards would
    // stop receiving any agent activity once new ones appeared.
    const pool = [{ voteCount: 0 }, { voteCount: 50 }];
    const picks = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      picks.add(pickLeastVotedFirst(pool).voteCount);
    }
    assert.deepEqual([...picks].sort((a, b) => a - b), [0, 50]);
  });

  it("picks the empty card far more often than the saturated one", () => {
    const pool = [{ voteCount: 0 }, { voteCount: 19 }];
    let empty = 0;
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      if (pickLeastVotedFirst(pool).voteCount === 0) empty += 1;
    }
    // Expected share is 1 / (1 + 0.05) ≈ 95%. Generous bound so the test can't
    // flake, while still failing outright if the weighting is dropped.
    assert.ok(
      empty / runs > 0.85,
      `expected the empty card to win >85% of the time, got ${((empty / runs) * 100).toFixed(1)}%`,
    );
  });

  it("reproduces the real starvation case: 6 new cards among 88 established", () => {
    // The Jul 2026 situation. Under uniform random the new cards would take
    // 6/94 ≈ 6% of votes; the weighting should lift them to roughly half.
    const pool = [
      ...Array.from({ length: 6 }, () => ({ voteCount: 0, fresh: true })),
      ...Array.from({ length: 88 }, () => ({ voteCount: 10, fresh: false })),
    ];
    let fresh = 0;
    const runs = 5000;
    for (let i = 0; i < runs; i++) {
      if (pickLeastVotedFirst(pool).fresh) fresh += 1;
    }
    const share = fresh / runs;
    assert.ok(
      share > 0.25 && share < 0.65,
      `expected new cards to take 25–65% of picks, got ${(share * 100).toFixed(1)}%`,
    );
  });

  it("is unbiased when every card has the same count", () => {
    // Once the inventory is evenly populated the bias must disappear rather
    // than latch onto whichever card happens to be first in the list.
    const pool = Array.from({ length: 4 }, (_, i) => ({ voteCount: 8, idx: i }));
    const counts = [0, 0, 0, 0];
    const runs = 8000;
    for (let i = 0; i < runs; i++) {
      counts[pickLeastVotedFirst(pool).idx] += 1;
    }
    for (const c of counts) {
      assert.ok(
        Math.abs(c - runs / 4) < runs / 10,
        `expected a roughly even split across 4 equal cards, got ${counts.join("/")}`,
      );
    }
  });
});
