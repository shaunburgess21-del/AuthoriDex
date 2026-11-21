import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { executeCommentDelete } from "../server/services/comment-delete";

const author = { userId: "author-1", role: "user" };

describe("DELETE /api/comments/:id", () => {
  it("returns 404 when the comment does not exist and does not write", async () => {
    let writes = 0;
    const result = await executeCommentDelete(null, author, async () => {
      writes += 1;
      return { deletedAt: new Date() };
    });
    assert.deepEqual(result, { status: 404, body: { error: "Comment not found" } });
    assert.equal(writes, 0);
  });

  it("returns 403 for someone else, including an admin", async () => {
    let writes = 0;
    const comment = { userId: "author-1", deletedAt: null };
    const stranger = await executeCommentDelete(comment, { userId: "other", role: "user" }, async () => {
      writes += 1;
      return { deletedAt: new Date() };
    });
    const admin = await executeCommentDelete(comment, { userId: "admin-1", role: "admin" }, async () => {
      writes += 1;
      return { deletedAt: new Date() };
    });
    assert.equal(stranger.status, 403);
    assert.equal(admin.status, 403);
    assert.deepEqual(admin.body, { error: "Forbidden" });
    assert.equal(writes, 0);
  });

  it("soft-deletes the author's row and returns the stored timestamp", async () => {
    const stored = new Date("2026-11-21T12:00:00.000Z");
    const result = await executeCommentDelete(
      { userId: "author-1", deletedAt: null },
      author,
      async () => ({ deletedAt: stored }),
    );
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { success: true, deletedAt: stored });
  });

  it("is idempotent when the row is already soft-deleted", async () => {
    const stored = new Date("2026-11-20T00:00:00.000Z");
    let writes = 0;
    const result = await executeCommentDelete(
      { userId: "author-1", deletedAt: stored },
      author,
      async () => {
        writes += 1;
        return { deletedAt: new Date() };
      },
    );
    assert.deepEqual(result, { status: 200, body: { success: true, deletedAt: stored } });
    assert.equal(writes, 0);
  });

  it("returns 404 when the update matches zero rows instead of a fake success", async () => {
    const missing = await executeCommentDelete(
      { userId: "author-1", deletedAt: null },
      author,
      async () => undefined,
    );
    const emptyStamp = await executeCommentDelete(
      { userId: "author-1", deletedAt: null },
      author,
      async () => ({ deletedAt: null }),
    );
    assert.deepEqual(missing, { status: 404, body: { error: "Comment not found" } });
    assert.deepEqual(emptyStamp, { status: 404, body: { error: "Comment not found" } });
  });
});

describe("delete route wiring", () => {
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const start = routes.indexOf('app.delete("/api/comments/:id"');
  const end = routes.indexOf('app.post("/api/comments/:id/vote"');
  const block = routes.slice(start, end);

  it("requires auth and uses the shared delete result, including a real RETURNING row", () => {
    assert.ok(start > 0 && end > start);
    assert.match(block, /requireAuth/);
    assert.match(block, /executeCommentDelete/);
    assert.match(block, /eq\(unifiedComments\.userId, userId\)/);
    assert.match(block, /returning\(\{ deletedAt: unifiedComments\.deletedAt \}\)/);
    assert.equal(block.includes("updated?.deletedAt ??"), false);
  });
});
