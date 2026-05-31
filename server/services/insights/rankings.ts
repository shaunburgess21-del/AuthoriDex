import type { InsightsFilters } from "@shared/insights/filters";
import { canonicalCacheKey } from "@shared/insights/filters";
import type { InsightsRankingRow, InsightsRankingsResponse } from "@shared/insights/types";
import { normalizeMarketCategory } from "@shared/constants";
import { db } from "../../db";
import { userFavourites } from "@shared/schema";
import { eq } from "drizzle-orm";
import { loadLatestSnapshotsByPerson } from "./snapshot-batch";
import { loadPersonSignals } from "./drivers";
import { getCachedTrendingPeople } from "./insights-people-cache";
import { withInsightsAggregateCache } from "./discover-cache";
import {
  breakdownFromDiagnostics,
  computeMomentumLevel,
  ratioFromDiagnostics,
  sortValueForSource,
} from "./signal-utils";

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
  const [people0, snapshots] = await Promise.all([
    getCachedTrendingPeople(),
    loadLatestSnapshotsByPerson(),
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

    const sortRow = {
      fameIndex: person.fameIndex ?? 0,
      velocityScore: snap?.velocityScore ?? 0,
      massScore: snap?.massScore ?? 0,
      newsMomentumRatio,
      wikiMomentumRatio,
      newsCount: snap?.newsCount ?? 0,
      wikiPageviews: snap?.wikiPageviews ?? 0,
      searchVolume: Number.isFinite(searchVolume) ? searchVolume : 0,
    };

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
      change24h: filters.window === "7d" ? person.change7d ?? null : person.change24h ?? null,
      change7d: person.change7d ?? null,
      sortValue: sortValueForSource(filters.source, sortRow),
    };
  });

  rows.sort((a, b) => b.sortValue - a.sortValue);

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
