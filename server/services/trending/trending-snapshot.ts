import { celebrityMetrics, type TrendingPerson } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { getBaselineDiagnostics, type BaselineDiagnostics } from "../../utils/baseline";
import { memoizeAsync, INSIGHTS_REQUEST_MEMO_TTL_MS, clearRequestMemo } from "../insights/request-memo";
import { getLatestCompletedRunId, getSnapshotRankMap } from "./snapshot-rank-map";
import type { EnrichedTrendingPerson } from "./trending-snapshot-query";

export type { EnrichedTrendingPerson, TrendingQueryFilters, TrendingPagination } from "./trending-snapshot-query";
export {
  applyBaselineDegraded,
  filterAndSortTrendingPeople,
  paginateTrendingPeople,
} from "./trending-snapshot-query";

export interface EnrichedTrendingSnapshot {
  people: EnrichedTrendingPerson[];
  baselineMeta: BaselineDiagnostics;
}

const TRENDING_MEMO_PREFIX = "trending:enriched";

type CelebrityMetricRow = {
  celebrityId: string;
  approvalPct: number | null;
  approvalAvgRating: number | null;
  approvalVotesCount: number | null;
  underratedPct: number | null;
  overratedPct: number | null;
  fairlyRatedPct: number | null;
  valueScore: number | null;
};

async function fetchCelebrityMetrics(): Promise<CelebrityMetricRow[]> {
  return db
    .select({
      celebrityId: celebrityMetrics.celebrityId,
      approvalPct: celebrityMetrics.approvalPct,
      approvalAvgRating: celebrityMetrics.approvalAvgRating,
      approvalVotesCount: celebrityMetrics.approvalVotesCount,
      underratedPct: celebrityMetrics.underratedPct,
      overratedPct: celebrityMetrics.overratedPct,
      fairlyRatedPct: celebrityMetrics.fairlyRatedPct,
      valueScore: celebrityMetrics.valueScore,
    })
    .from(celebrityMetrics);
}

function mergeEnrichedPeople(
  people: TrendingPerson[],
  metrics: CelebrityMetricRow[],
  prevRankMap: Map<string, number>,
): EnrichedTrendingPerson[] {
  const metricsMap = new Map<string, CelebrityMetricRow>();
  for (const m of metrics) {
    metricsMap.set(m.celebrityId, m);
  }

  let effectivePrevRanks = prevRankMap;
  if (effectivePrevRanks.size === 0) {
    effectivePrevRanks = new Map<string, number>();
    const previousScores = people.map((p) => {
      const fi = p.fameIndex ?? Math.round(p.trendScore / 100);
      const delta = p.change24h ?? 0;
      const prevFi = delta !== 0 ? fi / (1 + delta / 100) : fi;
      return { id: p.id, prevFi };
    }).sort((a, b) => b.prevFi - a.prevFi);
    previousScores.forEach((s, i) => effectivePrevRanks.set(s.id, i + 1));
  }

  return people.map((p) => {
    const m = metricsMap.get(p.id);
    const prevRank = effectivePrevRanks.get(p.id) ?? p.rank;
    const rankChange = prevRank - p.rank;
    return {
      ...p,
      approvalPct: m?.approvalPct ?? null,
      approvalAvgRating: m?.approvalAvgRating ?? null,
      approvalVotesCount: m?.approvalVotesCount ?? null,
      underratedPct: m?.underratedPct ?? null,
      overratedPct: m?.overratedPct ?? null,
      fairlyRatedPct: m?.fairlyRatedPct ?? null,
      valueScore: m?.valueScore ?? null,
      rankChange,
    };
  });
}

async function buildTrendingEnrichedSnapshot(): Promise<EnrichedTrendingSnapshot | null> {
  const people = await storage.getTrendingPeople();
  if (people.length === 0) {
    return null;
  }

  const [metrics, prevRankMap, baselineMeta] = await Promise.all([
    fetchCelebrityMetrics(),
    getSnapshotRankMap(),
    getBaselineDiagnostics(people.length),
  ]);

  return {
    people: mergeEnrichedPeople(people, metrics, prevRankMap),
    baselineMeta,
  };
}

async function trendingMemoKey(): Promise<string> {
  try {
    const runId = await getLatestCompletedRunId();
    if (runId) return `${TRENDING_MEMO_PREFIX}:${runId}`;
  } catch {
    /* fall through to TTL-only key */
  }
  return `${TRENDING_MEMO_PREFIX}:fallback`;
}

/** Full enriched roster + baseline meta. Memoized per ingest run (60s TTL). */
export async function loadTrendingEnrichedSnapshot(): Promise<EnrichedTrendingSnapshot | null> {
  const key = await trendingMemoKey();
  return memoizeAsync(key, INSIGHTS_REQUEST_MEMO_TTL_MS, buildTrendingEnrichedSnapshot);
}

/** Test helper — clear trending enriched memo. */
export function clearTrendingEnrichedMemoForTests(): void {
  clearRequestMemo();
}
