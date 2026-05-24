/**
 * Sunday 17:30–18:00 UTC — snapshot lifetime leaderboard rank for active users.
 */

import { userRankSnapshots } from "@shared/schema";
import { logger } from "../log";
import { getUserLeaderboardRanksForPeriod } from "../services/leaderboard-user-ranks";
import { isoYearWeek, isRankSnapshotFireWindow } from "./weekly-digest-utils";
import { listActiveDigestUserIds } from "./weekly-digest-stats";
import { db } from "../db";

const RANK_PERIOD = "all";

export async function runUserRankSnapshot(): Promise<number> {
  if (!isRankSnapshotFireWindow()) return 0;

  const isoWeek = isoYearWeek(new Date());
  const activeUserIds = await listActiveDigestUserIds();
  if (activeUserIds.length === 0) return 0;

  const rankByUser = await getUserLeaderboardRanksForPeriod(RANK_PERIOD);
  const activeSet = new Set(activeUserIds);

  let inserted = 0;
  let skipped = 0;

  for (const userId of activeUserIds) {
    const rank = rankByUser.get(userId);
    if (rank == null) {
      skipped += 1;
      continue;
    }

    const [row] = await db
      .insert(userRankSnapshots)
      .values({
        userId,
        isoWeek,
        period: RANK_PERIOD,
        rank,
      })
      .onConflictDoNothing({
        target: [
          userRankSnapshots.userId,
          userRankSnapshots.isoWeek,
          userRankSnapshots.period,
        ],
      })
      .returning({ userId: userRankSnapshots.userId });

    if (row) inserted += 1;
    else skipped += 1;
  }

  logger.info(
    {
      event: "email.rank_snapshot.complete",
      isoWeek,
      activeUsers: activeSet.size,
      leaderboardSize: rankByUser.size,
      inserted,
      skipped,
    },
    "[rank-snapshot] Weekly rank snapshot complete",
  );

  return inserted;
}
