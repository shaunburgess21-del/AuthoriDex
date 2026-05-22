import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMENT_PARENT_POOL_SIZE,
  mergeParentPoolRows,
  type CommentParentPoolRow,
} from "../server/agents/commentParentPoolMerge.ts";

const row = (id: string): CommentParentPoolRow => ({
  parentId: id,
  title: `Title ${id}`,
  category: "sports",
});

test("mergeParentPoolRows dedupes overlapping ids", () => {
  const recent = [row("a"), row("b"), row("c")];
  const explore = [row("b"), row("d"), row("e")];
  const { rows, stats } = mergeParentPoolRows(recent, explore);

  assert.deepEqual(
    rows.map((r) => r.parentId),
    ["a", "b", "c", "d", "e"],
  );
  assert.equal(stats.recent, 3);
  assert.equal(stats.explore, 3);
  assert.equal(stats.merged, 5);
});

test("mergeParentPoolRows respects maxSize cap", () => {
  const recent = Array.from({ length: 100 }, (_, i) => row(`r${i}`));
  const explore = Array.from({ length: 100 }, (_, i) => row(`e${i}`));
  const { rows } = mergeParentPoolRows(recent, explore, 50);
  assert.equal(rows.length, 50);
});

test("mergeParentPoolRows prefers recent order before explore when deduping", () => {
  const recent = [row("shared")];
  const explore = [row("shared"), row("only-explore")];
  const { rows } = mergeParentPoolRows(recent, explore);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].parentId, "shared");
});

test("mergeParentPoolRows defaults max size to COMMENT_PARENT_POOL_SIZE", () => {
  const recent = Array.from({ length: COMMENT_PARENT_POOL_SIZE }, (_, i) =>
    row(`r${i}`),
  );
  const explore = [row("overflow")];
  const { rows } = mergeParentPoolRows(recent, explore);
  assert.equal(rows.length, COMMENT_PARENT_POOL_SIZE);
  assert.equal(rows.some((r) => r.parentId === "overflow"), false);
});

test("mergeParentPoolRows fills pool when explore over-fetches past recent overlap", () => {
  const recent = Array.from({ length: 70 }, (_, i) => row(`recent-${i}`));
  const explore = [
    ...recent.slice(0, 40),
    ...Array.from({ length: 160 }, (_, i) => row(`explore-only-${i}`)),
  ];
  const { rows, stats } = mergeParentPoolRows(recent, explore);
  assert.equal(stats.merged, COMMENT_PARENT_POOL_SIZE);
  assert.equal(rows.length, COMMENT_PARENT_POOL_SIZE);
});
