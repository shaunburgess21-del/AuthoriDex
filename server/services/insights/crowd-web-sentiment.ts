import {
  buildWebSentimentLeaderboardRankMap,
  filterWebSentimentRows,
} from "@shared/insights/web-sentiment-filters";
import type { WebSentimentSortDir } from "@shared/insights/web-sentiment-filters";
import { getCachedTrendingPeople } from "./insights-people-cache";
import { withDiscoverCache } from "./discover-cache";
import { loadLatestSnapshotsByPerson } from "./snapshot-batch";
import {
  displayWebSentimentFromRaw,
  WEB_SENTIMENT_MIN_OPINIONATED,
} from "../../providers/sentiment-window";

export interface WebSentimentRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  rank: number;
  positivePct: number;
  positive: number;
  negative: number;
  total: number;
  carriedForward: boolean;
  /** Position when sorted best-first (highest %) within active filters. */
  leaderboardRank?: number;
}

export interface WebSentimentLeaderboardResponse {
  rows: WebSentimentRow[];
  total: number;
  asOf: string | null;
  minOpinionated: number;
}

export interface WebSentimentPageResponse extends WebSentimentLeaderboardResponse {
  hasMore: boolean;
}

export interface WebSentimentPageQuery {
  search?: string;
  category?: string;
  favoriteIds?: ReadonlySet<string>;
  sortDir?: WebSentimentSortDir;
  limit: number;
  offset: number;
}

export const WEB_SENTIMENT_DEFAULT_PAGE_SIZE = 20;

async function buildCrowdWebSentimentRows(): Promise<WebSentimentLeaderboardResponse> {
  const [people, snapshots] = await Promise.all([
    getCachedTrendingPeople(),
    loadLatestSnapshotsByPerson(),
  ]);

  const rows: WebSentimentRow[] = [];
  let latestTs: Date | null = null;

  for (const person of people) {
    const snap = snapshots.get(person.id);
    if (!snap) continue;
    const raw = (snap.diagnostics as Record<string, any> | null)?.raw as
      | Record<string, unknown>
      | undefined;
    if (!raw) continue;

    const reading = displayWebSentimentFromRaw({
      webSentimentPositive: raw.webSentimentPositive,
      webSentimentNegative: raw.webSentimentNegative,
      webSentimentNeutral: raw.webSentimentNeutral,
      webSentimentTotal: raw.webSentimentTotal,
    });

    if (reading.positivePct == null) continue;

    if (snap.timestamp instanceof Date && !Number.isNaN(snap.timestamp.getTime())) {
      if (!latestTs || snap.timestamp.getTime() > latestTs.getTime()) {
        latestTs = snap.timestamp;
      }
    }

    rows.push({
      id: person.id,
      name: person.name,
      avatar: person.avatar ?? null,
      category: person.category ?? null,
      rank: person.rank,
      positivePct: reading.positivePct,
      positive: reading.positive,
      negative: reading.negative,
      total: reading.total,
      carriedForward: raw.webSentimentCarriedForward === true,
    });
  }

  rows.sort((a, b) => b.positivePct - a.positivePct);

  return {
    rows,
    total: rows.length,
    asOf: latestTs?.toISOString() ?? null,
    minOpinionated: WEB_SENTIMENT_MIN_OPINIONATED,
  };
}

async function loadCrowdWebSentimentCached(): Promise<WebSentimentLeaderboardResponse> {
  return withDiscoverCache("crowd-web-sentiment", buildCrowdWebSentimentRows);
}

/**
 * Web Sentiment leaderboard. Sourced from `trend_snapshots.diagnostics.raw.*`
 * — no new ingest required. People with fewer than the opinionated-citation
 * minimum are excluded (their headline % isn't meaningful).
 */
export async function loadCrowdWebSentiment(): Promise<WebSentimentLeaderboardResponse> {
  return loadCrowdWebSentimentCached();
}

export async function loadCrowdWebSentimentPage(
  query: WebSentimentPageQuery,
): Promise<WebSentimentPageResponse> {
  const base = await loadCrowdWebSentimentCached();
  const filterOpts = {
    search: query.search ?? "",
    category: query.category ?? "all",
    favoriteIds: query.favoriteIds ?? new Set(),
  };
  const filtered = filterWebSentimentRows(base.rows, {
    ...filterOpts,
    sortDir: query.sortDir ?? "desc",
  });
  const descFiltered = filterWebSentimentRows(base.rows, {
    ...filterOpts,
    sortDir: "desc",
  });
  const rankById = buildWebSentimentLeaderboardRankMap(descFiltered);

  const rows = filtered.slice(query.offset, query.offset + query.limit).map((row) => ({
    ...row,
    leaderboardRank: rankById.get(row.id) ?? 0,
  }));

  return {
    rows,
    total: filtered.length,
    hasMore: query.offset + rows.length < filtered.length,
    asOf: base.asOf,
    minOpinionated: base.minOpinionated,
  };
}
