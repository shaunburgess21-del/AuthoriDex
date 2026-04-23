import test from "node:test";
import assert from "node:assert/strict";

import { classifyImageVoteAction } from "../server/utils/image-vote-transition";

test("classifyImageVoteAction returns 'insert' when user has no prior vote on this person", () => {
  assert.equal(classifyImageVoteAction(null, "img-b"), "insert");
  assert.equal(classifyImageVoteAction(undefined, "img-b"), "insert");
});

test("classifyImageVoteAction returns 'noop' when user already voted for the same image", () => {
  assert.equal(classifyImageVoteAction({ imageId: "img-a" }, "img-a"), "noop");
});

test("classifyImageVoteAction returns 'swap' when user previously voted for a different image on the same person", () => {
  assert.equal(classifyImageVoteAction({ imageId: "img-a" }, "img-b"), "swap");
});
