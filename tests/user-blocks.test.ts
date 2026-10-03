import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  blockUser,
  listBlockedUserIds,
  omitBlockedAuthors,
  unblockUser,
  type UserBlockRecord,
  type UserBlockStore,
} from "../server/services/user-blocks";

class MemoryUserBlockStore implements UserBlockStore {
  readonly rows = new Map<string, UserBlockRecord>();
  readonly profiles = new Set<string>();

  private key(blockerId: string, blockedId: string): string {
    return `${blockerId}\0${blockedId}`;
  }

  async insert(record: UserBlockRecord): Promise<"inserted" | "exists"> {
    const key = this.key(record.blockerId, record.blockedId);
    if (this.rows.has(key)) return "exists";
    this.rows.set(key, { ...record });
    return "inserted";
  }

  async delete(blockerId: string, blockedId: string): Promise<boolean> {
    return this.rows.delete(this.key(blockerId, blockedId));
  }

  async list(blockerId: string): Promise<UserBlockRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.blockerId === blockerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async profileExists(userId: string): Promise<boolean> {
    return this.profiles.has(userId);
  }
}

interface SampleComment {
  id: string;
  userId: string;
  parentCommentId: string | null;
  body: string;
}

const comments: SampleComment[] = [
  { id: "root", userId: "author", parentCommentId: null, body: "visible root" },
  { id: "by-blocked", userId: "blocked", parentCommentId: "root", body: "hidden from blocker" },
  { id: "reply-under-blocked", userId: "other", parentCommentId: "by-blocked", body: "still visible" },
  { id: "by-blocker", userId: "blocker", parentCommentId: "root", body: "blocker's own comment" },
];

describe("user blocks", () => {
  it("persists a one-way block and hides that author's comments only for the blocker", async () => {
    const store = new MemoryUserBlockStore();
    store.profiles.add("blocker");
    store.profiles.add("blocked");
    store.profiles.add("other");

    const created = await blockUser(store, "blocker", "blocked", new Date("2026-10-03T00:00:00Z"));
    assert.deepEqual(created, { ok: true, alreadyBlocked: false });

    const again = await blockUser(store, "blocker", "blocked");
    assert.deepEqual(again, { ok: true, alreadyBlocked: true });

    const blockedIds = await listBlockedUserIds(store, "blocker");
    assert.deepEqual(blockedIds, ["blocked"]);
    assert.deepEqual(await listBlockedUserIds(store, "blocked"), []);

    const forBlocker = omitBlockedAuthors(comments, new Set(blockedIds));
    assert.deepEqual(forBlocker.map((comment) => comment.id), ["root", "reply-under-blocked", "by-blocker"]);
    assert.equal(
      forBlocker.find((comment) => comment.id === "reply-under-blocked")?.parentCommentId,
      "root",
    );
    assert.equal(comments.find((comment) => comment.id === "by-blocked")?.body, "hidden from blocker");

    const forSomeoneElse = omitBlockedAuthors(comments, new Set(await listBlockedUserIds(store, "other")));
    assert.deepEqual(forSomeoneElse, comments);
  });

  it("restores comments after unblock", async () => {
    const store = new MemoryUserBlockStore();
    store.profiles.add("blocker");
    store.profiles.add("blocked");

    await blockUser(store, "blocker", "blocked");
    const hidden = omitBlockedAuthors(comments, new Set(await listBlockedUserIds(store, "blocker")));
    assert.equal(hidden.some((comment) => comment.userId === "blocked"), false);

    const removed = await unblockUser(store, "blocker", "blocked");
    assert.deepEqual(removed, { ok: true, unblocked: true });
    assert.deepEqual(await listBlockedUserIds(store, "blocker"), []);

    const restored = omitBlockedAuthors(comments, new Set(await listBlockedUserIds(store, "blocker")));
    assert.deepEqual(restored, comments);
  });

  it("rejects a self-block and does not persist it", async () => {
    const store = new MemoryUserBlockStore();
    store.profiles.add("blocker");

    const result = await blockUser(store, "blocker", "blocker");
    assert.deepEqual(result, { ok: false, reason: "self" });
    assert.deepEqual(await listBlockedUserIds(store, "blocker"), []);
  });

  it("does not block a user who has no profile", async () => {
    const store = new MemoryUserBlockStore();
    store.profiles.add("blocker");

    const result = await blockUser(store, "blocker", "missing");
    assert.deepEqual(result, { ok: false, reason: "not_found" });
    assert.equal(store.rows.size, 0);
  });

  it("migration adds an additive one-way user_blocks table", () => {
    const sqlPath = path.join(process.cwd(), "migrations", "0103_user_blocks.sql");
    const journalPath = path.join(process.cwd(), "migrations", "meta", "_journal.json");
    const sql = fs.readFileSync(sqlPath, "utf8");
    const journal = fs.readFileSync(journalPath, "utf8");

    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.user_blocks/);
    assert.match(sql, /PRIMARY KEY \(blocker_id, blocked_id\)/);
    assert.match(sql, /CONSTRAINT user_blocks_not_self CHECK \(blocker_id <> blocked_id\)/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /ON DELETE CASCADE/);
    assert.doesNotMatch(sql, /DROP TABLE/i);
    assert.match(journal, /"tag": "0103_user_blocks"/);
  });
});
