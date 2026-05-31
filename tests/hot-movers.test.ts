import test from "node:test";
import assert from "node:assert/strict";
import {
  HOT_MOVERS_CAP,
  HOT_MOVERS_RANK_MAX,
  selectHotMovers,
} from "../server/services/trending/hot-movers";

function mover(
  id: string,
  rank: number | null | undefined,
  change24h: number | null | undefined,
) {
  return { id, rank, change24h };
}

test("selectHotMovers excludes rank above HOT_MOVERS_RANK_MAX even with highest change", () => {
  const people = [
    mover("high-rank", 101, 200),
    mover("eligible", 50, 10),
  ];
  const result = selectHotMovers(people);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "eligible");
});

test("selectHotMovers sorts by change24h descending and caps at HOT_MOVERS_CAP", () => {
  const people = Array.from({ length: 8 }, (_, i) =>
    mover(`p${i + 1}`, i + 1, (8 - i) * 10),
  );
  const result = selectHotMovers(people);
  assert.equal(result.length, HOT_MOVERS_CAP);
  assert.equal(HOT_MOVERS_CAP, 6);
  assert.deepEqual(
    result.map((p) => p.id),
    ["p1", "p2", "p3", "p4", "p5", "p6"],
  );
});

test("selectHotMovers excludes zero and negative change24h", () => {
  const people = [
    mover("up", 10, 5),
    mover("flat", 20, 0),
    mover("down", 30, -10),
    mover("null", 40, null),
  ];
  const result = selectHotMovers(people);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "up");
});

test("selectHotMovers returns fewer than cap when pool is thin", () => {
  const people = [mover("a", 1, 3), mover("b", 2, 1)];
  const result = selectHotMovers(people);
  assert.equal(result.length, 2);
});

test("selectHotMovers treats missing rank as ineligible", () => {
  const people = [mover("no-rank", undefined, 50), mover("ranked", 5, 10)];
  const result = selectHotMovers(people);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "ranked");
});

test("HOT_MOVERS_RANK_MAX is 100", () => {
  assert.equal(HOT_MOVERS_RANK_MAX, 100);
});
