import test from "node:test";
import assert from "node:assert/strict";

// Dummy DATABASE_URL before importing anything that could transitively load
// server/db.ts. Same pattern as the other market-scout tests.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost:5432/test";
}

const { mergeLinkablePeople, normalizeNameKey } = await import(
  "../server/jobs/market-scout"
);

test("normalizeNameKey strips diacritics and collapses whitespace", () => {
  assert.equal(normalizeNameKey("  Kylian  Mbappé "), "kylian mbappe");
});

test("mergeLinkablePeople includes main leaderboard and active induction", () => {
  const merged = mergeLinkablePeople(
    [{ id: "main-1", name: "Taylor Swift" }],
    [{ id: "ind-1", name: "Ryan Cohen" }],
  );
  assert.equal(merged.size, 2);
  assert.equal(merged.get(normalizeNameKey("Taylor Swift"))?.id, "main-1");
  assert.equal(merged.get(normalizeNameKey("Ryan Cohen"))?.id, "ind-1");
});

test("mergeLinkablePeople: main leaderboard wins on name collision", () => {
  const merged = mergeLinkablePeople(
    [{ id: "main-dup", name: "Jane Doe" }],
    [{ id: "ind-dup", name: "Jane Doe" }],
  );
  assert.equal(merged.size, 1);
  assert.equal(merged.get(normalizeNameKey("Jane Doe"))?.id, "main-dup");
});

test("mergeLinkablePeople skips blank names", () => {
  const merged = mergeLinkablePeople(
    [{ id: "main-1", name: "   " }],
    [{ id: "ind-1", name: "Ryan Cohen" }],
  );
  assert.equal(merged.size, 1);
  assert.equal(merged.get(normalizeNameKey("Ryan Cohen"))?.id, "ind-1");
});

test("mergeLinkablePeople is case/diacritic insensitive for keys", () => {
  const merged = mergeLinkablePeople(
    [{ id: "main-1", name: "José" }],
    [{ id: "ind-1", name: "jose" }],
  );
  assert.equal(merged.size, 1);
  assert.equal(merged.get("jose")?.id, "main-1");
});
