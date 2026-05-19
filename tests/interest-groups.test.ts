import test from "node:test";
import assert from "node:assert/strict";
import {
  expandInterestId,
  expandStatedInterests,
} from "../shared/interest-groups";

test("expandInterestId links gaming and streaming", () => {
  assert.deepEqual(expandInterestId("gaming"), ["gaming", "streaming"]);
  assert.deepEqual(expandInterestId("Streaming"), ["gaming", "streaming"]);
});

test("expandInterestId passes through unlinked categories", () => {
  assert.deepEqual(expandInterestId("tech"), ["tech"]);
});

test("expandStatedInterests expands linked groups and dedupes", () => {
  assert.deepEqual(expandStatedInterests(["gaming"]), ["gaming", "streaming"]);
  assert.deepEqual(expandStatedInterests(["streaming"]), ["gaming", "streaming"]);
  assert.deepEqual(expandStatedInterests(["gaming", "streaming"]), [
    "gaming",
    "streaming",
  ]);
  assert.deepEqual(expandStatedInterests(["tech", "gaming"]), [
    "tech",
    "gaming",
    "streaming",
  ]);
});
