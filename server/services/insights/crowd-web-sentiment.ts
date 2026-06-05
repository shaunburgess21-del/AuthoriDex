import { getCachedTrendingPeople } from "./insights-people-cache";
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
}

export interface WebSentimentLeaderboardResponse {
  rows: WebSentimentRow[];
  total: number;
  asOf: string | null;
  minOpinionated: number;
}

/**
 * Web Sentiment leaderboard. Sourced from `trend_snapshots.diagnostics.raw.*`
 * — no new ingest required. People with fewer than the opinionated-citation
 * minimum are excluded (their headline % isn't meaningful).
 */
export async function loadCrowdWebSentiment(): Promise<WebSentimentLeaderboardResponse> {
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
