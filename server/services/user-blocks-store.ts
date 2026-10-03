import { and, desc, eq } from "drizzle-orm";
import { profiles, userBlocks } from "@shared/schema";
import { db } from "../db";
import {
  listBlockedUserIds,
  type UserBlockStore,
} from "./user-blocks";

export const dbUserBlockStore: UserBlockStore = {
  async insert(record) {
    const inserted = await db
      .insert(userBlocks)
      .values({
        blockerId: record.blockerId,
        blockedId: record.blockedId,
        createdAt: record.createdAt,
      })
      .onConflictDoNothing({ target: [userBlocks.blockerId, userBlocks.blockedId] })
      .returning({ blockerId: userBlocks.blockerId });
    return inserted.length > 0 ? "inserted" : "exists";
  },
  async delete(blockerId, blockedId) {
    const removed = await db
      .delete(userBlocks)
      .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
      .returning({ blockerId: userBlocks.blockerId });
    return removed.length > 0;
  },
  async list(blockerId) {
    return db
      .select({
        blockerId: userBlocks.blockerId,
        blockedId: userBlocks.blockedId,
        createdAt: userBlocks.createdAt,
      })
      .from(userBlocks)
      .where(eq(userBlocks.blockerId, blockerId))
      .orderBy(desc(userBlocks.createdAt));
  },
  async profileExists(userId) {
    const [row] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return Boolean(row);
  },
};

export async function blockedUserIdSet(viewerId: string | null | undefined): Promise<Set<string>> {
  if (!viewerId) return new Set();
  const ids = await listBlockedUserIds(dbUserBlockStore, viewerId);
  return new Set(ids);
}

export interface ViewerBlockSummary {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  blockedAt: string;
}

export async function listBlocksForViewer(blockerId: string): Promise<ViewerBlockSummary[]> {
  const rows = await db
    .select({
      userId: userBlocks.blockedId,
      username: profiles.username,
      avatarUrl: profiles.avatarUrl,
      blockedAt: userBlocks.createdAt,
    })
    .from(userBlocks)
    .leftJoin(profiles, eq(userBlocks.blockedId, profiles.id))
    .where(eq(userBlocks.blockerId, blockerId))
    .orderBy(desc(userBlocks.createdAt));

  return rows.map((row) => ({
    userId: row.userId,
    username: row.username,
    avatarUrl: row.avatarUrl,
    blockedAt: row.blockedAt.toISOString(),
  }));
}
