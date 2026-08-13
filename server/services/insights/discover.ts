import type { InsightsDivergenceType, InsightsDiscoverRow } from "@shared/insights/types";
import {
  WEB_SENTIMENT_METHOD,
  displayWebSentimentFromRaw,
} from "../../providers/sentiment-window";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { loadSingleSourceSurge } from "./drivers";
import {
  buildSentimentHighlight,
  classifyPressVsCrowd,
  isPressVsCrowdDivergenceType,
  sentimentApprovalGap,
} from "./sentiment-divergence";

const WEB_SENTIMENT_MAX_AGE_HOURS = Number(process.env.WEB_SENTIMENT_MAX_AGE_HOURS) || 336;

function isWebSentimentFresh(fetchedAtRaw: unknown): boolean {
  if (typeof fetchedAtRaw !== "string" || !fetchedAtRaw) return false;
  const fetchedMs = Date.parse(fetchedAtRaw);
  if (!Number.isFinite(fetchedMs)) return false;
  const ageHours = (Date.now() - fetchedMs) / (1000 * 60 * 60);
  return ageHours <= WEB_SENTIMENT_MAX_AGE_HOURS;
}

function displayWebPctFromRow(row: Record<string, unknown>): number | null {
  const reading = displayWebSentimentFromRaw({
    webSentimentPositive: row.web_sentiment_positive,
    webSentimentNegative: row.web_sentiment_negative,
    webSentimentNeutral: row.web_sentiment_neutral,
  });
  return reading.positivePct;
}

export async function loadDivergence(
  type: InsightsDivergenceType,
  limit = 25,
): Promise<{ rows: InsightsDiscoverRow[]; total: number }> {
  const result = await db.execute(sql`
    WITH rating_shares AS (
      SELECT
        person_id,
        COUNT(*) FILTER (WHERE rating <= 2)::float / NULLIF(COUNT(*), 0) AS low_share,
        COUNT(*) FILTER (WHERE rating >= 4)::float / NULLIF(COUNT(*), 0) AS high_share
      FROM user_votes
      WHERE rating BETWEEN 1 AND 5
      GROUP BY person_id
    ),
    ranked AS (
      SELECT
        cm.celebrity_id AS id,
        cm.approval_pct,
        cm.approval_avg_rating,
        cm.approval_votes_count,
        rs.low_share,
        rs.high_share,
        tp.rank,
        tp.fame_index,
        tp.change_7d,
        tp.name,
        tp.avatar,
        tp.category,
        COALESCE(ts.velocity_score, 0) AS velocity_score,
        PERCENT_RANK() OVER (ORDER BY cm.approval_avg_rating NULLS LAST) AS approval_percentile,
        ts.web_sentiment_positive,
        ts.web_sentiment_negative,
        ts.web_sentiment_neutral,
        ts.web_sentiment_method,
        ts.web_sentiment_fetched_at
      FROM celebrity_metrics cm
      INNER JOIN trending_people tp ON tp.id = cm.celebrity_id
      LEFT JOIN rating_shares rs ON rs.person_id = cm.celebrity_id
      LEFT JOIN LATERAL (
        SELECT
          velocity_score,
          (diagnostics::jsonb->'raw'->>'webSentimentPositive')::numeric AS web_sentiment_positive,
          (diagnostics::jsonb->'raw'->>'webSentimentNegative')::numeric AS web_sentiment_negative,
          (diagnostics::jsonb->'raw'->>'webSentimentNeutral')::numeric AS web_sentiment_neutral,
          diagnostics::jsonb->'raw'->>'webSentimentMethod' AS web_sentiment_method,
          (diagnostics::jsonb->'raw'->>'webSentimentFetchedAt')::timestamptz AS web_sentiment_fetched_at
        FROM trend_snapshots
        WHERE person_id = cm.celebrity_id
          AND snapshot_origin = 'ingest'
          AND timestamp = date_trunc('hour', timestamp)
        ORDER BY timestamp DESC
        LIMIT 1
      ) ts ON true
      WHERE cm.approval_votes_count >= 20
    )
    SELECT * FROM ranked
  `);

  const rawRows = (Array.isArray(result) ? result : (result as { rows: Record<string, unknown>[] }).rows) ?? [];

  /** Polarisation = 2 * min(lowShare, highShare); 1 when the crowd splits evenly across both ends. */
  const ratingSplit = (row: Record<string, unknown>) => {
    const lowShare = row.low_share != null ? Number(row.low_share) : 0;
    const highShare = row.high_share != null ? Number(row.high_share) : 0;
    return { lowShare, highShare, polarisation: 2 * Math.min(lowShare, highShare) };
  };

  const filtered = rawRows.filter((row) => {
    const change7d = Number(row.change_7d ?? 0);
    const approvalPct = Number(row.approval_pct ?? 0);
    const percentile = Number(row.approval_percentile ?? 0.5);
    const { polarisation } = ratingSplit(row);

    switch (type) {
      case "rising_disliked":
        return change7d > 3 && percentile < 0.35;
      case "loved_gaining":
        return approvalPct >= 65 && change7d > 2;
      case "disliked_cooling":
        return percentile < 0.35 && change7d < -2;
      case "consensus":
        return approvalPct >= 60 && polarisation <= 0.3;
      case "polarising":
        return polarisation >= 0.25;
      case "most_rated":
        return Number(row.approval_votes_count ?? 0) > 0;
      case "press_loved_crowd_cool":
      case "crowd_loved_press_critical": {
        if (row.web_sentiment_method !== WEB_SENTIMENT_METHOD) return false;
        if (!isWebSentimentFresh(row.web_sentiment_fetched_at)) return false;
        const webPct = displayWebPctFromRow(row);
        if (webPct == null) return false;
        const crowdPct = row.approval_pct != null ? Number(row.approval_pct) : null;
        const classified = classifyPressVsCrowd(webPct, crowdPct);
        return classified === type;
      }
      default:
        return false;
    }
  });

  const sorted =
    isPressVsCrowdDivergenceType(type)
      ? [...filtered].sort((a, b) => {
        const gapA = Math.abs(
          sentimentApprovalGap(
            displayWebPctFromRow(a),
            a.approval_pct != null ? Number(a.approval_pct) : null,
          ) ?? 0,
        );
        const gapB = Math.abs(
          sentimentApprovalGap(
            displayWebPctFromRow(b),
            b.approval_pct != null ? Number(b.approval_pct) : null,
          ) ?? 0,
        );
        return gapB - gapA;
      })
      : type === "polarising"
        ? [...filtered].sort(
            (a, b) => ratingSplit(b).polarisation - ratingSplit(a).polarisation,
          )
        : type === "most_rated"
          ? [...filtered].sort(
              (a, b) => Number(b.approval_votes_count ?? 0) - Number(a.approval_votes_count ?? 0),
            )
          : filtered;

  const rows: InsightsDiscoverRow[] = sorted.slice(0, limit).map((row) => {
    const change7d = Number(row.change_7d ?? 0);
    const approvalPctVal = row.approval_pct != null ? Number(row.approval_pct) : null;
    const avgRating = row.approval_avg_rating != null ? Number(row.approval_avg_rating) : null;
    const votesCount = Number(row.approval_votes_count ?? 0);
    const { lowShare, highShare, polarisation } = ratingSplit(row);
    const webPct = isPressVsCrowdDivergenceType(type)
      ? displayWebPctFromRow(row)
      : null;

    let highlight = "";
    switch (type) {
      case "rising_disliked":
        highlight = `Rising (${change7d.toFixed(1)}% 7d) but crowd approval is low`;
        break;
      case "loved_gaining":
        highlight = `${avgRating != null ? `${avgRating.toFixed(1)}/5 crowd rating` : "High crowd rating"}, +${change7d.toFixed(1)}% 7d`;
        break;
      case "disliked_cooling":
        highlight = `${avgRating != null ? `${avgRating.toFixed(1)}/5 crowd rating` : "Low crowd rating"}, ${change7d.toFixed(1)}% 7d`;
        break;
      case "consensus":
        highlight = `High approval with tight crowd agreement`;
        break;
      case "polarising":
        highlight = `${Math.round(lowShare * 100)}% rate 1-2, ${Math.round(highShare * 100)}% rate 4-5`;
        break;
      case "most_rated":
        highlight = `${votesCount.toLocaleString()} ratings${avgRating != null ? ` · ${avgRating.toFixed(1)}/5 average` : ""}`;
        break;
      case "press_loved_crowd_cool":
      case "crowd_loved_press_critical":
        if (webPct != null && approvalPctVal != null) {
          highlight = buildSentimentHighlight(type, webPct, approvalPctVal);
        }
        break;
    }

    const base: InsightsDiscoverRow = {
      id: String(row.id),
      name: String(row.name ?? ""),
      avatar: (row.avatar as string) ?? null,
      category: (row.category as string) ?? null,
      rank: Number(row.rank ?? 0),
      fameIndex: Number(row.fame_index ?? 0),
      approvalPct: approvalPctVal,
      approvalPercentile:
        row.approval_percentile != null ? Math.round(Number(row.approval_percentile) * 100) : null,
      change7d: row.change_7d != null ? Number(row.change_7d) : null,
      velocityScore: Number(row.velocity_score ?? 0),
      approvalAvgRating: avgRating,
      approvalVotesCount: votesCount,
      polarisationPct: Math.round(polarisation * 100),
      lowSharePct: Math.round(lowShare * 100),
      highSharePct: Math.round(highShare * 100),
      highlight,
    };

    if (isPressVsCrowdDivergenceType(type) && webPct != null && approvalPctVal != null) {
      const wsDisplay = displayWebSentimentFromRaw({
        webSentimentPositive: row.web_sentiment_positive,
        webSentimentNegative: row.web_sentiment_negative,
        webSentimentNeutral: row.web_sentiment_neutral,
      });
      return {
        ...base,
        webSentimentPositivePct: webPct,
        webSentimentPositive: wsDisplay.positive,
        webSentimentNegative: wsDisplay.negative,
        webSentimentNeutral: wsDisplay.neutral,
        sentimentApprovalGap: sentimentApprovalGap(webPct, approvalPctVal),
      };
    }

    return base;
  });

  return { rows, total: filtered.length };
}

export { loadSingleSourceSurge };
