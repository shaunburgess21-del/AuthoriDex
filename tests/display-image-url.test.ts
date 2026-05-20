import test from "node:test";
import assert from "node:assert/strict";
import { coalesceHttpImage } from "../client/src/lib/displayImageUrl";

test("coalesceHttpImage returns first http(s) URL", () => {
  assert.equal(
    coalesceHttpImage(null, "", "https://a.test/1.jpg", "https://b.test/2.jpg"),
    "https://a.test/1.jpg",
  );
});

test("coalesceHttpImage returns null when no valid URLs", () => {
  assert.equal(coalesceHttpImage(null, "/relative/path"), null);
});
