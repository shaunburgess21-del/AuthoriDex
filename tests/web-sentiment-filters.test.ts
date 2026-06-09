import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWebSentimentLeaderboardRankMap,
  filterWebSentimentRows,
} from "../shared/insights/web-sentiment-filters";

const SAMPLE_ROWS = [
  {
    id: "a",
    name: "Alice Music",
    category: "music",
    positivePct: 88,
  },
  {
    id: "b",
    name: "Bob Comedy",
    category: "comedy",
    positivePct: 72,
  },
  {
    id: "c",
    name: "Carol Politics",
    category: "politics",
    positivePct: 55,
  },
];

describe("filterWebSentimentRows", () => {
  it("returns all rows sorted desc by positivePct by default", () => {
    const result = filterWebSentimentRows(SAMPLE_ROWS, {
      search: "",
      category: "all",
      favoriteIds: new Set(),
      sortDir: "desc",
    });
    assert.deepEqual(
      result.map((r) => r.id),
      ["a", "b", "c"],
    );
  });

  it("sorts ascending when sortDir is asc", () => {
    const result = filterWebSentimentRows(SAMPLE_ROWS, {
      search: "",
      category: "all",
      favoriteIds: new Set(),
      sortDir: "asc",
    });
    assert.deepEqual(
      result.map((r) => r.id),
      ["c", "b", "a"],
    );
  });

  it("filters by case-insensitive search", () => {
    const result = filterWebSentimentRows(SAMPLE_ROWS, {
      search: "bob",
      category: "all",
      favoriteIds: new Set(),
      sortDir: "desc",
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "b");
  });

  it("filters by category", () => {
    const result = filterWebSentimentRows(SAMPLE_ROWS, {
      search: "",
      category: "music",
      favoriteIds: new Set(),
      sortDir: "desc",
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, "a");
  });

  it("filters by favorites", () => {
    const result = filterWebSentimentRows(SAMPLE_ROWS, {
      search: "",
      category: "favorites",
      favoriteIds: new Set(["b", "c"]),
      sortDir: "desc",
    });
    assert.deepEqual(
      result.map((r) => r.id),
      ["b", "c"],
    );
  });
});

describe("buildWebSentimentLeaderboardRankMap", () => {
  it("assigns rank 1 to the highest positivePct in a desc-sorted list", () => {
    const desc = filterWebSentimentRows(SAMPLE_ROWS, {
      search: "",
      category: "all",
      favoriteIds: new Set(),
      sortDir: "desc",
    });
    const rankById = buildWebSentimentLeaderboardRankMap(desc);
    assert.equal(rankById.get("a"), 1);
    assert.equal(rankById.get("b"), 2);
    assert.equal(rankById.get("c"), 3);
  });

  it("keeps canonical desc ranks when the list is sorted asc", () => {
    const asc = filterWebSentimentRows(SAMPLE_ROWS, {
      search: "",
      category: "all",
      favoriteIds: new Set(),
      sortDir: "asc",
    });
    const desc = filterWebSentimentRows(SAMPLE_ROWS, {
      search: "",
      category: "all",
      favoriteIds: new Set(),
      sortDir: "desc",
    });
    const rankById = buildWebSentimentLeaderboardRankMap(desc);
    assert.deepEqual(
      asc.map((row) => rankById.get(row.id)),
      [3, 2, 1],
    );
  });
});
