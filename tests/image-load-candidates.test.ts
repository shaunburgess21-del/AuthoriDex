import test from "node:test";
import assert from "node:assert/strict";
import { buildImageLoadCandidates } from "../client/src/lib/imageResolver";

test("buildImageLoadCandidates tries the primary URL first when it already has an extension", () => {
  const primary =
    "https://example.test/matchups/disney-vs-universal/disney.jpg";
  const candidates = buildImageLoadCandidates(primary);
  assert.equal(candidates[0], primary);
  assert.ok(candidates.includes(`${primary.replace(".jpg", "")}.webp`));
});

test("buildImageLoadCandidates keeps bare URLs when no extension is present", () => {
  const primary = "https://example.test/matchups/foo/bar";
  assert.deepEqual(buildImageLoadCandidates(primary), [primary]);
});

test("buildImageLoadCandidates appends fallback after extension variants", () => {
  const primary =
    "https://example.test/matchups/disney-vs-universal/disney.jpg";
  const fallback = "https://example.test/avatars/disney.webp";
  const candidates = buildImageLoadCandidates(primary, fallback);
  assert.equal(candidates.at(-1), fallback);
});
