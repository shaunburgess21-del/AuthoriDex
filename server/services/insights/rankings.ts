import type { InsightsFilters } from "@shared/insights/filters";
import { canonicalCacheKey } from "@shared/insights/filters";
import type { InsightsRankingRow, InsightsRankingsResponse } from "@shared/insights/types";
import { normalizeMarketCategory } from "@shared/constants";
import { db } from "../../db";
import { userFavourites } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  loadLatestSnapshotsByPerson,
  loadTrailing7dWikiByPerson,
} from "./snapshot-batch";
import { loadPersonSignals } from "./drivers";
import { getCachedTrendingPeople } from "./insights-people-cache";
import { withInsightsAggregateCache } from "./discover-cache";
import {
  breakdownFromDiagnostics,
  computeMomentumLevel,
  ratioFromDiagnostics,
  sortValueForSource,
} from "./signal-utils";

type MetricDeltaKind = "change24h" | "change7d" | "mom";

function metricDeltaFor(
  source: string,
  window: "24h" | "7d",
  person: { change24h: number | null; change7d: number | null },
  momPct: number | null,
): { value: number | null; kind: MetricDeltaKind } {
  // Search interest is monthly data — only the MoM delta is meaningful.
  if (source === "search_volume") {
    return {
      value: momPct != null && Number.isFinite(momPct) ? momPct : null,
      kind: "mom",
    };
  }
  // For all other sources we lean on the Trend Score delta of the right
  // window. Per-metric 24h/7d deltas would need a separate baseline snapshot
  // query — out of scope for 4b.
  if (window === "7d") {
    return { value: person.change7d ?? null, kind: "change7d" };
  }
  return { value: person.change24h ?? null, kind: "change24h" };
}

function rankingsCacheKey(filters: InsightsFilters, userId?: string | null): string {
  const base = canonicalCacheKey("rankings", filters);
  if (filters.favouritesOnly && userId) {
    return `${base}|uid=${userId}`;
  }
  return base;
}

export async function loadInsightsRankings(
  filters: InsightsFilters,
  userId?: string | null,
): Promise<InsightsRankingsResponse> {
  const fullKey = `insights:rankings:${rankingsCacheKey(filters, userId)}`;
  return withInsightsAggregateCache(fullKey, "insights_rankings", () =>
    loadInsightsRankingsInner(filters, userId),
  );
}

async function loadInsightsRankingsInner(
  filters: InsightsFilters,
  userId?: string | null,
): Promise<InsightsRankingsResponse> {
  // Wiki 7d sum only needs to be loaded when the user is on the Wikipedia
  // tab with the 7d window; for every other view the bulk query is wasted.
  const needsWiki7dSum = filters.source === "wiki" && filters.window === "7d";

  const [people0, snapshots, wiki7dByPerson] = await Promise.all([
    getCachedTrendingPeople(),
    loadLatestSnapshotsByPerson(),
    needsWiki7dSum ? loadTrailing7dWikiByPerson() : Promise.resolve(new Map<string, number>()),
  ]);
  let people = people0;
  const signals = await loadPersonSignals({ snapshots });

  let favouriteIds: Set<string> | null = null;
  if (filters.favouritesOnly && userId) {
    const favs = await db
      .select({ personId: userFavourites.personId })
      .from(userFavourites)
      .where(eq(userFavourites.userId, userId));
    favouriteIds = new Set(favs.map((f) => f.personId));
    people = people.filter((p) => favouriteIds!.has(p.id));
  }

  if (filters.category) {
    const norm = normalizeMarketCategory(filters.category);
    people = people.filter(
      (p) => p.category && normalizeMarketCategory(p.category) === norm,
    );
  }

  const rows: InsightsRankingRow[] = people.map((person) => {
    const snap = snapshots.get(person.id);
    const diag = snap?.diagnostics ?? null;
    const sig = signals.get(person.id);

    const newsMomentumRatio = ratioFromDiagnostics(
      diag,
      "newsMomentumRatio",
      snap?.newsCount ?? 0,
      "news7d",
    );
    const wikiMomentumRatio = ratioFromDiagnostics(
      diag,
      "wikiMomentumRatio",
      snap?.wikiPageviews ?? 0,
      "wikiMomentumAvg7d",
    );

    const newsMomentum = {
      ratio: newsMomentumRatio > 0 ? newsMomentumRatio : null,
      level: sig?.newsLevel ?? computeMomentumLevel(newsMomentumRatio),
    };
    const wikiMomentum = {
      ratio: wikiMomentumRatio > 0 ? wikiMomentumRatio : null,
      level: sig?.wikiLevel ?? computeMomentumLevel(wikiMomentumRatio),
    };

    const rawDiag = (diag as Record<string, any> | null)?.raw as Record<string, unknown> | undefined;
    const searchVolume = Number(rawDiag?.googleSearchVolume ?? 0);
    const momPctRaw = Number(rawDiag?.googleSearchVolumeMoMDeltaPct ?? NaN);
    const newsDailyAvg7d = Number(rawDiag?.news7d ?? 0);

    const sortRow = {
      fameIndex: person.fameIndex ?? 0,
      velocityScore: snap?.velocityScore ?? 0,
      massScore: snap?.massScore ?? 0,
      newsMomentumRatio,
      wikiMomentumRatio,
      newsCount: snap?.newsCount ?? 0,
      newsDailyAvg7d: Number.isFinite(newsDailyAvg7d) ? newsDailyAvg7d : 0,
      wikiPageviews: snap?.wikiPageviews ?? 0,
      wiki7dSum: wiki7dByPerson.get(person.id) ?? 0,
      searchVolume: Number.isFinite(searchVolume) ? searchVolume : 0,
      change24h: person.change24h ?? null,
      change7d: person.change7d ?? null,
    };

    const sortValue = sortValueForSource(filters.source, sortRow, filters.window);
    const { value: metricDelta, kind: metricDeltaKind } = metricDeltaFor(
      filters.source,
      filters.window,
      { change24h: person.change24h ?? null, change7d: person.change7d ?? null },
      Number.isFinite(momPctRaw) ? momPctRaw : null,
    );

    // Hint for the UI: News 7d is an estimate (avg × 7), Wiki 7d is a real
    // sum, Search is always monthly. Used to tag the metric column.
    let metricKind: "raw" | "weekly_estimate" | "weekly_sum" | "monthly" = "raw";
    if (filters.source === "news" && filters.window === "7d") metricKind = "weekly_estimate";
    else if (filters.source === "wiki" && filters.window === "7d") metricKind = "weekly_sum";
    else if (filters.source === "search_volume") metricKind = "monthly";

    return {
      id: person.id,
      name: person.name,
      avatar: person.avatar ?? null,
      category: person.category ?? null,
      rank: person.rank,
      fameIndex: person.fameIndex ?? 0,
      velocityScore: sortRow.velocityScore,
      massScore: sortRow.massScore,
      newsMomentum,
      wikiMomentum,
      primaryDriver: sig?.primaryDriver ?? "MIXED",
      breakdownPct: breakdownFromDiagnostics(diag),
      change24h: person.change24h ?? null,
      change7d: person.change7d ?? null,
      sortValue,
      metricDelta,
      metricDeltaKind,
      metricKind,
    };
  });

  rows.sort((a, b) => {
    const primary = b.sortValue - a.sortValue;
    if (primary !== 0) return primary;
    // Stable tie-breakers so pagination and re-renders don't shuffle rows.
    if (filters.source === "fame") return b.fameIndex - a.fameIndex;
    return a.rank - b.rank;
  });

  const total = rows.length;
  const offset = (filters.page - 1) * filters.limit;
  const pageRows = rows.slice(offset, offset + filters.limit);

  const latestTs = [...snapshots.values()]
    .map((s) => s.timestamp)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const asOf =
    latestTs instanceof Date && !Number.isNaN(latestTs.getTime())
      ? latestTs.toISOString()
      : null;

  return {
    rows: pageRows,
    total,
    asOf,
    source: filters.source,
  };
}
