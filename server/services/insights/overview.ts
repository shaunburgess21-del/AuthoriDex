import type { InsightsOverviewResponse, InsightsMoverItem } from "@shared/insights/types";
import type { TrendingPerson } from "@shared/schema";
import { QUADRANT_MIN_VOTES } from "@shared/insights/constants";
import { db } from "../../db";
import {
  celebrityMetrics,
  marketEntries,
  matchups,
  opinionPollOptions,
  opinionPolls,
  predictionMarkets,
  trendingPolls,
  userFavourites,
} from "@shared/schema";
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getCachedTrendingPeople } from "./insights-people-cache";
import { loadDriversSummary, loadPersonSignals } from "./drivers";
import { getInsightsStory } from "./story";
import { loadLatestSnapshotsByPerson } from "./snapshot-batch";
import { withDiscoverCache } from "./discover-cache";

async function countFavouriteActivity(
  favPersonIds: string[],
): Promise<{ pendingMarketsCount: number; pendingPollsCount: number }> {
  if (favPersonIds.length === 0) {
    return { pendingMarketsCount: 0, pendingPollsCount: 0 };
  }

  // Run all four counts in parallel — each is a small indexed lookup keyed
  // by personId. Native markets need DISTINCT marketId because a market may
  // reference two favourites at once (h2h).
  const [marketsRow, matchupsRow, opinionRow, trendingRow] = await Promise.all([
    db
      .select({ n: sql<number>`COUNT(DISTINCT ${predictionMarkets.id})::int` })
      .from(marketEntries)
      .innerJoin(
        predictionMarkets,
        eq(predictionMarkets.id, marketEntries.marketId),
      )
      .where(
        and(
          inArray(marketEntries.personId, favPersonIds),
          eq(predictionMarkets.status, "OPEN"),
          inArray(predictionMarkets.marketType, ["h2h", "updown"]),
        ),
      ),
    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(matchups)
      .where(
        and(
          or(
            inArray(matchups.personAId, favPersonIds),
            inArray(matchups.personBId, favPersonIds),
          ),
          eq(matchups.visibility, "live"),
        ),
      ),
    db
      .select({ n: sql<number>`COUNT(DISTINCT ${opinionPolls.id})::int` })
      .from(opinionPollOptions)
      .innerJoin(
        opinionPolls,
        eq(opinionPolls.id, opinionPollOptions.pollId),
      )
      .where(
        and(
          inArray(opinionPollOptions.personId, favPersonIds),
          eq(opinionPolls.visibility, "live"),
        ),
      ),
    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(trendingPolls)
      .where(
        and(
          inArray(trendingPolls.personId, favPersonIds),
          eq(trendingPolls.visibility, "live"),
        ),
      ),
  ]);

  return {
    pendingMarketsCount: Number(marketsRow[0]?.n ?? 0),
    pendingPollsCount:
      Number(matchupsRow[0]?.n ?? 0) +
      Number(opinionRow[0]?.n ?? 0) +
      Number(trendingRow[0]?.n ?? 0),
  };
}

const MOVER_PAGE_SIZE = 20;

function toMoverItem(p: TrendingPerson): InsightsMoverItem {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar ?? null,
    category: p.category ?? null,
    rank: p.rank,
    fameIndex: p.fameIndex ?? null,
    change24h: p.change24h ?? null,
    change7d: p.change7d ?? null,
    rankChange: null,
  };
}

function buildMoversForWindow(
  peopleList: TrendingPerson[],
  field: "change24h" | "change7d",
): { climbers: InsightsMoverItem[]; droppers: InsightsMoverItem[] } {
  const climbers = [...peopleList]
    .filter((p) => (p[field] ?? 0) > 0)
    .sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0))
    .slice(0, MOVER_PAGE_SIZE)
    .map(toMoverItem);

  const droppers = [...peopleList]
    .filter((p) => (p[field] ?? 0) < 0)
    .sort((a, b) => (a[field] ?? 0) - (b[field] ?? 0))
    .slice(0, MOVER_PAGE_SIZE)
    .map(toMoverItem);

  return { climbers, droppers };
}

function assignQuadrant(
  fameIndex: number,
  approvalPct: number,
  medianFame: number,
  medianApproval: number,
): InsightsOverviewResponse["quadrantPoints"][0]["quadrant"] {
  const highFame = fameIndex >= medianFame;
  const highApproval = approvalPct >= medianApproval;
  if (highFame && highApproval) return "beloved_giants";
  if (highFame && !highApproval) return "hated_giants";
  if (!highFame && highApproval) return "cult_favourites";
  return "unknown_critics";
}

async function loadInsightsOverviewInner(
  userId?: string | null,
): Promise<InsightsOverviewResponse> {
  const [metricsRows, peopleList, snapshots, story, favRows] = await Promise.all([
    db
      .select({
        celebrityId: celebrityMetrics.celebrityId,
        approvalPct: celebrityMetrics.approvalPct,
        approvalAvgRating: celebrityMetrics.approvalAvgRating,
        approvalVotesCount: celebrityMetrics.approvalVotesCount,
        fameIndex: celebrityMetrics.fameIndex,
      })
      .from(celebrityMetrics)
      .where(gte(celebrityMetrics.approvalVotesCount, QUADRANT_MIN_VOTES)),
    getCachedTrendingPeople(),
    loadLatestSnapshotsByPerson(),
    getInsightsStory(),
    userId
      ? db
          .select({ personId: userFavourites.personId })
          .from(userFavourites)
          .where(eq(userFavourites.userId, userId))
      : Promise.resolve([]),
  ]);

  const [signals, driverMix] = await Promise.all([
    loadPersonSignals({ snapshots }),
    loadDriversSummary(20, { people: peopleList, snapshots }),
  ]);

  const eligible = metricsRows.filter(
    (m) => (m.approvalVotesCount ?? 0) >= QUADRANT_MIN_VOTES && m.approvalPct != null,
  );

  const fameValues = eligible.map((m) => m.fameIndex ?? 0).sort((a, b) => a - b);
  const approvalValues = eligible.map((m) => m.approvalPct ?? 0).sort((a, b) => a - b);
  const medianFame = fameValues[Math.floor(fameValues.length / 2)] ?? 0;
  const medianApproval = approvalValues[Math.floor(approvalValues.length / 2)] ?? 50;

  const peopleMap = new Map(peopleList.map((p) => [p.id, p]));

  const quadrantPoints = eligible.map((m) => {
    const person = peopleMap.get(m.celebrityId);
    // Prefer the live trending Trend Score so the quadrant matches the profile,
    // rankings, and movers (celebrityMetrics.fameIndex can lag behind ingest).
    const fame = person?.fameIndex ?? m.fameIndex ?? 0;
    const approval = m.approvalPct ?? 0;
    return {
      id: m.celebrityId,
      name: person?.name ?? "Unknown",
      avatar: person?.avatar ?? null,
      category: person?.category ?? null,
      fameIndex: fame,
      approvalPct: approval,
      approvalAvgRating: m.approvalAvgRating,
      approvalVotesCount: m.approvalVotesCount ?? 0,
      quadrant: assignQuadrant(fame, approval, medianFame, medianApproval),
    };
  });

  const movers24h = buildMoversForWindow(peopleList, "change24h");
  const movers7d = buildMoversForWindow(peopleList, "change7d");

  let favouritesSignals: InsightsOverviewResponse["favouritesSignals"];
  if (userId) {
    const favIds = new Set(favRows.map((f) => f.personId));
    const favTrending = peopleList.filter((p) => favIds.has(p.id));

    let newsDrivenCount = 0;
    let top50CrossedCount = 0;
    for (const p of favTrending) {
      const sig = signals.get(p.id);
      if (sig?.primaryDriver === "NEWS") newsDrivenCount++;
      if (p.rank <= 50 && (p.change7d ?? 0) > 2) top50CrossedCount++;
    }

    const movedFavourites = favTrending
      .filter((p) => typeof p.change24h === "number" && Math.abs(p.change24h ?? 0) >= 0.1)
      .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))
      .slice(0, 4);

    const highlights: NonNullable<InsightsOverviewResponse["favouritesSignals"]>["highlights"] =
      movedFavourites.map((p) => {
        const sig = signals.get(p.id);
        return {
          personId: p.id,
          name: p.name,
          avatar: p.avatar ?? null,
          category: p.category ?? null,
          rank: p.rank,
          change24h: p.change24h ?? 0,
          primaryDriver: sig?.primaryDriver ?? null,
        };
      });

    // Compute markets / polls counts in parallel with the rest of the
    // overview. We skip this when the user has no favourites since both
    // queries would always return 0.
    const activity =
      favTrending.length > 0
        ? await countFavouriteActivity(favTrending.map((p) => p.id))
        : { pendingMarketsCount: 0, pendingPollsCount: 0 };

    favouritesSignals = {
      summary:
        favTrending.length > 0
          ? `How the ${favTrending.length} ${favTrending.length === 1 ? "person" : "people"} you follow are moving today.`
          : "",
      favouriteCount: favTrending.length,
      highlights,
      newsDrivenCount,
      top50CrossedCount,
      pendingMarketsCount: activity.pendingMarketsCount,
      pendingPollsCount: activity.pendingPollsCount,
    };
  }

  return {
    quadrantPoints,
    quadrantMeta: {
      includedCount: quadrantPoints.length,
      totalEligible: metricsRows.length,
      medianFame,
      medianApproval,
      minVotes: QUADRANT_MIN_VOTES,
    },
    driverMix,
    movers: {
      "24h": movers24h,
      "7d": movers7d,
    },
    story,
    favouritesSignals,
  };
}

export async function loadInsightsOverview(
  userId?: string | null,
): Promise<InsightsOverviewResponse> {
  return withDiscoverCache(`overview:${userId ?? "anon"}`, () =>
    loadInsightsOverviewInner(userId),
  );
}
