import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeDedupedRankingRows } from "../shared/insights/rankings-pagination";

describe("mergeDedupedRankingRows", () => {
  it("drops duplicate ids across pages while preserving first-seen order", () => {
    const rows = mergeDedupedRankingRows([
      {
        rows: [
          { id: "a", name: "Alice" },
          { id: "b", name: "Bob" },
        ] as never[],
      },
      {
        rows: [
          { id: "b", name: "Bob duplicate" },
          { id: "c", name: "Carol" },
        ] as never[],
      },
    ]);

    assert.deepEqual(
      rows.map((row) => row.id),
      ["a", "b", "c"],
    );
    assert.equal(rows[1]?.name, "Bob");
  });
});
