import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_MOVERS_MAX,
  DAILY_MOVERS_PER_SIDE,
  selectDailyMovers,
} from "../server/services/trending/daily-movers";

function person(id: string, change24h: number | null | undefined) {
  return { id, change24h };
}

test("selectDailyMovers returns 3 risers + 3 droppers when pool is rich", () => {
  const people = [
    person("r1", 50),
    person("r2", 40),
    person("r3", 30),
    person("r4", 20),
    person("d1", -50),
    person("d2", -40),
    person("d3", -30),
    person("d4", -20),
  ];
  const result = selectDailyMovers(people);
  assert.equal(result.length, DAILY_MOVERS_MAX);
  assert.deepEqual(
    result.map((p) => p.id),
    ["r1", "r2", "r3", "d1", "d2", "d3"],
  );
});

test("selectDailyMovers excludes zero and null change24h", () => {
  const people = [
    person("up", 5),
    person("flat", 0),
    person("down", -10),
    person("null", null),
  ];
  const result = selectDailyMovers(people);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "up");
  assert.equal(result[1].id, "down");
});

test("selectDailyMovers sorts risers desc and droppers asc", () => {
  const people = [
    person("r-mid", 20),
    person("r-top", 50),
    person("d-mid", -20),
    person("d-worst", -50),
  ];
  const result = selectDailyMovers(people);
  assert.deepEqual(
    result.map((p) => p.id),
    ["r-top", "r-mid", "d-worst", "d-mid"],
  );
});

test("selectDailyMovers returns only risers when no droppers qualify", () => {
  const people = [
    person("r1", 30),
    person("r2", 20),
    person("flat", 0),
  ];
  const result = selectDailyMovers(people);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((p) => p.id), ["r1", "r2"]);
});

test("selectDailyMovers excludes NaN change24h", () => {
  const people = [person("up", 10), person("nan", Number.NaN)];
  const result = selectDailyMovers(people);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "up");
});

test("selectDailyMovers returns fewer than 6 when one side is thin", () => {
  const people = [
    person("r1", 30),
    person("r2", 20),
    person("r3", 10),
    person("d1", -5),
  ];
  const result = selectDailyMovers(people);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map((p) => p.id), ["r1", "r2", "r3", "d1"]);
});

test("selectDailyMovers has no duplicate ids across sides", () => {
  const people = Array.from({ length: 10 }, (_, i) =>
    person(`p${i}`, i < 5 ? (5 - i) * 10 : -(i - 4) * 10),
  );
  const result = selectDailyMovers(people);
  const ids = result.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("DAILY_MOVERS_PER_SIDE is 3 and DAILY_MOVERS_MAX is 6", () => {
  assert.equal(DAILY_MOVERS_PER_SIDE, 3);
  assert.equal(DAILY_MOVERS_MAX, 6);
});
