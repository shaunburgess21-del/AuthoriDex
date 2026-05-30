import test from "node:test";
import assert from "node:assert/strict";
import type { TrendingPerson } from "../shared/schema";
import type { BaselineDiagnostics } from "../server/utils/baseline";
import {
  applyBaselineDegraded,
  filterAndSortTrendingPeople,
  paginateTrendingPeople,
  type EnrichedTrendingPerson,
} from "../server/services/trending/trending-snapshot-query";

function person(
  overrides: Partial<TrendingPerson> & Pick<TrendingPerson, "id" | "name" | "rank">,
  enrich: Partial<Omit<EnrichedTrendingPerson, keyof TrendingPerson>> = {},
): EnrichedTrendingPerson {
  const base: TrendingPerson = {
    id: overrides.id,
    name: overrides.name,
    rank: overrides.rank,
    avatar: overrides.avatar ?? null,
    bio: overrides.bio ?? null,
    trendScore: overrides.trendScore ?? 1000,
    fameIndex: overrides.fameIndex ?? 10,
    change24h: overrides.change24h ?? 0,
    change7d: overrides.change7d ?? 0,
    category: overrides.category ?? "Tech",
  };
  return {
    ...base,
    approvalPct: null,
    approvalAvgRating: null,
    approvalVotesCount: null,
    underratedPct: null,
    overratedPct: null,
    fairlyRatedPct: null,
    valueScore: null,
    rankChange: 0,
    ...enrich,
  };
}

const baselineNormal: BaselineDiagnostics = {
  currentRunId: "run-1",
  currentRunFinishedAt: "2026-05-30T10:00:00.000Z",
  baseline24hRunId: "run-0",
  baseline24hAgeHours: 24,
  baseline24hStatus: "normal",
  baseline24hCoveragePct: 100,
  baseline7dRunId: "run-week",
  baseline7dAgeHours: 168,
  baseline7dStatus: "normal",
  scoreVersion: "v1",
};

const baselineDegraded: BaselineDiagnostics = {
  ...baselineNormal,
  baseline24hStatus: "degraded",
};

const roster: EnrichedTrendingPerson[] = [
  person({ id: "1", name: "Alice Tech", rank: 1, category: "Tech", trendScore: 5000, change24h: 5, change7d: 10 }, {
    approvalAvgRating: 4.5,
    approvalVotesCount: 100,
    rankChange: 2,
  }),
  person({ id: "2", name: "Bob Sports", rank: 2, category: "Sports", trendScore: 8000, change24h: -2, change7d: 1 }, {
    approvalAvgRating: 3.0,
    approvalVotesCount: 50,
    rankChange: -1,
  }),
  person({ id: "3", name: "Carol Music", rank: 3, category: "Music", trendScore: 3000, change24h: 10, change7d: -5 }, {
    approvalAvgRating: null,
    approvalVotesCount: null,
    rankChange: 0,
  }),
];

test("filterAndSortTrendingPeople: search by name", () => {
  const result = filterAndSortTrendingPeople(roster, { search: "alice" });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Alice Tech");
});

test("filterAndSortTrendingPeople: search by category", () => {
  const result = filterAndSortTrendingPeople(roster, { search: "sports" });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "2");
});

test("filterAndSortTrendingPeople: category filter", () => {
  const result = filterAndSortTrendingPeople(roster, { category: "Music" });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Carol Music");
});

test("filterAndSortTrendingPeople: sort by rank", () => {
  const shuffled = [roster[2], roster[0], roster[1]];
  const result = filterAndSortTrendingPeople(shuffled, { sort: "rank" });
  assert.deepEqual(result.map((p) => p.rank), [1, 2, 3]);
});

test("filterAndSortTrendingPeople: sort by score descending", () => {
  const result = filterAndSortTrendingPeople(roster, { sort: "score" });
  assert.deepEqual(result.map((p) => p.id), ["2", "1", "3"]);
});

test("filterAndSortTrendingPeople: sort by 24h change", () => {
  const result = filterAndSortTrendingPeople(roster, { sort: "24h" });
  assert.deepEqual(result.map((p) => p.id), ["3", "1", "2"]);
});

test("filterAndSortTrendingPeople: sort by 7d change", () => {
  const result = filterAndSortTrendingPeople(roster, { sort: "7d" });
  assert.deepEqual(result.map((p) => p.id), ["1", "2", "3"]);
});

test("filterAndSortTrendingPeople: sort by approval with nulls last", () => {
  const result = filterAndSortTrendingPeople(roster, { sort: "approval" });
  assert.equal(result[0].id, "1");
  assert.equal(result[1].id, "2");
  assert.equal(result[2].id, "3");
});

test("paginateTrendingPeople: default limit 200 returns all when roster smaller", () => {
  const page = paginateTrendingPeople(roster, {});
  assert.equal(page.length, 3);
});

test("paginateTrendingPeople: offset and limit", () => {
  const sorted = filterAndSortTrendingPeople(roster, { sort: "rank" });
  const page = paginateTrendingPeople(sorted, { limit: "1", offset: "1" });
  assert.equal(page.length, 1);
  assert.equal(page[0].rank, 2);
});

test("paginateTrendingPeople: limit=all returns full list", () => {
  const page = paginateTrendingPeople(roster, { limit: "all" });
  assert.equal(page.length, 3);
});

test("applyBaselineDegraded: strips change fields when degraded", () => {
  const degraded = applyBaselineDegraded(roster, baselineDegraded);
  assert.equal(degraded[0].change24h, null);
  assert.equal(degraded[0].change7d, null);
});

test("applyBaselineDegraded: preserves changes when normal", () => {
  const normal = applyBaselineDegraded(roster, baselineNormal);
  assert.equal(normal[0].change24h, 5);
  assert.equal(normal[0].change7d, 10);
});
