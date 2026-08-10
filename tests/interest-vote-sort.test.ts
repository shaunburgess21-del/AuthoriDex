import test from "node:test";
import assert from "node:assert/strict";

import { sortByInterestThenVotes } from "../server/lib/interestVoteSort";
import { getCategoryBucketId } from "../shared/constants";

type Card = {
  id: string;
  category: string | null;
  secondaryCategories?: string[] | null;
  totalVotes: number;
};

const cards: Card[] = [
  { id: "old-sport", category: "Sports", totalVotes: 150 },
  { id: "new-music", category: "music", totalVotes: 15 },
  { id: "old-tech", category: "tech", totalVotes: 120 },
  { id: "new-sport", category: "sports", totalVotes: 16 },
];

const ids = (list: Card[]) => list.map((c) => c.id);
const byCategory = (c: Card) => c.category;
const byVotes = (c: Card) => c.totalVotes;
const bySecondary = (c: Card) => c.secondaryCategories;
const preferred = (...raw: string[]) => new Set(raw.map((id) => getCategoryBucketId(id)));

test("cold-start users keep the incoming order untouched", () => {
  assert.deepEqual(
    ids(sortByInterestThenVotes(cards, null, byCategory, byVotes)),
    ids(cards),
  );
  assert.deepEqual(
    ids(sortByInterestThenVotes(cards, new Set(), byCategory, byVotes)),
    ids(cards),
  );
});

test("interest categories lead, most votes first inside each bucket", () => {
  const sorted = sortByInterestThenVotes(
    cards,
    preferred("music"),
    byCategory,
    byVotes,
  );
  assert.deepEqual(ids(sorted), ["new-music", "old-sport", "old-tech", "new-sport"]);
});

test("category matching is case-insensitive and alias-aware", () => {
  const sorted = sortByInterestThenVotes(
    cards,
    preferred("sports"),
    byCategory,
    byVotes,
  );
  assert.deepEqual(ids(sorted), ["old-sport", "new-sport", "old-tech", "new-music"]);
});

test("Food & Drink spelling aliases into food-drink interest bucket", () => {
  const foodCards: Card[] = [
    { id: "legacy-label", category: "Food & Drink", totalVotes: 20 },
    { id: "kebab", category: "food-drink", totalVotes: 10 },
    { id: "other", category: "tech", totalVotes: 99 },
  ];
  const sorted = sortByInterestThenVotes(
    foodCards,
    preferred("food-drink"),
    byCategory,
    byVotes,
  );
  assert.deepEqual(ids(sorted), ["legacy-label", "kebab", "other"]);
});

test("secondary categories count as interest matches", () => {
  const mixed: Card[] = [
    { id: "primary-tech", category: "tech", totalVotes: 5 },
    {
      id: "secondary-tech",
      category: "misc",
      secondaryCategories: ["Tech"],
      totalVotes: 50,
    },
    { id: "unrelated", category: "music", totalVotes: 200 },
  ];
  const sorted = sortByInterestThenVotes(
    mixed,
    preferred("tech"),
    byCategory,
    byVotes,
    bySecondary,
  );
  assert.deepEqual(ids(sorted), ["secondary-tech", "primary-tech", "unrelated"]);
});

test("equal votes keep the incoming order as tiebreak", () => {
  const tied: Card[] = [
    { id: "b", category: "tech", totalVotes: 10 },
    { id: "a", category: "tech", totalVotes: 10 },
    { id: "c", category: "tech", totalVotes: 10 },
  ];
  const sorted = sortByInterestThenVotes(tied, preferred("tech"), byCategory, byVotes);
  assert.deepEqual(ids(sorted), ["b", "a", "c"]);
});

test("null categories are treated as non-interest", () => {
  const withNull: Card[] = [
    { id: "uncategorised", category: null, totalVotes: 99 },
    { id: "interest", category: "tech", totalVotes: 1 },
  ];
  const sorted = sortByInterestThenVotes(
    withNull,
    preferred("tech"),
    byCategory,
    byVotes,
  );
  assert.deepEqual(ids(sorted), ["interest", "uncategorised"]);
});

test("non-finite vote totals sort as zero", () => {
  const messy: Card[] = [
    { id: "nan", category: "tech", totalVotes: Number.NaN },
    { id: "real", category: "tech", totalVotes: 3 },
  ];
  const sorted = sortByInterestThenVotes(messy, preferred("tech"), byCategory, byVotes);
  assert.deepEqual(ids(sorted), ["real", "nan"]);
});

test("does not mutate the input array", () => {
  const input = [...cards];
  sortByInterestThenVotes(input, preferred("music"), byCategory, byVotes);
  assert.deepEqual(ids(input), ids(cards));
});
