import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCategoryBucketId, resolveCategoryColorKey } from "../shared/constants";

describe("category colour keys", () => {
  it("maps media-and-podcast slug to media bucket", () => {
    assert.equal(getCategoryBucketId("Media & Podcast"), "media");
    assert.equal(resolveCategoryColorKey("Media & Podcast"), "media");
  });

  it("prefers explicit canonical override", () => {
    assert.equal(resolveCategoryColorKey("Media & Podcast", "media"), "media");
  });
});
