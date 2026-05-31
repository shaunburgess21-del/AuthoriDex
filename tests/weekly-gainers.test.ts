import test from "node:test";
import assert from "node:assert/strict";
import {
  WEEKLY_GAINERS_CAP,
  selectWeeklyGainers,
} from "../server/services/trending/weekly-gainers";

function gainer(
  id: string,
  change7d: number | null | undefined,
) {
  return { id, change7d };
}

test("selectWeeklyGainers sorts by change7d descending and caps at WEEKLY_GAINERS_CAP", () => {
  const people = Array.from({ length: 5 }, (_, i) =>
    gainer(`p${i + 1}`, (5 - i) * 10),
  );
  const result = selectWeeklyGainers(people);
  assert.equal(result.length, WEEKLY_GAINERS_CAP);
  assert.equal(WEEKLY_GAINERS_CAP, 3);
  assert.deepEqual(
    result.map((p) => p.id),
    ["p1", "p2", "p3"],
  );
});

test("selectWeeklyGainers excludes zero, negative, and null change7d", () => {
  const people = [
    gainer("up", 5),
    gainer("flat", 0),
    gainer("down", -10),
    gainer("null", null),
  ];
  const result = selectWeeklyGainers(people);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "up");
});

test("selectWeeklyGainers returns fewer than cap when pool is thin", () => {
  const people = [gainer("a", 3), gainer("b", 1)];
  const result = selectWeeklyGainers(people);
  assert.equal(result.length, 2);
});
