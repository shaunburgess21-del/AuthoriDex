import { sql } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import {
  USER_BALLOT_SOURCES,
  assertBallotSourceSafe,
  sumBallotCounts,
} from "@shared/lib/user-ballots";

type SqlExecutor = Pick<typeof db, "execute">;

/**
 * Distinct ballots for one account. Seed rows live under synthetic user
 * ids, so a real user's count never includes them. See USER_BALLOT_SOURCES.
 */
export async function countUserBallots(userId: string, executor: SqlExecutor = db): Promise<number> {
  const parts = USER_BALLOT_SOURCES.map((source) => {
    assertBallotSourceSafe(source);
    const filter = "filter" in source && source.filter ? sql.raw(` AND ${source.filter}`) : sql.raw("");
    return sql`(SELECT count(*)::int FROM ${sql.raw(source.table)} WHERE user_id = ${userId}${filter})`;
  });
  const result = await executor.execute(sql`SELECT (${sql.join(parts, sql` + `)})::int AS cnt`);
  const rows = (result as unknown as { rows?: Array<{ cnt: number | string }> }).rows ?? [];
  return sumBallotCounts([Number(rows[0]?.cnt ?? 0)]);
}

/** Write profiles.total_votes when it disagrees with the live ballot count. */
export async function syncUserBallotCount(userId: string): Promise<number> {
  const count = await countUserBallots(userId);
  await db
    .update(profiles)
    .set({ totalVotes: count })
    .where(and(eq(profiles.id, userId), sql`${profiles.totalVotes} IS DISTINCT FROM ${count}`));
  return count;
}
