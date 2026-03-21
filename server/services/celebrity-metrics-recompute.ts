import { db } from "../db";
import {
  celebrityMetrics,
  celebrityValueVotes,
  trendingPeople,
  userVotes,
} from "@shared/schema";
import { and, count, eq, sql } from "drizzle-orm";

/**
 * Recompute display fields on celebrity_metrics from seeds + real votes.
 * Used after value votes and after inducting a new leaderboard member.
 */
export async function recomputeCelebrityMetrics(celebrityId: string) {
  try {
    const [existingMetrics] = await db
      .select({
        seedApprovalCount: celebrityMetrics.seedApprovalCount,
        seedApprovalSum: celebrityMetrics.seedApprovalSum,
        seedUnderratedCount: celebrityMetrics.seedUnderratedCount,
        seedOverratedCount: celebrityMetrics.seedOverratedCount,
        seedFairlyRatedCount: celebrityMetrics.seedFairlyRatedCount,
      })
      .from(celebrityMetrics)
      .where(eq(celebrityMetrics.celebrityId, celebrityId))
      .limit(1);

    const seedApprovalCount = existingMetrics?.seedApprovalCount || 0;
    const seedApprovalSum = existingMetrics?.seedApprovalSum || 0;
    const seedUnderratedCount = existingMetrics?.seedUnderratedCount || 0;
    const seedOverratedCount = existingMetrics?.seedOverratedCount || 0;
    const seedFairlyRatedCount = existingMetrics?.seedFairlyRatedCount || 0;

    const [approvalAgg] = await db
      .select({
        cnt: sql<number>`cast(count(*) as int)`,
        sumRating: sql<number>`coalesce(sum(${userVotes.rating}), 0)::double precision`,
      })
      .from(userVotes)
      .where(eq(userVotes.personId, celebrityId));

    const realApprovalCount = Number(approvalAgg?.cnt ?? 0);
    const realApprovalSum = Number(approvalAgg?.sumRating ?? 0);

    const totalApprovalCount = seedApprovalCount + realApprovalCount;
    const totalApprovalSum = seedApprovalSum + realApprovalSum;

    let approvalVotesCount = totalApprovalCount;
    let approvalAvgRating: number | null = null;
    let approvalPct: number | null = null;

    if (totalApprovalCount > 0) {
      approvalAvgRating = totalApprovalSum / totalApprovalCount;
      approvalPct = Math.round(((approvalAvgRating - 1) / 4) * 100);
    }

    const underratedResult = await db
      .select({ count: count() })
      .from(celebrityValueVotes)
      .where(
        and(
          eq(celebrityValueVotes.celebrityId, celebrityId),
          eq(celebrityValueVotes.vote, "underrated"),
        ),
      );

    const overratedResult = await db
      .select({ count: count() })
      .from(celebrityValueVotes)
      .where(
        and(
          eq(celebrityValueVotes.celebrityId, celebrityId),
          eq(celebrityValueVotes.vote, "overrated"),
        ),
      );

    const fairlyRatedResult = await db
      .select({ count: count() })
      .from(celebrityValueVotes)
      .where(
        and(
          eq(celebrityValueVotes.celebrityId, celebrityId),
          eq(celebrityValueVotes.vote, "fairly_rated"),
        ),
      );

    const realUnderratedCount = Number(underratedResult[0]?.count || 0);
    const realOverratedCount = Number(overratedResult[0]?.count || 0);
    const realFairlyRatedCount = Number(fairlyRatedResult[0]?.count || 0);

    const underratedVotesCount = seedUnderratedCount + realUnderratedCount;
    const overratedVotesCount = seedOverratedCount + realOverratedCount;
    const fairlyRatedVotesCount = seedFairlyRatedCount + realFairlyRatedCount;
    const totalValueVotes =
      underratedVotesCount + overratedVotesCount + fairlyRatedVotesCount;

    let underratedPct: number | null = null;
    let overratedPct: number | null = null;
    let fairlyRatedPct: number | null = null;
    let valueScore: number | null = null;

    if (totalValueVotes > 0) {
      underratedPct = Math.round((underratedVotesCount / totalValueVotes) * 100);
      overratedPct = Math.round((overratedVotesCount / totalValueVotes) * 100);
      fairlyRatedPct = Math.round(
        (fairlyRatedVotesCount / totalValueVotes) * 100,
      );
      valueScore = underratedPct - overratedPct;
    }

    const [trendData] = await db
      .select({
        trendScore: trendingPeople.trendScore,
        fameIndex: trendingPeople.fameIndex,
      })
      .from(trendingPeople)
      .where(eq(trendingPeople.id, celebrityId))
      .limit(1);

    await db
      .insert(celebrityMetrics)
      .values({
        celebrityId,
        trendScore: trendData?.trendScore || 0,
        fameIndex: trendData?.fameIndex || 0,
        seedApprovalCount,
        seedApprovalSum,
        approvalVotesCount,
        approvalAvgRating,
        approvalPct,
        seedUnderratedCount,
        seedOverratedCount,
        seedFairlyRatedCount,
        underratedVotesCount,
        overratedVotesCount,
        fairlyRatedVotesCount,
        underratedPct,
        overratedPct,
        fairlyRatedPct,
        valueScore,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: celebrityMetrics.celebrityId,
        set: {
          trendScore: trendData?.trendScore || 0,
          fameIndex: trendData?.fameIndex || 0,
          approvalVotesCount,
          approvalAvgRating,
          approvalPct,
          underratedVotesCount,
          overratedVotesCount,
          fairlyRatedVotesCount,
          underratedPct,
          overratedPct,
          fairlyRatedPct,
          valueScore,
          updatedAt: new Date(),
        },
      });

    return {
      approvalPct,
      underratedPct,
      overratedPct,
      fairlyRatedPct,
      valueScore,
    };
  } catch (error) {
    console.error("[recomputeCelebrityMetrics] Error:", error);
    throw error;
  }
}
