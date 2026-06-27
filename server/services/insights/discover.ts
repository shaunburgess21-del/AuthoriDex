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
    WITH ranked AS (
      SELECT
        cm.celebrity_id AS id,
        cm.approval_pct,
        cm.underrated_pct,
        cm.overrated_pct,
        cm.fairly_rated_pct,
        cm.approval_votes_count,
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

  const filtered = rawRows.filter((row) => {
    const change7d = Number(row.change_7d ?? 0);
    const approvalPct = Number(row.approval_pct ?? 0);
    const percentile = Number(row.approval_percentile ?? 0.5);
    const underrated = Number(row.underrated_pct ?? 0);
    const overrated = Number(row.overrated_pct ?? 0);
    const fairly = Number(row.fairly_rated_pct ?? 0);

    switch (type) {
      case "rising_disliked":
        return change7d > 3 && percentile < 0.35;
      case "underrated_gaining":
        return underrated >= 40 && change7d > 2;
      case "overrated_cooling":
        return overrated >= 40 && change7d < -2;
      case "consensus":
        return approvalPct >= 60 && fairly >= 40;
      case "underrated":
        return underrated >= 20;
      case "overrated":
        return overrated >= 20;
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
      : type === "underrated"
        ? [...filtered].sort(
            (a, b) => Number(b.underrated_pct ?? 0) - Number(a.underrated_pct ?? 0),
          )
        : type === "overrated"
          ? [...filtered].sort(
              (a, b) => Number(b.overrated_pct ?? 0) - Number(a.overrated_pct ?? 0),
            )
          : filtered;

  const rows: InsightsDiscoverRow[] = sorted.slice(0, limit).map((row) => {
    const change7d = Number(row.change_7d ?? 0);
    const approvalPctVal = row.approval_pct != null ? Number(row.approval_pct) : null;
    const webPct = isPressVsCrowdDivergenceType(type)
      ? displayWebPctFromRow(row)
      : null;

    let highlight = "";
    switch (type) {
      case "rising_disliked":
        highlight = `Rising (${change7d.toFixed(1)}% 7d) but crowd approval is low`;
        break;
      case "underrated_gaining":
        highlight = `Underrated by ${Number(row.underrated_pct ?? 0).toFixed(0)}% of voters, gaining`;
        break;
      case "overrated_cooling":
        highlight = `Overrated by ${Number(row.overrated_pct ?? 0).toFixed(0)}% of voters, cooling`;
        break;
      case "consensus":
        highlight = `High approval with fair-rating consensus`;
        break;
      case "underrated":
        highlight = `${Number(row.underrated_pct ?? 0).toFixed(0)}% of voters say underrated`;
        break;
      case "overrated":
        highlight = `${Number(row.overrated_pct ?? 0).toFixed(0)}% of voters say overrated`;
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
      underratedPct: row.underrated_pct != null ? Number(row.underrated_pct) : null,
      overratedPct: row.overrated_pct != null ? Number(row.overrated_pct) : null,
      fairlyRatedPct: row.fairly_rated_pct != null ? Number(row.fairly_rated_pct) : null,
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
