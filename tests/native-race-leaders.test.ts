import test from "node:test";
import assert from "node:assert/strict";
import { getTopRaceEntries } from "../client/src/lib/nativeRaceLeaders";

test("getTopRaceEntries sorts by percent gain descending", () => {
  const entries = [
    {
      label: "Slow",
      personId: "a",
      person: { name: "Alice", avatar: "https://a.test/a.jpg", trendScore: 110, change7d: 1 },
    },
    {
      label: "Fast",
      personId: "b",
      person: { name: "Bob", avatar: "https://a.test/b.jpg", trendScore: 150, change7d: 5 },
    },
  ];
  const metadata = {
    openingScores: [
      { personId: "a", score: 100 },
      { personId: "b", score: 100 },
    ],
  };

  const top = getTopRaceEntries(entries, metadata, 4);
  assert.equal(top.length, 2);
  assert.equal(top[0].name, "Bob");
  assert.equal(top[1].name, "Alice");
  assert.equal(top[0].avatar, "https://a.test/b.jpg");
});

test("getTopRaceEntries returns empty for no entries", () => {
  assert.deepEqual(getTopRaceEntries([], null, 4), []);
});
