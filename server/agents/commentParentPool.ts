/**
 * Hybrid parent pool for the comment worker: recent slice + random explore
 * slice so agents can reach cards beyond the newest window as the catalogue
 * grows past POOL_SIZE (1000+).
 */

import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import {
  matchups,
  opinionPolls,
  predictionMarkets,
  trendingPolls,
} from "@shared/schema";
import { db } from "../db";
import {
  COMMENT_PARENT_EXPLORE_FETCH_LIMIT,
  COMMENT_PARENT_POOL_SIZE,
  COMMENT_PARENT_RECENT_SLOTS,
  mergeParentPoolRows,
  type CommentParentPoolResult,
  type CommentParentPoolRow,
} from "./commentParentPoolMerge";

export {
  COMMENT_PARENT_EXPLORE_SLOTS,
  COMMENT_PARENT_POOL_SIZE,
  COMMENT_PARENT_RECENT_SLOTS,
  mergeParentPoolRows,
  type CommentParentPoolResult,
  type CommentParentPoolRow,
  type CommentParentPoolStats,
} from "./commentParentPoolMerge";

type SurfacePoolConfig = {
  liveCount: () => Promise<number>;
  fetchAll: () => Promise<CommentParentPoolRow[]>;
  fetchRecent: (limit: number) => Promise<CommentParentPoolRow[]>;
  fetchExplore: (limit: number) => Promise<CommentParentPoolRow[]>;
};

async function fetchHybridPool(config: SurfacePoolConfig): Promise<CommentParentPoolResult> {
  const liveCount = await config.liveCount();

  if (liveCount <= COMMENT_PARENT_POOL_SIZE) {
    const rows = await config.fetchAll();
    return {
      rows,
      stats: { recent: rows.length, explore: 0, merged: rows.length },
    };
  }

  const [recent, explore] = await Promise.all([
    config.fetchRecent(COMMENT_PARENT_RECENT_SLOTS),
    // Over-fetch so overlap with the recent slice still yields ~200 unique parents.
    config.fetchExplore(COMMENT_PARENT_EXPLORE_FETCH_LIMIT),
  ]);
  return mergeParentPoolRows(recent, explore);
}

// ── Matchups ───────────────────────────────────────────────────────────

const MATCHUP_WHERE = and(eq(matchups.isActive, true), eq(matchups.visibility, "live"));

const matchupSelect = {
  parentId: matchups.id,
  title: matchups.title,
  category: matchups.category,
};

export async function fetchMatchupParentPool(): Promise<CommentParentPoolResult> {
  return fetchHybridPool({
    liveCount: async () => {
      const [row] = await db.select({ c: count() }).from(matchups).where(MATCHUP_WHERE);
      return Number(row?.c ?? 0);
    },
    fetchAll: () =>
      db.select(matchupSelect).from(matchups).where(MATCHUP_WHERE).orderBy(desc(matchups.createdAt)),
    fetchRecent: (limit) =>
      db
        .select(matchupSelect)
        .from(matchups)
        .where(MATCHUP_WHERE)
        .orderBy(desc(matchups.createdAt))
        .limit(limit),
    fetchExplore: (limit) =>
      db
        .select(matchupSelect)
        .from(matchups)
        .where(MATCHUP_WHERE)
        .orderBy(sql`random()`)
        .limit(limit),
  });
}

// ── Sentiment polls ────────────────────────────────────────────────────

const TRENDING_WHERE = eq(trendingPolls.visibility, "live");

const trendingSelect = {
  parentId: trendingPolls.id,
  title: trendingPolls.headline,
  category: trendingPolls.category,
};

export async function fetchTrendingPollParentPool(): Promise<CommentParentPoolResult> {
  return fetchHybridPool({
    liveCount: async () => {
      const [row] = await db.select({ c: count() }).from(trendingPolls).where(TRENDING_WHERE);
      return Number(row?.c ?? 0);
    },
    fetchAll: () =>
      db
        .select(trendingSelect)
        .from(trendingPolls)
        .where(TRENDING_WHERE)
        .orderBy(desc(trendingPolls.createdAt)),
    fetchRecent: (limit) =>
      db
        .select(trendingSelect)
        .from(trendingPolls)
        .where(TRENDING_WHERE)
        .orderBy(desc(trendingPolls.createdAt))
        .limit(limit),
    fetchExplore: (limit) =>
      db
        .select(trendingSelect)
        .from(trendingPolls)
        .where(TRENDING_WHERE)
        .orderBy(sql`random()`)
        .limit(limit),
  });
}

// ── Opinion polls ──────────────────────────────────────────────────────

const OPINION_WHERE = eq(opinionPolls.visibility, "live");

const opinionSelect = {
  parentId: opinionPolls.id,
  title: opinionPolls.title,
  category: opinionPolls.category,
};

export async function fetchOpinionPollParentPool(): Promise<CommentParentPoolResult> {
  return fetchHybridPool({
    liveCount: async () => {
      const [row] = await db.select({ c: count() }).from(opinionPolls).where(OPINION_WHERE);
      return Number(row?.c ?? 0);
    },
    fetchAll: () =>
      db
        .select(opinionSelect)
        .from(opinionPolls)
        .where(OPINION_WHERE)
        .orderBy(desc(opinionPolls.createdAt)),
    fetchRecent: (limit) =>
      db
        .select(opinionSelect)
        .from(opinionPolls)
        .where(OPINION_WHERE)
        .orderBy(desc(opinionPolls.createdAt))
        .limit(limit),
    fetchExplore: (limit) =>
      db
        .select(opinionSelect)
        .from(opinionPolls)
        .where(OPINION_WHERE)
        .orderBy(sql`random()`)
        .limit(limit),
  });
}

// ── Open world markets ─────────────────────────────────────────────────

export async function fetchOpenMarketParentPool(now: Date): Promise<CommentParentPoolResult> {
  const marketWhere = and(
    eq(predictionMarkets.marketType, "community"),
    eq(predictionMarkets.status, "OPEN"),
    eq(predictionMarkets.visibility, "live"),
    gt(predictionMarkets.endAt, now),
  );

  const marketSelect = {
    parentId: predictionMarkets.id,
    title: predictionMarkets.title,
    category: predictionMarkets.category,
  };

  return fetchHybridPool({
    liveCount: async () => {
      const [row] = await db.select({ c: count() }).from(predictionMarkets).where(marketWhere);
      return Number(row?.c ?? 0);
    },
    fetchAll: () =>
      db
        .select(marketSelect)
        .from(predictionMarkets)
        .where(marketWhere)
        .orderBy(desc(predictionMarkets.createdAt)),
    fetchRecent: (limit) =>
      db
        .select(marketSelect)
        .from(predictionMarkets)
        .where(marketWhere)
        .orderBy(desc(predictionMarkets.createdAt))
        .limit(limit),
    fetchExplore: (limit) =>
      db
        .select(marketSelect)
        .from(predictionMarkets)
        .where(marketWhere)
        .orderBy(sql`random()`)
        .limit(limit),
  });
}
