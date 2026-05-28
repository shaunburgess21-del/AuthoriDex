import type { InsightsOverviewResponse } from "@shared/insights/types";
import { INSIGHTS_DRIVER_LABELS, QUADRANT_MIN_VOTES } from "@shared/insights/constants";
import { db } from "../../db";
import { celebrityMetrics, userFavourites } from "@shared/schema";
import { eq, gte } from "drizzle-orm";
import { storage } from "../../storage";
import { loadDriversSummary, loadPersonSignals } from "./drivers";
import { getInsightsStory } from "./story";
import { loadLatestSnapshotsByPerson } from "./snapshot-batch";
import { withDiscoverCache } from "./discover-cache";

const MOVER_PAGE_SIZE = 20;

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
    storage.getTrendingPeople(),
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
    const fame = m.fameIndex ?? person?.fameIndex ?? 0;
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

  const climbers = [...peopleList]
    .filter((p) => (p.change7d ?? 0) > 0)
    .sort((a, b) => (b.change7d ?? 0) - (a.change7d ?? 0))
    .slice(0, MOVER_PAGE_SIZE)
    .map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar ?? null,
      category: p.category ?? null,
      rank: p.rank,
      fameIndex: p.fameIndex ?? null,
      change24h: p.change24h ?? null,
      change7d: p.change7d ?? null,
      rankChange: null as number | null,
    }));

  const droppers = [...peopleList]
    .filter((p) => (p.change7d ?? 0) < 0)
    .sort((a, b) => (a.change7d ?? 0) - (b.change7d ?? 0))
    .slice(0, MOVER_PAGE_SIZE)
    .map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar ?? null,
      category: p.category ?? null,
      rank: p.rank,
      fameIndex: p.fameIndex ?? null,
      change24h: p.change24h ?? null,
      change7d: p.change7d ?? null,
      rankChange: null as number | null,
    }));

  let favouritesSignals: InsightsOverviewResponse["favouritesSignals"];
  if (userId && favRows.length > 0) {
    const favIds = new Set(favRows.map((f) => f.personId));
    const favTrending = peopleList.filter((p) => favIds.has(p.id));

    let newsDrivenCount = 0;
    let top50CrossedCount = 0;

    for (const p of favTrending) {
      const sig = signals.get(p.id);
      if (sig?.primaryDriver === "NEWS") newsDrivenCount++;
      if (p.rank <= 50 && (p.change7d ?? 0) > 2) top50CrossedCount++;
    }

    const highlights: NonNullable<InsightsOverviewResponse["favouritesSignals"]>["highlights"] =
      [];
    const biggest = [...favTrending]
      .filter((p) => typeof p.change24h === "number")
      .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))[0];

    if (biggest) {
      const sig = signals.get(biggest.id);
      const driverSuffix = sig ? ` — ${INSIGHTS_DRIVER_LABELS[sig.primaryDriver]}` : "";
      highlights.push({
        personId: biggest.id,
        name: biggest.name,
        message: `${biggest.name} moved ${(biggest.change24h ?? 0) > 0 ? "+" : ""}${(biggest.change24h ?? 0).toFixed(1)}% today${driverSuffix}.`,
      });
    }

    favouritesSignals = {
      summary: `${newsDrivenCount} of your favourites are news-driven today. ${top50CrossedCount} just crossed into momentum territory.`,
      highlights,
      newsDrivenCount,
      top50CrossedCount,
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
    movers: { climbers, droppers },
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
