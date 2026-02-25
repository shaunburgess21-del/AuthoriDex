import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getBaselineDiagnostics } from "./utils/baseline";
import { db } from "./db";
import { trendSnapshots, trackedPeople, communityInsights, insightVotes, insightComments, commentVotes, matchups, votes, xpActions, celebrityImages, profiles, userFavourites, trendingPeople, creditLedger, adminAuditLog, predictionMarkets, marketEntries, marketBets, openMarketComments, pageViews, apiCache, sentimentVotes, celebrityMetrics, celebrityValueVotes, userVotes, trendingPolls, trendingPollVotes, trendingPollComments, trendingPollCommentVotes, matchupComments, matchupCommentVotes, ingestionRuns, inductionCandidates, opinionPolls, opinionPollOptions, opinionPollVotes, opinionPollComments, opinionPollCommentVotes, insertCommunityInsightSchema, insertInsightVoteSchema, insertInsightCommentSchema, insertCommentVoteSchema, insertVoteSchema, type CelebrityProfile, type InsertCelebrityProfile, type Matchup, type Vote, type Profile, type TrendingPoll } from "@shared/schema";
import { eq, desc, and, gt, sql, count, gte, lte, ilike, SQL, or, inArray, asc, lt, ne, isNotNull } from "drizzle-orm";
import { seedSupabasePersons } from "./supabase-seed";
import { supabaseServer } from "./supabase";
import { requireAuth, optionalAuth, type AuthRequest } from "./auth-middleware";
import OpenAI from "openai";
import { createHash, randomUUID } from "crypto";
import multer from "multer";
import path from "path";
import { gamificationService } from "./services/gamification";
import { getTrendContext, getTrendContextBatch, formatRelativeTime, type TrendContext } from "./services/trend-context";
import { fetchWebSearchContext, fetchTrendingNewsContext, fetchNetWorthContext } from "./providers/serper";
import { getSourceStats } from "./scoring/sourceStats";
import { 
  normalizeSourceValue, 
  isSourceSpiking, 
  getDynamicRateLimit, 
  getDynamicAlpha,
  isRecalibrationModeActive,
  SPIKE_MIN_DELTA,
  PLATFORM_WEIGHTS,
  MASS_ALLOCATION,
  VELOCITY_ALLOCATION,
  SCORE_VERSION,
} from "./scoring/normalize";
import {
  getCurrentHealthSnapshot,
  hasAnyDegradedSource,
  getHealthSummary,
  getStalenessDecayFactor,
} from "./scoring/sourceHealth";
import { getLastFullRefreshAt } from "./jobs/live-tick";
import { getLastRunMeta } from "./jobs/ingest";
import { getMediastackBudgetSummary } from "./providers/mediastack";

const VIEW_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const VIEW_IP_RATE_LIMIT = 30;
const BOT_UA_PATTERNS = /bot|crawl|spider|slurp|wget|curl|fetch|headless|phantom|puppet|selenium|lighthouse|preview|embed|scrape/i;
const PREFETCH_HEADERS = ['purpose', 'sec-purpose', 'x-purpose'];
const SESSION_COOKIE_NAME = 'fdx_sid';

const _viewDedupe = new Map<string, number>();
const _viewIpCounts = new Map<string, { count: number; resetAt: number }>();

function cleanViewDedupe() {
  const now = Date.now();
  Array.from(_viewDedupe.entries()).forEach(([key, ts]) => {
    if (now - ts > VIEW_DEDUPE_WINDOW_MS) _viewDedupe.delete(key);
  });
  Array.from(_viewIpCounts.entries()).forEach(([ip, bucket]) => {
    if (now > bucket.resetAt) _viewIpCounts.delete(ip);
  });
}
setInterval(cleanViewDedupe, 5 * 60 * 1000);

function getSessionId(req: Request): string {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  if (match && match[1] && match[1].length > 8) return match[1];
  return '';
}

function isPrefetch(req: Request): boolean {
  for (const h of PREFETCH_HEADERS) {
    const val = req.headers[h];
    if (val && /prefetch/i.test(String(val))) return true;
  }
  return false;
}

function shouldCountView(req: Request, personId: string): boolean {
  if (req.method !== 'GET') return false;
  if (isPrefetch(req)) return false;

  const ua = req.headers['user-agent'] || '';
  if (BOT_UA_PATTERNS.test(ua)) return false;

  const now = Date.now();
  const sessionId = getSessionId(req);
  const clientIp = req.ip || 'unknown';
  const identity = sessionId || clientIp;
  const dedupeKey = `${identity}:${personId}`;
  const lastSeen = _viewDedupe.get(dedupeKey);
  if (lastSeen && now - lastSeen < VIEW_DEDUPE_WINDOW_MS) return false;

  const bucket = _viewIpCounts.get(clientIp);
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= VIEW_IP_RATE_LIMIT) return false;
    bucket.count++;
  } else {
    _viewIpCounts.set(clientIp, { count: 1, resetAt: now + VIEW_DEDUPE_WINDOW_MS });
  }

  _viewDedupe.set(dedupeKey, now);
  return true;
}

// Cached snapshot rank lookup (shared between /api/trending and /api/leaderboard)
// Pinned baseline: only re-selects when a new completed ingestion run is detected.
// This matches the "APIs refresh hourly" mental model — Hot Movers only changes
// when genuinely new data arrives, never due to time passing.
let _cachedPrevRanks: Map<string, number> | null = null;
let _lastCompletedRunId: string | null = null;

let _cachedHotMovers: any | null = null;
let _hotMoversCachedAt: number = 0;
let _hotMoversCachedRunId: string | null = null;
const HOT_MOVERS_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getLatestCompletedRunId(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ id: ingestionRuns.id })
      .from(ingestionRuns)
      .where(eq(ingestionRuns.status, "completed"))
      .orderBy(desc(ingestionRuns.finishedAt))
      .limit(1);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function getSnapshotRankMap(): Promise<Map<string, number>> {
  const now = Date.now();

  const newestRunId = await getLatestCompletedRunId();
  const newRunCompleted = newestRunId && newestRunId !== _lastCompletedRunId;

  if (_cachedPrevRanks && _cachedPrevRanks.size > 0 && !newRunCompleted) {
    return _cachedPrevRanks;
  }

  if (newestRunId) {
    _lastCompletedRunId = newestRunId;
  }

  const map = new Map<string, number>();
  try {
    const t24hAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Strategy 1: Find the closest completed ingestion run to 24h ago (preferred)
    const [baselineRun] = await db
      .select({ id: ingestionRuns.id })
      .from(ingestionRuns)
      .where(and(
        eq(ingestionRuns.status, "completed"),
        eq(ingestionRuns.scoreVersion, SCORE_VERSION),
        gt(ingestionRuns.finishedAt, new Date(now - 28 * 60 * 60 * 1000)),
        sql`${ingestionRuns.finishedAt} < ${new Date(now - 20 * 60 * 60 * 1000)}`
      ))
      .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${t24hAgo}::timestamp))`)
      .limit(1);

    if (baselineRun) {
      const prevSnapshot = await db
        .select({
          personId: trendSnapshots.personId,
          fameIndex: sql<number>`MAX(${trendSnapshots.fameIndex})`,
        })
        .from(trendSnapshots)
        .where(eq(trendSnapshots.runId, baselineRun.id))
        .groupBy(trendSnapshots.personId)
        .orderBy(sql`MAX(${trendSnapshots.fameIndex}) DESC NULLS LAST`);

      prevSnapshot.forEach((s, i) => {
        map.set(s.personId, i + 1);
      });
    } else {
      // Strategy 2: Fallback to hour-bucketed timestamps, but ONLY trusted snapshots (run_id IS NOT NULL)
      const targetHour = new Date(t24hAgo);
      targetHour.setMinutes(0, 0, 0);
      const tLow = new Date(targetHour.getTime() - 8 * 60 * 60 * 1000);
      const tHigh = new Date(targetHour.getTime() + 8 * 60 * 60 * 1000);

      const nearestHourRow = await db
        .select({ hour: sql<string>`date_trunc('hour', ${trendSnapshots.timestamp})` })
        .from(trendSnapshots)
        .where(and(
          sql`${trendSnapshots.timestamp} BETWEEN ${tLow} AND ${tHigh}`,
          isNotNull(trendSnapshots.runId)
        ))
        .groupBy(sql`date_trunc('hour', ${trendSnapshots.timestamp})`)
        .orderBy(sql`ABS(EXTRACT(EPOCH FROM date_trunc('hour', ${trendSnapshots.timestamp}) - ${targetHour}::timestamp))`)
        .limit(1);

      if (nearestHourRow.length > 0) {
        const snapshotHour = new Date(nearestHourRow[0].hour);
        const snapshotHourEnd = new Date(snapshotHour.getTime() + 60 * 60 * 1000);

        const prevSnapshot = await db
          .select({
            personId: trendSnapshots.personId,
            fameIndex: sql<number>`MAX(${trendSnapshots.fameIndex})`,
          })
          .from(trendSnapshots)
          .where(and(
            sql`${trendSnapshots.timestamp} >= ${snapshotHour} AND ${trendSnapshots.timestamp} < ${snapshotHourEnd}`,
            isNotNull(trendSnapshots.runId)
          ))
          .groupBy(trendSnapshots.personId)
          .orderBy(sql`MAX(${trendSnapshots.fameIndex}) DESC NULLS LAST`);

        prevSnapshot.forEach((s, i) => {
          map.set(s.personId, i + 1);
        });
      }
    }
  } catch (e) {
    console.warn("[rankChange] Snapshot rank computation failed:", e);
  }

  if (map.size > 0) {
    _cachedPrevRanks = map;
  }
  return map;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Note: Using local PostgreSQL database instead of Supabase
  // Supabase seeding disabled while Supabase is paused
  // seedSupabasePersons().catch(err => {
  //   console.error('Failed to seed Supabase:', err);
  // });

  // ============ PAGE VIEW TRACKING MIDDLEWARE ============
  // Log page views for analytics (only public frontend routes)
  app.use((req, res, next) => {
    // Skip API calls, static assets, admin routes, and health checks
    if (req.path.startsWith('/api/') || 
        req.path.startsWith('/assets/') ||
        req.path.startsWith('/admin') ||
        req.path.includes('.') ||
        req.path === '/favicon.ico') {
      return next();
    }
    
    // Copy request data before scheduling async task (req may be recycled)
    const pageData = {
      path: req.path,
      userAgent: req.headers['user-agent'] || null,
      referrer: req.headers['referer'] || null,
      sessionId: (req as any).sessionID || null,
    };
    
    // Log the page view asynchronously (don't block the response)
    setImmediate(async () => {
      try {
        await db.insert(pageViews).values(pageData);
      } catch (err) {
        // Silently fail - don't break the app if analytics fails
        console.error('[PageView] Failed to log:', err);
      }
    });
    
    next();
  });
  
  // Supabase config endpoint for client
  app.get("/api/config/supabase", (req, res) => {
    res.json({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
    });
  });
  
  // Manual seeding endpoint for testing
  app.post("/api/admin/seed-supabase", async (req, res) => {
    try {
      const result = await seedSupabasePersons();
      
      // Test query to verify
      const { data, error } = await supabaseServer
        .from('persons')
        .select('id, name')
        .limit(3);
      
      res.json({ 
        success: true, 
        message: "Supabase seeded successfully",
        samplePersons: data,
        error: error
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // Run data ingestion - fetches real data from Wikipedia and GDELT
  app.post("/api/admin/ingest", async (req, res) => {
    try {
      const { runDataIngestion } = await import("./jobs/ingest");
      const result = await runDataIngestion();
      res.json({ 
        success: true, 
        message: "Data ingestion complete",
        ...result
      });
    } catch (error: any) {
      console.error("Ingestion error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // Seed historical trend data for graphs
  app.post("/api/admin/seed-history", async (req, res) => {
    try {
      const { seedHistoricalSnapshots } = await import("./jobs/seed-history");
      const { days = 7 } = req.body;
      const result = await seedHistoricalSnapshots(days);
      res.json({ 
        success: true, 
        message: `Created ${result.created} historical snapshots`,
        ...result
      });
    } catch (error: any) {
      console.error("Seed history error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get all trending people with pagination support
  app.get("/api/trending", async (req, res) => {
    try {
      const { search, category, sort, limit, offset } = req.query;
      
      let people = await storage.getTrendingPeople();
      
      // If storage is empty, return empty array (ingestion job populates the database)
      // DO NOT fetch mock data here - it corrupts real scores
      if (people.length === 0) {
        console.log('[API] trending_people is empty - waiting for ingestion job to populate');
        res.json([]);
        return;
      }

      // Fetch approval metrics for all celebrities
      const metrics = await db
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
      
      // Create a lookup map for metrics
      const metricsMap = new Map<string, typeof metrics[0]>();
      for (const m of metrics) {
        metricsMap.set(m.celebrityId, m);
      }

      // Compute rank changes from actual trend_snapshots ~24h ago (cached)
      let prevRankMap = await getSnapshotRankMap();

      // Fallback: estimate from change24h if snapshot lookup returned empty
      if (prevRankMap.size === 0) {
        prevRankMap = new Map<string, number>();
        const previousScores = people.map(p => {
          const fi = p.fameIndex ?? Math.round(p.trendScore / 100);
          const delta = p.change24h ?? 0;
          const prevFi = delta !== 0 ? fi / (1 + delta / 100) : fi;
          return { id: p.id, prevFi };
        }).sort((a, b) => b.prevFi - a.prevFi);
        previousScores.forEach((s, i) => prevRankMap.set(s.id, i + 1));
      }

      // Merge metrics + rankChange into people
      let enrichedPeople = people.map(p => {
        const m = metricsMap.get(p.id);
        const prevRank = prevRankMap.get(p.id) ?? p.rank;
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

      // Apply search filter
      if (search && typeof search === 'string') {
        const searchLower = search.toLowerCase();
        enrichedPeople = enrichedPeople.filter(p => 
          p.name.toLowerCase().includes(searchLower) ||
          (p.category && p.category.toLowerCase().includes(searchLower))
        );
      }

      // Apply category filter
      if (category && typeof category === 'string') {
        enrichedPeople = enrichedPeople.filter(p => p.category === category);
      }

      // Apply sorting
      if (sort === 'rank') {
        enrichedPeople.sort((a, b) => a.rank - b.rank);
      } else if (sort === 'score') {
        enrichedPeople.sort((a, b) => b.trendScore - a.trendScore);
      } else if (sort === '24h') {
        enrichedPeople.sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
      } else if (sort === '7d') {
        enrichedPeople.sort((a, b) => (b.change7d ?? 0) - (a.change7d ?? 0));
      } else if (sort === 'approval') {
        // Sort by avg rating (highest first), tiebreak by vote count (more votes first), nulls last
        enrichedPeople.sort((a, b) => {
          const aRating = (a as any).approvalAvgRating ?? null;
          const bRating = (b as any).approvalAvgRating ?? null;
          if (aRating === null && bRating === null) return 0;
          if (aRating === null) return 1;
          if (bRating === null) return -1;
          if (bRating !== aRating) return bRating - aRating;
          // Tiebreak: more votes ranks higher
          return ((b as any).approvalVotesCount ?? 0) - ((a as any).approvalVotesCount ?? 0);
        });
      }

      // Store total count before pagination
      const totalCount = enrichedPeople.length;

      // Apply pagination if limit is provided
      if (limit && typeof limit === 'string') {
        const limitNum = parseInt(limit, 10);
        const offsetNum = offset && typeof offset === 'string' ? parseInt(offset, 10) : 0;
        
        if (!isNaN(limitNum) && limitNum > 0) {
          enrichedPeople = enrichedPeople.slice(offsetNum, offsetNum + limitNum);
        }
      }

      const baselineMeta = await getBaselineDiagnostics(totalCount);
      const baselineDegraded = baselineMeta.baseline24hStatus !== "normal";

      const safeData = baselineDegraded
        ? enrichedPeople.map(p => ({ ...p, change24h: null, change7d: null }))
        : enrichedPeople;

      res.json({
        data: safeData,
        totalCount,
        hasMore: limit ? (parseInt(offset as string || '0', 10) + safeData.length) < totalCount : false,
        meta: {
          scoreVersion: baselineMeta.scoreVersion,
          baselineStatus: baselineMeta.baseline24hStatus,
          sourceHealth: (() => {
            const health = getCurrentHealthSnapshot();
            const runMeta = getLastRunMeta();
            return {
              news: health.news.state,
              search: health.search.state,
              wiki: health.wiki.state,
              newsProviderUsed: runMeta?.newsProviderUsed ?? null,
              newsFreshCoveragePct: runMeta?.newsFreshCoveragePct ?? null,
              newsGovernorFactor: runMeta?.newsGovernorFactor ?? null,
              newsDegradedReason: health.news.state !== "HEALTHY" ? health.news.reason : null,
            };
          })(),
        },
      });
    } catch (error) {
      console.error("Error fetching trending people:", error);
      res.status(500).json({ error: "Failed to fetch trending data" });
    }
  });

  app.get("/api/trending/hot-movers", async (req, res) => {
    try {
      const debug = req.query.debug === '1';
      const now = Date.now();

      if (!debug && _cachedHotMovers && (now - _hotMoversCachedAt < HOT_MOVERS_TTL_MS)) {
        const currentRunId = await getLatestCompletedRunId();
        if (currentRunId === _hotMoversCachedRunId) {
          res.json(_cachedHotMovers);
          return;
        }
      }

      let people = await storage.getTrendingPeople();
      if (people.length === 0) {
        const fallback = await getSnapshotFallbackPeople();
        if (fallback && fallback.length > 0) {
          console.log(`[API] hot-movers using snapshot fallback (${fallback.length} people)`);
          people = fallback as any;
        } else {
          res.json([]);
          return;
        }
      }

      const prevRanks = await getSnapshotRankMap();
      const baselineStatus = prevRanks.size > 0 ? "normal" : "degraded";

      const enriched = people.map(p => ({
        ...p,
        rankChange: prevRanks.has(p.id) ? (prevRanks.get(p.id)! - p.rank) : null,
      }));

      const rankChanges = enriched.filter(p => p.rankChange != null).map(p => p.rankChange!);
      const deltas = enriched.filter(p => p.change24h != null).map(p => p.change24h!);

      const positiveRC = rankChanges.filter(v => v > 0).sort((a, b) => b - a);
      const positiveDeltas = deltas.filter(v => v > 0).sort((a, b) => b - a);

      const p5Index = (arr: number[]) => Math.max(0, Math.ceil(arr.length * 0.05) - 1);

      const thresholds = {
        rankChangeP90: positiveRC.length > 0 ? positiveRC[p5Index(positiveRC)] : 999,
        deltaP90: positiveDeltas.length > 0 ? positiveDeltas[p5Index(positiveDeltas)] : 999,
      };

      const hotMovers: Array<{
        id: string;
        name: string;
        avatar: string | null;
        category: string | null;
        rank: number;
        fameIndex: number | null;
        change24h: number | null;
        rankChange: number | null;
        badge: { label: string; color: string; description: string };
        sourceBreakdown?: { sources: Array<{ key: string; pct: number }>; activeSources: number } | null;
      }> = [];

      for (const p of enriched) {
        const delta = p.change24h;
        const rc = p.rankChange;

        const fmtDelta = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`;
        const fmtRank = (v: number) => `${v > 0 ? '+' : ''}${v}`;
        const metrics = `24h: ${delta != null ? fmtDelta(delta) : '—'} · Rank: ${rc != null ? fmtRank(rc) : '—'}`;

        let badge: { label: string; color: string; description: string } | null = null;

        if (rc != null && rc >= thresholds.rankChangeP90 && delta != null && delta >= thresholds.deltaP90) {
          badge = { label: "Breakout", color: "text-orange-400", description: `Big surge + big rank jump\n${metrics}` };
        } else if (delta != null && delta >= thresholds.deltaP90) {
          badge = { label: "Surging", color: "text-yellow-400", description: `Driver: Score spike\n${metrics}` };
        } else if (rc != null && rc >= thresholds.rankChangeP90) {
          badge = { label: "Surging", color: "text-yellow-400", description: `Driver: Rank jump\n${metrics}` };
        }

        if (badge) {
          hotMovers.push({
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            category: p.category,
            rank: p.rank,
            fameIndex: p.fameIndex,
            change24h: p.change24h,
            rankChange: p.rankChange,
            badge,
          });
        }
      }

      hotMovers.sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0));

      if (debug) {
        const sorted = [...hotMovers];
        res.json({
          baselineStatus,
          thresholds,
          totalQualified: sorted.length,
          cap: 8,
          candidates: sorted.map((c, i) => ({
            ...c,
            qualifies: true,
            reason: (c.rankChange != null && c.rankChange >= thresholds.rankChangeP90 && c.change24h != null && c.change24h >= thresholds.deltaP90)
              ? 'both'
              : (c.change24h != null && c.change24h >= thresholds.deltaP90)
                ? 'score'
                : 'rank',
            rankAmongQualified: i + 1,
            excludedBecause: i >= 8 ? 'cap' : null,
          })),
        });
        return;
      }

      const result = hotMovers.slice(0, 8);

      // Compute per-source score driver attribution for top movers
      const moverIds = result.map(m => m.id);
      const sourceAttribution = new Map<string, { sources: Array<{ key: string; pct: number; status: string }>; activeSources: number; dominantDriver: string | null }>();
      if (moverIds.length > 0) {
        try {
          const now = new Date();
          const window30h = new Date(now.getTime() - 30 * 60 * 60 * 1000);
          const window18h = new Date(now.getTime() - 18 * 60 * 60 * 1000);
          const time24h = now.getTime() - 24 * 60 * 60 * 1000;

          const [currentSnaps, prevSnaps] = await Promise.all([
            db.select({
              personId: trendSnapshots.personId,
              searchDelta: trendSnapshots.searchDelta,
              newsDelta: trendSnapshots.newsDelta,
              wikiDelta: trendSnapshots.wikiDelta,
              searchVolume: trendSnapshots.searchVolume,
              newsCount: trendSnapshots.newsCount,
              wikiPageviews: trendSnapshots.wikiPageviews,
              timestamp: trendSnapshots.timestamp,
            })
              .from(trendSnapshots)
              .where(and(
                inArray(trendSnapshots.personId, moverIds),
                gte(trendSnapshots.timestamp, window18h),
              ))
              .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id)),

            db.select({
              personId: trendSnapshots.personId,
              searchDelta: trendSnapshots.searchDelta,
              newsDelta: trendSnapshots.newsDelta,
              wikiDelta: trendSnapshots.wikiDelta,
              searchVolume: trendSnapshots.searchVolume,
              newsCount: trendSnapshots.newsCount,
              wikiPageviews: trendSnapshots.wikiPageviews,
              timestamp: trendSnapshots.timestamp,
            })
              .from(trendSnapshots)
              .where(and(
                inArray(trendSnapshots.personId, moverIds),
                gte(trendSnapshots.timestamp, window30h),
                lte(trendSnapshots.timestamp, window18h),
              ))
              .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id)),
          ]);

          const latestByPerson = new Map<string, typeof currentSnaps[0]>();
          for (const s of currentSnaps) {
            if (!latestByPerson.has(s.personId)) latestByPerson.set(s.personId, s);
          }
          const prevByPerson = new Map<string, typeof prevSnaps[0]>();
          for (const s of prevSnaps) {
            const existing = prevByPerson.get(s.personId);
            if (!existing || Math.abs(new Date(s.timestamp).getTime() - time24h) < Math.abs(new Date(existing.timestamp).getTime() - time24h)) {
              prevByPerson.set(s.personId, s);
            }
          }

          for (const id of moverIds) {
            const curr = latestByPerson.get(id);
            const prev = prevByPerson.get(id);
            if (!curr) continue;

            const rawSources = [
              { key: "search", currVal: curr.searchDelta ?? 0, prevVal: prev?.searchDelta ?? 0, weight: 0.40 },
              { key: "news", currVal: curr.newsDelta ?? 0, prevVal: prev?.newsDelta ?? 0, weight: 0.35 },
              { key: "wiki", currVal: curr.wikiDelta ?? 0, prevVal: prev?.wikiDelta ?? 0, weight: 0.25 },
            ];

            const activeSources = rawSources.filter(s => s.currVal !== 0 || s.prevVal !== 0);

            let sources: Array<{ key: string; pct: number; status: string }> = [];
            let dominantDriver: string | null = null;

            if (activeSources.length > 0) {
              const contributions = activeSources.map(s => ({
                key: s.key,
                absContrib: Math.abs(s.currVal - s.prevVal) * s.weight,
              }));
              const total = contributions.reduce((sum, c) => sum + c.absContrib, 0);

              if (total >= 0.001) {
                sources = contributions
                  .map(c => ({ key: c.key, pct: Math.round((c.absContrib / total) * 100), status: "active" as string }))
                  .sort((a, b) => b.pct - a.pct);
              }
            }

            if (sources.length === 0) {
              const searchChange = Math.abs((curr.searchVolume ?? 0) - (prev?.searchVolume ?? 0));
              const newsChange = Math.abs((curr.newsCount ?? 0) - (prev?.newsCount ?? 0));
              const wikiChange = Math.abs((curr.wikiPageviews ?? 0) - (prev?.wikiPageviews ?? 0));
              const searchContrib = searchChange * 0.40;
              const newsContrib = newsChange * 0.35;
              const wikiContrib = wikiChange * 0.25;
              const totalContrib = searchContrib + newsContrib + wikiContrib;

              if (totalContrib > 0) {
                const rawContribs = [
                  { key: "search", absContrib: searchContrib },
                  { key: "news", absContrib: newsContrib },
                  { key: "wiki", absContrib: wikiContrib },
                ].filter(c => c.absContrib > 0);
                sources = rawContribs
                  .map(c => ({ key: c.key, pct: Math.round((c.absContrib / totalContrib) * 100), status: "active" }))
                  .sort((a, b) => b.pct - a.pct);
              }
            }

            const allKeys = ["search", "news", "wiki"];
            const presentKeys = new Set(sources.map(s => s.key));
            const hasAnyData = curr.searchDelta != null || curr.newsDelta != null || curr.wikiDelta != null
              || (curr.searchVolume ?? 0) > 0 || (curr.newsCount ?? 0) > 0 || (curr.wikiPageviews ?? 0) > 0;
            for (const k of allKeys) {
              if (!presentKeys.has(k)) {
                sources.push({ key: k, pct: 0, status: hasAnyData ? "quiet" : "no-data" });
              }
            }

            const top = sources.find(s => s.status === "active");
            if (top) {
              const driverLabels: Record<string, string> = {
                news: "News coverage up",
                wiki: "Wiki views up",
                search: "Search interest up",
              };
              dominantDriver = driverLabels[top.key] ?? null;
            }

            sourceAttribution.set(id, { sources, activeSources: sources.filter(s => s.status === "active").length, dominantDriver });
          }
        } catch (e) {
          console.warn("[hot-movers] Source attribution computation failed:", e);
        }
      }

      const baselineMeta = await getBaselineDiagnostics(people.length);
      const baselineDegraded = baselineMeta.baseline24hStatus !== "normal";
      const safeResult = baselineDegraded
        ? result.map(p => ({ ...p, change24h: null, sourceBreakdown: null }))
        : result.map(p => ({
            ...p,
            sourceBreakdown: sourceAttribution.get(p.id) ?? null,
          }));
      const responseWithMeta = {
        data: safeResult,
        meta: {
          currentRunId: baselineMeta.currentRunId,
          baseline24hRunId: baselineMeta.baseline24hRunId,
          baseline24hAgeHours: baselineMeta.baseline24hAgeHours,
          baselineStatus: baselineMeta.baseline24hStatus,
          coveragePct: baselineMeta.baseline24hCoveragePct,
          scoreVersion: baselineMeta.scoreVersion,
        },
      };
      _cachedHotMovers = responseWithMeta;
      _hotMoversCachedAt = Date.now();
      _hotMoversCachedRunId = await getLatestCompletedRunId();
      res.json(responseWithMeta);
    } catch (error) {
      console.error("Error fetching hot movers:", error);
      res.status(500).json({ error: "Failed to fetch hot movers" });
    }
  });

  // Get single person details
  app.get("/api/trending/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const person = await storage.getTrendingPerson(id);
      
      // Only return real data from database - no mock data fallback
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      if (!getSessionId(req)) {
        const newSid = randomUUID();
        res.cookie(SESSION_COOKIE_NAME, newSid, {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 365 * 24 * 60 * 60 * 1000,
          path: '/',
        });
      }
      if (shouldCountView(req, id)) {
        db.update(trendingPeople)
          .set({ profileViews10m: sql`COALESCE(${trendingPeople.profileViews10m}, 0) + 1` })
          .where(eq(trendingPeople.id, id))
          .execute()
          .catch(() => {});
      }

      const metrics = await db
        .select({
          approvalPct: celebrityMetrics.approvalPct,
          approvalAvgRating: celebrityMetrics.approvalAvgRating,
          approvalVotesCount: celebrityMetrics.approvalVotesCount,
        })
        .from(celebrityMetrics)
        .where(eq(celebrityMetrics.celebrityId, id))
        .limit(1);

      const m = metrics[0];

      const tracked = await db
        .select({ wikiSlug: trackedPeople.wikiSlug })
        .from(trackedPeople)
        .where(eq(trackedPeople.id, id))
        .limit(1);

      res.json({
        ...person,
        approvalPct: m?.approvalPct ?? null,
        approvalAvgRating: m?.approvalAvgRating ?? null,
        approvalVotesCount: m?.approvalVotesCount ?? 0,
        wikiSlug: tracked[0]?.wikiSlug ?? null,
      });
    } catch (error) {
      console.error("Error fetching person:", error);
      res.status(500).json({ error: "Failed to fetch person data" });
    }
  });

  // Get historical trend data for graphs
  app.get("/api/trending/:id/history", async (req, res) => {
    try {
      const { id } = req.params;
      const { days = '7' } = req.query; // Default to 7 days
      
      const daysNum = parseInt(days as string);
      
      // Validate days parameter
      if (isNaN(daysNum) || daysNum < 1 || daysNum > 3650) {
        return res.status(400).json({ error: "Invalid days parameter. Must be between 1 and 3650." });
      }
      
      const cutoffDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
      
      // Fetch snapshots for this person within the time range
      // Safety net: only include on-the-hour snapshots (written by ingest.ts)
      // Off-hour snapshots with unique millisecond timestamps are pollution
      const snapshots = await db
        .select({
          timestamp: trendSnapshots.timestamp,
          trendScore: trendSnapshots.trendScore,
          fameIndex: trendSnapshots.fameIndex,
          newsCount: trendSnapshots.newsCount,
          youtubeViews: trendSnapshots.youtubeViews,
          spotifyFollowers: trendSnapshots.spotifyFollowers,
          searchVolume: trendSnapshots.searchVolume,
          wikiPageviews: trendSnapshots.wikiPageviews,
        })
        .from(trendSnapshots)
        .where(and(
          eq(trendSnapshots.personId, id),
          sql`${trendSnapshots.timestamp} >= ${cutoffDate}`,
          sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
          eq(trendSnapshots.snapshotOrigin, 'ingest')
        ))
        .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
        .limit(daysNum * 24); // Max one per hour for requested days
      
      // Transform for graph display
      const historyData = snapshots.reverse().map(snapshot => ({
        timestamp: snapshot.timestamp.toISOString(),
        date: snapshot.timestamp.toLocaleDateString(),
        time: snapshot.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        trendScore: snapshot.trendScore,
        newsCount: snapshot.newsCount,
        youtubeViews: snapshot.youtubeViews,
        spotifyFollowers: snapshot.spotifyFollowers,
        searchVolume: snapshot.searchVolume,
      }));

      res.json(historyData);
    } catch (error) {
      console.error("Error fetching history:", error);
      res.status(500).json({ error: "Failed to fetch historical data" });
    }
  });

  // Refresh trending data - DEPRECATED
  // NOTE: This endpoint should NOT write mock data to the database
  // Real data comes from the scheduled ingestion job (ingest.ts)
  app.post("/api/trending/refresh", async (req, res) => {
    try {
      // Just return current database data - don't write mock data
      const currentData = await storage.getTrendingPeople();
      res.json({ 
        success: true, 
        count: currentData.length,
        message: "Data is managed by scheduled ingestion job"
      });
    } catch (error) {
      console.error("Error in trending/refresh:", error);
      res.status(500).json({ error: "Failed to get data" });
    }
  });

  // ============ TREND CONTEXT API (Why Trending) ============
  
  // Get trend context for a single person
  app.get("/api/trending/:id/context", async (req, res) => {
    try {
      const { id } = req.params;
      const context = await getTrendContext(id);
      
      res.json({
        ...context,
        lastScoredAtFormatted: formatRelativeTime(context.lastScoredAt),
        sourceTimestampsFormatted: {
          wiki: formatRelativeTime(context.sourceTimestamps.wiki),
          news: formatRelativeTime(context.sourceTimestamps.news),
          search: formatRelativeTime(context.sourceTimestamps.search),
        },
      });
    } catch (error) {
      console.error("Error fetching trend context:", error);
      res.status(500).json({ error: "Failed to fetch trend context" });
    }
  });
  
  app.post("/api/trending/context/batch", async (req, res) => {
    try {
      const { personIds } = req.body;
      
      if (!Array.isArray(personIds) || personIds.length === 0) {
        return res.status(400).json({ error: "personIds array required" });
      }
      
      if (personIds.length > 100) {
        return res.status(400).json({ error: "Max 100 person IDs per request" });
      }
      
      const contexts = await getTrendContextBatch(personIds);
      
      const result: Record<string, TrendContext & { lastScoredAtFormatted: string; sourceTimestampsFormatted: Record<string, string> }> = {};
      
      contexts.forEach((context, id) => {
        result[id] = {
          ...context,
          lastScoredAtFormatted: formatRelativeTime(context.lastScoredAt),
          sourceTimestampsFormatted: {
            wiki: formatRelativeTime(context.sourceTimestamps.wiki),
            news: formatRelativeTime(context.sourceTimestamps.news),
            search: formatRelativeTime(context.sourceTimestamps.search),
          },
        };
      });
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching batch trend context:", error);
      res.status(500).json({ error: "Failed to fetch trend contexts" });
    }
  });
  
  // Get system data freshness status
  app.get("/api/system/freshness", async (req, res) => {
    try {
      const cacheStats = await db
        .select({
          provider: apiCache.provider,
          latestFetch: sql<Date>`MAX(${apiCache.fetchedAt})`,
          count: sql<number>`COUNT(*)`,
        })
        .from(apiCache)
        .groupBy(apiCache.provider);
      
      const freshness: Record<string, { lastUpdated: string; count: number; status: "live" | "stale" | "cached" }> = {};
      const now = new Date();
      
      const excludedProviders = new Set(["x", "twitter"]);
      for (const stat of cacheStats) {
        if (excludedProviders.has(stat.provider)) continue;
        const latestDate = stat.latestFetch ? new Date(stat.latestFetch) : null;
        const hoursSince = latestDate ? (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60) : Infinity;
        
        let status: "live" | "stale" | "cached" = "live";
        if (hoursSince > 24) status = "stale";
        else if (hoursSince > 2) status = "cached";
        
        freshness[stat.provider] = {
          lastUpdated: formatRelativeTime(latestDate),
          count: Number(stat.count),
          status,
        };
      }
      
      let fullRefresh = getLastFullRefreshAt();

      let liveUpdatedAt: Date | null = null;
      try {
        const [liveTs] = await db
          .select({ ts: sql<Date>`MAX(${trendingPeople.liveUpdatedAt})` })
          .from(trendingPeople);
        if (liveTs?.ts) liveUpdatedAt = new Date(liveTs.ts);
      } catch (e) {}

      if (!fullRefresh || !liveUpdatedAt) {
        try {
          const [latestCompleted] = await db
            .select({ finishedAt: ingestionRuns.finishedAt })
            .from(ingestionRuns)
            .where(and(
              eq(ingestionRuns.status, "completed"),
              eq(ingestionRuns.scoreVersion, SCORE_VERSION),
            ))
            .orderBy(desc(ingestionRuns.startedAt))
            .limit(1);
          if (latestCompleted?.finishedAt) {
            const completedDate = new Date(latestCompleted.finishedAt);
            if (!fullRefresh) fullRefresh = completedDate;
            if (!liveUpdatedAt) liveUpdatedAt = completedDate;
          }
        } catch (e) {}
      }

      const lastScoredAt = fullRefresh || liveUpdatedAt;

      let runInProgress: { runId: string; startedAt: string; startedAtFormatted: string } | null = null;
      try {
        const [activeRun] = await db.select({
          id: ingestionRuns.id,
          startedAt: ingestionRuns.startedAt,
        })
          .from(ingestionRuns)
          .where(eq(ingestionRuns.status, "running"))
          .orderBy(desc(ingestionRuns.startedAt))
          .limit(1);
        if (activeRun) {
          runInProgress = {
            runId: activeRun.id,
            startedAt: activeRun.startedAt.toISOString(),
            startedAtFormatted: formatRelativeTime(activeRun.startedAt),
          };
        }
      } catch (e) {}

      res.json({
        freshness,
        systemStatus: Object.values(freshness).every(f => f.status !== "stale") ? "healthy" : "degraded",
        lastScoredAt: lastScoredAt?.toISOString() || null,
        lastScoredAtFormatted: formatRelativeTime(lastScoredAt),
        liveUpdatedAt: liveUpdatedAt?.toISOString() || null,
        liveUpdatedAtFormatted: formatRelativeTime(liveUpdatedAt),
        fullRefreshAt: fullRefresh?.toISOString() || null,
        fullRefreshAtFormatted: formatRelativeTime(fullRefresh),
        runInProgress,
      });
    } catch (error) {
      console.error("Error fetching system freshness:", error);
      res.status(500).json({ error: "Failed to fetch system status" });
    }
  });

  app.get("/api/trending/movers/:type", async (req, res) => {
    try {
      const { type } = req.params;
      let people = await storage.getTrendingPeople();
      
      if (people.length === 0) {
        const fallback = await getSnapshotFallbackPeople();
        if (fallback && fallback.length > 0) {
          console.log(`[API] movers/${type} using snapshot fallback (${fallback.length} people)`);
          people = fallback as any;
        } else {
          console.log('[API] trending_people is empty for movers - waiting for ingestion job');
          res.json([]);
          return;
        }
      }

      const baselineMeta = await getBaselineDiagnostics(people.length);
      const baselineDegraded = baselineMeta.baseline24hStatus !== "normal";

      if (type === 'gainers') {
        people = [...people].sort((a, b) => (b.change7d ?? 0) - (a.change7d ?? 0)).slice(0, 10);
      } else if (type === 'droppers') {
        people = [...people].sort((a, b) => (a.change7d ?? 0) - (b.change7d ?? 0)).slice(0, 10);
      } else if (type === 'daily') {
        const prevRanks = await getSnapshotRankMap();
        const withRankChange = people.map(p => ({
          ...p,
          change24h: baselineDegraded ? null : p.change24h,
          change7d: baselineDegraded ? null : p.change7d,
          rankChange: prevRanks.has(p.id) ? (prevRanks.get(p.id)! - p.rank) : null,
        }));
        const byDelta = [...withRankChange].sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0)).slice(0, 15);
        const byRank = [...withRankChange].sort((a, b) => Math.abs(b.rankChange ?? 0) - Math.abs(a.rankChange ?? 0)).slice(0, 15);
        const seen = new Set<string>();
        const merged: typeof withRankChange = [];
        for (const p of [...byDelta, ...byRank]) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            merged.push(p);
          }
        }
        merged.sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0));
        res.json(merged);
        return;
      }

      const prevRanks = await getSnapshotRankMap();
      const enriched = people.map(p => ({
        ...p,
        change24h: baselineDegraded ? null : p.change24h,
        change7d: baselineDegraded ? null : p.change7d,
        rankChange: prevRanks.has(p.id) ? (prevRanks.get(p.id)! - p.rank) : null,
      }));

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching movers:", error);
      res.status(500).json({ error: "Failed to fetch movers data" });
    }
  });

  // ============ MOMENTUM SIGNALS ENDPOINT ============
  app.get("/api/people/:id/momentum", async (req, res) => {
    try {
      const { id } = req.params;

      const [person] = await db
        .select()
        .from(trackedPeople)
        .where(eq(trackedPeople.id, id))
        .limit(1);

      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }

      const [trending] = await db
        .select()
        .from(trendingPeople)
        .where(eq(trendingPeople.id, id))
        .limit(1);

      const latestSnapshots = await db
        .select({
          timestamp: trendSnapshots.timestamp,
          newsCount: trendSnapshots.newsCount,
          searchVolume: trendSnapshots.searchVolume,
          wikiPageviews: trendSnapshots.wikiPageviews,
          wikiDelta: trendSnapshots.wikiDelta,
          newsDelta: trendSnapshots.newsDelta,
          searchDelta: trendSnapshots.searchDelta,
          massScore: trendSnapshots.massScore,
          velocityScore: trendSnapshots.velocityScore,
          drivers: trendSnapshots.drivers,
          diagnostics: trendSnapshots.diagnostics,
          trendScore: trendSnapshots.trendScore,
          fameIndex: trendSnapshots.fameIndex,
        })
        .from(trendSnapshots)
        .where(and(
          eq(trendSnapshots.personId, id),
          eq(trendSnapshots.snapshotOrigin, 'ingest'),
          sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`
        ))
        .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
        .limit(2);

      if (latestSnapshots.length === 0) {
        return res.json({
          asOf: null,
          activeSources: [],
          staleFlags: { dataDelayed: true },
          signals: null,
          categoryRank: null,
          officialProfiles: {},
        });
      }

      const latest = latestSnapshots[0];
      const prev = latestSnapshots.length > 1 ? latestSnapshots[1] : null;
      const diag = latest.diagnostics as Record<string, any> | null;
      const evidence = diag?.evidence ?? {};
      const fresh = diag?.fresh ?? {};

      const ageMs = Date.now() - latest.timestamp.getTime();
      const ageMinutes = Math.round(ageMs / 60000);
      const dataDelayed = ageMs > 3 * 60 * 60 * 1000;

      const activeSources: string[] = [];
      if (fresh.wiki !== false) activeSources.push("wiki");
      if (fresh.news !== false) activeSources.push("news");
      if (fresh.search !== false) activeSources.push("search");

      const staleFlags: Record<string, boolean> = {};
      if (dataDelayed) staleFlags.dataDelayed = true;
      if (fresh.newsEmaHeld) staleFlags.newsHeld = true;
      if (fresh.searchEmaHeld) staleFlags.searchHeld = true;

      const searchDeltaPct = prev && prev.searchVolume > 0
        ? Math.round(((latest.searchVolume - prev.searchVolume) / prev.searchVolume) * 100)
        : 0;

      const newsDeltaPct = prev && prev.newsCount > 0
        ? Math.round(((latest.newsCount - prev.newsCount) / prev.newsCount) * 100)
        : 0;

      const wikiDeltaPct = prev && prev.wikiPageviews && prev.wikiPageviews > 0
        ? Math.round(((latest.wikiPageviews! - prev.wikiPageviews) / prev.wikiPageviews) * 100)
        : 0;

      const change24hAbs = Math.abs(trending?.change24h ?? 0);
      const hasSignificantMovement = change24hAbs >= 2.0;

      let driverBreakdown: { search: number; news: number; wiki: number } | null = null;
      let breakdownPct: { search: number; news: number; wiki: number } | null = null;
      let driverSourceCount = 3;
      let quietSources: string[] = [];
      let driversStatus: "active" | "stable" = "stable";
      let driversIsExact = false;
      let driversMethod: string = "none";

      {
        const currentVC = diag?.velocityComponents;

        const [snap24hAgo] = await db
          .select({
            diagnostics: trendSnapshots.diagnostics,
            searchVolume: trendSnapshots.searchVolume,
            newsCount: trendSnapshots.newsCount,
            wikiPageviews: trendSnapshots.wikiPageviews,
          })
          .from(trendSnapshots)
          .where(and(
            eq(trendSnapshots.personId, id),
            eq(trendSnapshots.snapshotOrigin, 'ingest'),
            sql`${trendSnapshots.timestamp} BETWEEN NOW() - INTERVAL '28 hours' AND NOW() - INTERVAL '20 hours'`,
          ))
          .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
          .limit(1);

        if (snap24hAgo) {
          const prevDiag = snap24hAgo.diagnostics as Record<string, any> | null;
          const prevVC = prevDiag?.velocityComponents;

          if (currentVC && prevVC && currentVC.weights && prevVC.weights) {
            driversMethod = "exact_velocity_components";
            driversIsExact = true;

            const searchWeighted = currentVC.search * currentVC.weights.search;
            const newsWeighted = currentVC.news * currentVC.weights.news;
            const wikiWeighted = currentVC.wiki * currentVC.weights.wiki;
            const totalWeighted = searchWeighted + newsWeighted + wikiWeighted;

            if (totalWeighted > 0) {
              const rawSearch = (searchWeighted / totalWeighted) * 100;
              const rawNews = (newsWeighted / totalWeighted) * 100;
              const rawWiki = (wikiWeighted / totalWeighted) * 100;
              let pSearch = Math.floor(rawSearch);
              let pNews = Math.floor(rawNews);
              let pWiki = Math.floor(rawWiki);
              let remainder = 100 - (pSearch + pNews + pWiki);
              const remainders = [
                { key: 'search', frac: rawSearch - pSearch },
                { key: 'news', frac: rawNews - pNews },
                { key: 'wiki', frac: rawWiki - pWiki },
              ].sort((a, b) => b.frac - a.frac);
              for (const r of remainders) {
                if (remainder <= 0) break;
                if (r.key === 'search') pSearch++;
                else if (r.key === 'news') pNews++;
                else pWiki++;
                remainder--;
              }
              breakdownPct = { search: pSearch, news: pNews, wiki: pWiki };
            }

            const searchDelta = Math.abs(searchWeighted - (prevVC.search * prevVC.weights.search));
            const newsDelta = Math.abs(newsWeighted - (prevVC.news * prevVC.weights.news));
            const wikiDelta = Math.abs(wikiWeighted - (prevVC.wiki * prevVC.weights.wiki));
            const totalDelta = searchDelta + newsDelta + wikiDelta;

            if (searchDelta / Math.max(searchWeighted, 1) < 0.05) quietSources.push("Search");
            if (newsDelta / Math.max(newsWeighted, 1) < 0.05) quietSources.push("News");
            if (wikiDelta / Math.max(wikiWeighted, 1) < 0.05) quietSources.push("Wikipedia");
            driverSourceCount = 3 - quietSources.length;

            if (totalDelta > 0 && hasSignificantMovement) {
              driverBreakdown = {
                search: Math.round((searchDelta / totalDelta) * 100),
                news: Math.round((newsDelta / totalDelta) * 100),
                wiki: Math.round((wikiDelta / totalDelta) * 100),
              };
              driversStatus = "active";
            }
          } else {
            driversMethod = "estimate_signal_change";

            const searchChange = Math.abs(latest.searchVolume - snap24hAgo.searchVolume);
            const newsChange = Math.abs(latest.newsCount - snap24hAgo.newsCount);
            const wikiChange = Math.abs((latest.wikiPageviews ?? 0) - (snap24hAgo.wikiPageviews ?? 0));

            const searchContrib = searchChange * 0.40;
            const newsContrib = newsChange * 0.35;
            const wikiContrib = wikiChange * 0.25;
            const totalContrib = searchContrib + newsContrib + wikiContrib;

            const searchBase = Math.max(snap24hAgo.searchVolume, 1);
            const newsBase = Math.max(snap24hAgo.newsCount, 1);
            const wikiBase = Math.max(snap24hAgo.wikiPageviews ?? 1, 1);
            if (searchChange / searchBase < 0.05) quietSources.push("Search");
            if (newsChange / newsBase < 0.05) quietSources.push("News");
            if (wikiChange / wikiBase < 0.05) quietSources.push("Wikipedia");
            driverSourceCount = 3 - quietSources.length;

            if (totalContrib > 0 && hasSignificantMovement) {
              driverBreakdown = {
                search: Math.round((searchContrib / totalContrib) * 100),
                news: Math.round((newsContrib / totalContrib) * 100),
                wiki: Math.round((wikiContrib / totalContrib) * 100),
              };
              driversStatus = "active";
            }
          }
        }
      }

      let categoryRankNum: number | null = null;
      if (trending?.category) {
        const [catRankRow] = await db
          .select({ cnt: sql<number>`count(*)::int` })
          .from(trendingPeople)
          .where(and(
            eq(trendingPeople.category, trending.category),
            sql`${trendingPeople.rank} < ${trending.rank}`
          ));
        categoryRankNum = (catRankRow?.cnt ?? 0) + 1;
      }

      const officialProfiles: Record<string, string> = {};
      if (person.xHandle) officialProfiles.x = person.xHandle;
      if (person.instagramHandle) officialProfiles.instagram = person.instagramHandle;
      if (person.tiktokHandle) officialProfiles.tiktok = person.tiktokHandle;
      if (person.youtubeId) officialProfiles.youtube = person.youtubeId;
      if (person.spotifyId) officialProfiles.spotify = person.spotifyId;

      res.json({
        asOf: latest.timestamp.toISOString(),
        ageMinutes,
        activeSources,
        staleFlags,
        signals: {
          search: {
            volume: latest.searchVolume,
            deltaPct: searchDeltaPct,
            relatedSearches: (evidence.relatedSearches ?? []).slice(0, 5),
            peopleAlsoAsk: (evidence.peopleAlsoAsk ?? []).slice(0, 5),
          },
          news: await (async () => {
            let displayCount = latest.newsCount;
            let recentPeak: number | null = null;
            let recentPeakAge: string | null = null;

            if (latest.newsCount === 0) {
              const recentNonZero = await db
                .select({
                  newsCount: trendSnapshots.newsCount,
                  timestamp: trendSnapshots.timestamp,
                })
                .from(trendSnapshots)
                .where(and(
                  eq(trendSnapshots.personId, id),
                  eq(trendSnapshots.snapshotOrigin, 'ingest'),
                  sql`${trendSnapshots.newsCount} > 0`,
                  sql`${trendSnapshots.timestamp} >= NOW() - INTERVAL '24 hours'`,
                ))
                .orderBy(desc(trendSnapshots.newsCount))
                .limit(1);

              if (recentNonZero.length > 0) {
                recentPeak = recentNonZero[0].newsCount;
                const hoursAgo = Math.round((Date.now() - recentNonZero[0].timestamp.getTime()) / (1000 * 60 * 60));
                recentPeakAge = hoursAgo < 1 ? "just now" : hoursAgo === 1 ? "~1h ago" : `~${hoursAgo}h ago`;
              }
            }

            return {
              count: displayCount,
              recentPeak,
              recentPeakAge,
              deltaPct: newsDeltaPct,
              headlines: (evidence.newsHeadlines ?? []).slice(0, 3),
              provider: evidence.newsProvider ?? fresh.newsSource ?? "unknown",
            };
          })(),
          wiki: {
            views: latest.wikiPageviews ?? 0,
            deltaPct: wikiDeltaPct,
          },
          drivers: {
            status: driversStatus,
            breakdown: driverBreakdown,
            breakdownPct,
            activeSources: driversStatus === "active" ? driverSourceCount : activeSources.length,
            quietSources: quietSources,
            isExact: driversIsExact,
            method: driversMethod,
          },
        },
        categoryRank: trending ? {
          overall: trending.rank,
          category: trending.category,
          categoryRank: categoryRankNum,
        } : null,
        officialProfiles,
      });
    } catch (error) {
      console.error("Error fetching momentum signals:", error);
      res.status(500).json({ error: "Failed to fetch momentum signals" });
    }
  });

  // Get all images for a celebrity (for "Curate Profile" voting)
  app.get("/api/people/:id/images", async (req, res) => {
    try {
      const { id } = req.params;
      
      const images = await db
        .select()
        .from(celebrityImages)
        .where(eq(celebrityImages.personId, id))
        .orderBy(desc(celebrityImages.isPrimary), desc(sql`(${celebrityImages.votesUp} - ${celebrityImages.votesDown})`));
      
      res.json(images);
    } catch (error) {
      console.error("Error fetching celebrity images:", error);
      res.status(500).json({ error: "Failed to fetch celebrity images" });
    }
  });

  // Get primary avatar for a celebrity (most voted or marked as primary)
  app.get("/api/people/:id/avatar", async (req, res) => {
    try {
      const { id } = req.params;
      
      const [primaryImage] = await db
        .select()
        .from(celebrityImages)
        .where(eq(celebrityImages.personId, id))
        .orderBy(desc(celebrityImages.isPrimary), desc(sql`(${celebrityImages.votesUp} - ${celebrityImages.votesDown})`))
        .limit(1);
      
      if (primaryImage) {
        res.json({ imageUrl: primaryImage.imageUrl });
      } else {
        res.json({ imageUrl: null });
      }
    } catch (error) {
      console.error("Error fetching primary avatar:", error);
      res.status(500).json({ error: "Failed to fetch primary avatar" });
    }
  });

  // Vote on a celebrity image (for Curate Profile feature)
  app.post("/api/people/:personId/images/:imageId/vote", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const { personId, imageId } = req.params;
      const { direction } = req.body;
      
      if (!direction || (direction !== 'up' && direction !== 'down')) {
        return res.status(400).json({ error: "Invalid direction. Must be 'up' or 'down'" });
      }
      
      // Check if image exists and belongs to the person
      const [image] = await db.select()
        .from(celebrityImages)
        .where(and(
          eq(celebrityImages.id, imageId),
          eq(celebrityImages.personId, personId)
        ));
      
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }
      
      // Update the vote count
      if (direction === 'up') {
        await db.update(celebrityImages)
          .set({ votesUp: sql`${celebrityImages.votesUp} + 1` })
          .where(eq(celebrityImages.id, imageId));
      } else {
        await db.update(celebrityImages)
          .set({ votesDown: sql`${celebrityImages.votesDown} + 1` })
          .where(eq(celebrityImages.id, imageId));
      }
      
      // Sync winning avatar to tracked_people and trending_people
      await syncWinningAvatarForPerson(personId);

      // Fetch updated image
      const [updatedImage] = await db.select()
        .from(celebrityImages)
        .where(eq(celebrityImages.id, imageId));
      
      res.json(updatedImage);
    } catch (error) {
      console.error("Error voting on celebrity image:", error);
      res.status(500).json({ error: "Failed to vote on image" });
    }
  });

  // Get community insights for a person with vote counts
  app.get("/api/community-insights/:personId", async (req, res) => {
    try {
      const { personId } = req.params;
      
      // Get all insights for this person with vote counts
      const insights = await db
        .select({
          id: communityInsights.id,
          personId: communityInsights.personId,
          userId: communityInsights.userId,
          username: communityInsights.username,
          content: communityInsights.content,
          sentimentVote: communityInsights.sentimentVote,
          createdAt: communityInsights.createdAt,
          upvotes: sql<number>`CAST(COUNT(CASE WHEN ${insightVotes.voteType} = 'up' THEN 1 END) AS INTEGER)`,
          downvotes: sql<number>`CAST(COUNT(CASE WHEN ${insightVotes.voteType} = 'down' THEN 1 END) AS INTEGER)`,
        })
        .from(communityInsights)
        .leftJoin(insightVotes, eq(insightVotes.insightId, communityInsights.id))
        .where(eq(communityInsights.personId, personId))
        .groupBy(
          communityInsights.id,
          communityInsights.personId,
          communityInsights.userId,
          communityInsights.username,
          communityInsights.content,
          communityInsights.sentimentVote,
          communityInsights.createdAt
        )
        .orderBy(desc(sql`CAST(COUNT(CASE WHEN ${insightVotes.voteType} = 'up' THEN 1 END) AS INTEGER) - CAST(COUNT(CASE WHEN ${insightVotes.voteType} = 'down' THEN 1 END) AS INTEGER)`));

      res.json(insights);
    } catch (error) {
      console.error("Error fetching community insights:", error);
      res.status(500).json({ error: "Failed to fetch community insights" });
    }
  });

  // Create a new community insight (protected route)
  app.post("/api/community-insights", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { personId, username, content, sentimentVote } = req.body;
      
      if (!personId || !content) {
        return res.status(400).json({ error: "Missing required fields: personId, content" });
      }

      // Validate content length (max 2500 characters)
      if (content.length > 2500) {
        return res.status(400).json({ error: "Content exceeds maximum length of 2500 characters" });
      }

      // Validate sentimentVote if provided (must be 1-10)
      if (sentimentVote !== undefined && sentimentVote !== null) {
        if (typeof sentimentVote !== 'number' || sentimentVote < 1 || sentimentVote > 10) {
          return res.status(400).json({ error: "Sentiment vote must be between 1 and 10" });
        }
      }
      
      const [newInsight] = await db
        .insert(communityInsights)
        .values({
          personId,
          userId: req.userId!, // Use verified user ID from auth middleware
          username: username || req.userId!.substring(0, 8),
          content,
          sentimentVote: sentimentVote || null,
        })
        .returning();

      res.json(newInsight);
    } catch (error: any) {
      console.error("Error creating community insight:", error);
      res.status(400).json({ error: error.message || "Failed to create insight" });
    }
  });

  // Vote on a community insight (protected route)
  app.post("/api/community-insights/:id/vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { voteType } = req.body;

      if (!voteType || !['up', 'down'].includes(voteType)) {
        return res.status(400).json({ error: "Invalid vote type. Must be 'up' or 'down'" });
      }

      const userId = req.userId!; // Verified user ID from auth middleware

      // Check if user already voted on this insight
      const existingVote = await db
        .select()
        .from(insightVotes)
        .where(and(
          eq(insightVotes.insightId, id),
          eq(insightVotes.userId, userId)
        ))
        .limit(1);

      if (existingVote.length > 0) {
        // Update existing vote
        await db
          .update(insightVotes)
          .set({ voteType })
          .where(and(
            eq(insightVotes.insightId, id),
            eq(insightVotes.userId, userId)
          ));
      } else {
        // Create new vote
        await db
          .insert(insightVotes)
          .values({
            insightId: id,
            userId,
            voteType,
          });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error voting on insight:", error);
      res.status(500).json({ error: error.message || "Failed to vote" });
    }
  });

  // Get user's vote status for insights (protected route)
  app.get("/api/community-insights/:personId/votes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { personId } = req.params;
      const userId = req.userId!; // Verified user ID from auth middleware
      
      // Get all insights for this person
      const personInsights = await db
        .select({ id: communityInsights.id })
        .from(communityInsights)
        .where(eq(communityInsights.personId, personId));

      const insightIds = personInsights.map(i => i.id);

      if (insightIds.length === 0) {
        return res.json({});
      }

      // Get user's votes for these insights
      const votes = await db
        .select()
        .from(insightVotes)
        .where(and(
          eq(insightVotes.userId, userId),
          sql`${insightVotes.insightId} IN ${insightIds}`
        ));

      // Convert to map: insightId -> voteType
      const voteMap = votes.reduce((acc, vote) => {
        acc[vote.insightId] = vote.voteType;
        return acc;
      }, {} as Record<string, string>);

      res.json(voteMap);
    } catch (error) {
      console.error("Error fetching user votes:", error);
      res.status(500).json({ error: "Failed to fetch user votes" });
    }
  });

  // ===== OVERRATED/UNDERRATED SENTIMENT VOTES API =====
  
  // Submit an overrated/underrated vote (rate limited to 1/user/person/day)
  app.post("/api/sentiment-votes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { personId, personName, voteType } = req.body;
      const userId = req.userId!;
      
      if (!personId || !voteType) {
        return res.status(400).json({ error: "personId and voteType are required" });
      }
      
      if (!['overrated', 'underrated'].includes(voteType)) {
        return res.status(400).json({ error: "voteType must be 'overrated' or 'underrated'" });
      }
      
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Check if user already voted on this person today
      const existingVote = await db
        .select()
        .from(sentimentVotes)
        .where(and(
          eq(sentimentVotes.userId, userId),
          eq(sentimentVotes.personId, personId),
          eq(sentimentVotes.votedDate, today)
        ))
        .limit(1);
      
      if (existingVote.length > 0) {
        // Update existing vote
        await db
          .update(sentimentVotes)
          .set({ voteType })
          .where(and(
            eq(sentimentVotes.userId, userId),
            eq(sentimentVotes.personId, personId),
            eq(sentimentVotes.votedDate, today)
          ));
        
        return res.json({ success: true, updated: true });
      }
      
      // Create new vote
      await db.insert(sentimentVotes).values({
        userId,
        personId,
        personName: personName || "Unknown",
        voteType,
        votedDate: today,
      });
      
      res.json({ success: true, created: true });
    } catch (error: any) {
      console.error("Error submitting sentiment vote:", error);
      res.status(500).json({ error: error.message || "Failed to submit vote" });
    }
  });
  
  // Get user's sentiment votes for a specific person
  app.get("/api/sentiment-votes/:personId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { personId } = req.params;
      const userId = req.userId!;
      const today = new Date().toISOString().split('T')[0];
      
      const vote = await db
        .select()
        .from(sentimentVotes)
        .where(and(
          eq(sentimentVotes.userId, userId),
          eq(sentimentVotes.personId, personId),
          eq(sentimentVotes.votedDate, today)
        ))
        .limit(1);
      
      res.json({
        hasVotedToday: vote.length > 0,
        voteType: vote[0]?.voteType || null,
      });
    } catch (error) {
      console.error("Error fetching sentiment vote:", error);
      res.status(500).json({ error: "Failed to fetch vote" });
    }
  });
  
  // Get aggregated sentiment vote counts for a person (using celebrity_metrics: seed + real)
  app.get("/api/sentiment-votes/:personId/counts", async (req, res) => {
    try {
      const { personId } = req.params;
      
      // Get combined seed + real values from celebrity_metrics
      const [metrics] = await db
        .select({
          underratedVotesCount: celebrityMetrics.underratedVotesCount,
          overratedVotesCount: celebrityMetrics.overratedVotesCount,
        })
        .from(celebrityMetrics)
        .where(eq(celebrityMetrics.celebrityId, personId))
        .limit(1);
      
      if (metrics) {
        res.json({
          overrated: metrics.overratedVotesCount || 0,
          underrated: metrics.underratedVotesCount || 0,
        });
      } else {
        // Fallback: count from raw sentimentVotes table if no metrics exist
        const overratedCount = await db
          .select({ count: count() })
          .from(sentimentVotes)
          .where(and(
            eq(sentimentVotes.personId, personId),
            eq(sentimentVotes.voteType, 'overrated')
          ));
        
        const underratedCount = await db
          .select({ count: count() })
          .from(sentimentVotes)
          .where(and(
            eq(sentimentVotes.personId, personId),
            eq(sentimentVotes.voteType, 'underrated')
          ));
        
        res.json({
          overrated: Number(overratedCount[0]?.count || 0),
          underrated: Number(underratedCount[0]?.count || 0),
        });
      }
    } catch (error) {
      console.error("Error fetching sentiment vote counts:", error);
      res.status(500).json({ error: "Failed to fetch counts" });
    }
  });

  // ============ VALUE VOTING (UNDERRATED/OVERRATED) ============
  // New unified value voting system for the Value leaderboard tab

  // Helper function to recompute celebrity metrics after a vote
  async function recomputeCelebrityMetrics(celebrityId: string) {
    try {
      // First, get current seed values from celebrity_metrics (pre-launch baseline)
      const [existingMetrics] = await db
        .select({
          seedApprovalCount: celebrityMetrics.seedApprovalCount,
          seedApprovalSum: celebrityMetrics.seedApprovalSum,
          seedUnderratedCount: celebrityMetrics.seedUnderratedCount,
          seedOverratedCount: celebrityMetrics.seedOverratedCount,
          seedFairlyRatedCount: celebrityMetrics.seedFairlyRatedCount,
        })
        .from(celebrityMetrics)
        .where(eq(celebrityMetrics.celebrityId, celebrityId))
        .limit(1);

      const seedApprovalCount = existingMetrics?.seedApprovalCount || 0;
      const seedApprovalSum = existingMetrics?.seedApprovalSum || 0;
      const seedUnderratedCount = existingMetrics?.seedUnderratedCount || 0;
      const seedOverratedCount = existingMetrics?.seedOverratedCount || 0;
      const seedFairlyRatedCount = existingMetrics?.seedFairlyRatedCount || 0;

      // Get REAL approval votes from user_votes (Supabase)
      const { data: approvalVotes, error: approvalError } = await supabaseServer
        .from('user_votes')
        .select('rating')
        .eq('person_id', celebrityId);

      let realApprovalCount = 0;
      let realApprovalSum = 0;

      if (!approvalError && approvalVotes && approvalVotes.length > 0) {
        realApprovalCount = approvalVotes.length;
        realApprovalSum = approvalVotes.reduce((acc, v) => acc + v.rating, 0);
      }

      // Calculate DISPLAY totals: seed + real
      const totalApprovalCount = seedApprovalCount + realApprovalCount;
      const totalApprovalSum = seedApprovalSum + realApprovalSum;

      let approvalVotesCount = totalApprovalCount;
      let approvalAvgRating: number | null = null;
      let approvalPct: number | null = null;

      if (totalApprovalCount > 0) {
        approvalAvgRating = totalApprovalSum / totalApprovalCount;
        // Convert 1-5 scale to 0-100%: ((avg_rating - 1) / 4) * 100
        // This maps 1 star -> 0%, 5 stars -> 100%
        approvalPct = Math.round(((approvalAvgRating - 1) / 4) * 100);
      }

      // Get REAL value votes from celebrity_value_votes (local DB)
      const underratedResult = await db
        .select({ count: count() })
        .from(celebrityValueVotes)
        .where(and(
          eq(celebrityValueVotes.celebrityId, celebrityId),
          eq(celebrityValueVotes.vote, 'underrated')
        ));

      const overratedResult = await db
        .select({ count: count() })
        .from(celebrityValueVotes)
        .where(and(
          eq(celebrityValueVotes.celebrityId, celebrityId),
          eq(celebrityValueVotes.vote, 'overrated')
        ));

      const fairlyRatedResult = await db
        .select({ count: count() })
        .from(celebrityValueVotes)
        .where(and(
          eq(celebrityValueVotes.celebrityId, celebrityId),
          eq(celebrityValueVotes.vote, 'fairly_rated')
        ));

      const realUnderratedCount = Number(underratedResult[0]?.count || 0);
      const realOverratedCount = Number(overratedResult[0]?.count || 0);
      const realFairlyRatedCount = Number(fairlyRatedResult[0]?.count || 0);

      // Calculate DISPLAY totals: seed + real
      const underratedVotesCount = seedUnderratedCount + realUnderratedCount;
      const overratedVotesCount = seedOverratedCount + realOverratedCount;
      const fairlyRatedVotesCount = seedFairlyRatedCount + realFairlyRatedCount;
      const totalValueVotes = underratedVotesCount + overratedVotesCount + fairlyRatedVotesCount;

      let underratedPct: number | null = null;
      let overratedPct: number | null = null;
      let fairlyRatedPct: number | null = null;
      let valueScore: number | null = null;

      if (totalValueVotes > 0) {
        underratedPct = Math.round((underratedVotesCount / totalValueVotes) * 100);
        overratedPct = Math.round((overratedVotesCount / totalValueVotes) * 100);
        fairlyRatedPct = Math.round((fairlyRatedVotesCount / totalValueVotes) * 100);
        valueScore = underratedPct - overratedPct; // -100 to +100
      }

      // Get current trend score from trending_people
      const [trendData] = await db
        .select({ trendScore: trendingPeople.trendScore, fameIndex: trendingPeople.fameIndex })
        .from(trendingPeople)
        .where(eq(trendingPeople.id, celebrityId))
        .limit(1);

      // Upsert celebrity_metrics (preserve seed values, update display values)
      await db
        .insert(celebrityMetrics)
        .values({
          celebrityId,
          trendScore: trendData?.trendScore || 0,
          fameIndex: trendData?.fameIndex || 0,
          seedApprovalCount,
          seedApprovalSum,
          approvalVotesCount,
          approvalAvgRating,
          approvalPct,
          seedUnderratedCount,
          seedOverratedCount,
          seedFairlyRatedCount,
          underratedVotesCount,
          overratedVotesCount,
          fairlyRatedVotesCount,
          underratedPct,
          overratedPct,
          fairlyRatedPct,
          valueScore,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: celebrityMetrics.celebrityId,
          set: {
            trendScore: trendData?.trendScore || 0,
            fameIndex: trendData?.fameIndex || 0,
            // Don't overwrite seed values - they stay fixed
            approvalVotesCount,
            approvalAvgRating,
            approvalPct,
            underratedVotesCount,
            overratedVotesCount,
            fairlyRatedVotesCount,
            underratedPct,
            overratedPct,
            fairlyRatedPct,
            valueScore,
            updatedAt: new Date(),
          },
        });

      return {
        approvalPct,
        underratedPct,
        overratedPct,
        fairlyRatedPct,
        valueScore,
      };
    } catch (error) {
      console.error("[recomputeCelebrityMetrics] Error:", error);
      throw error;
    }
  }

  // POST /api/celebrity/:id/value-vote - Cast underrated/overrated vote
  app.post("/api/celebrity/:id/value-vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      const celebrityId = req.params.id;
      const userId = req.userId!;
      const { vote } = req.body;

      if (!vote || !['underrated', 'overrated', 'fairly_rated'].includes(vote)) {
        return res.status(400).json({ error: "vote must be 'underrated', 'overrated', or 'fairly_rated'" });
      }

      // Check if celebrity exists
      const [celebrity] = await db
        .select({ id: trendingPeople.id, name: trendingPeople.name })
        .from(trendingPeople)
        .where(eq(trendingPeople.id, celebrityId))
        .limit(1);

      if (!celebrity) {
        return res.status(404).json({ error: "Celebrity not found" });
      }

      // Upsert the vote (1 vote per user per celebrity, no daily limit)
      await db
        .insert(celebrityValueVotes)
        .values({
          celebrityId,
          userId,
          vote,
        })
        .onConflictDoUpdate({
          target: [celebrityValueVotes.userId, celebrityValueVotes.celebrityId],
          set: {
            vote,
            updatedAt: new Date(),
          },
        });

      // Recompute metrics for this celebrity
      const metrics = await recomputeCelebrityMetrics(celebrityId);

      res.json({
        success: true,
        userVote: vote,
        underratedPct: metrics.underratedPct,
        overratedPct: metrics.overratedPct,
        fairlyRatedPct: metrics.fairlyRatedPct,
        valueScore: metrics.valueScore,
      });
    } catch (error: any) {
      console.error("[value-vote] Error:", error);
      res.status(500).json({ error: error.message || "Failed to submit vote" });
    }
  });

  // GET /api/celebrity/:id/value-vote - Get user's current value vote
  app.get("/api/celebrity/:id/value-vote", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const celebrityId = req.params.id;
      const userId = req.userId;

      let userVote: string | null = null;

      if (userId) {
        const [vote] = await db
          .select({ vote: celebrityValueVotes.vote })
          .from(celebrityValueVotes)
          .where(and(
            eq(celebrityValueVotes.celebrityId, celebrityId),
            eq(celebrityValueVotes.userId, userId)
          ))
          .limit(1);

        userVote = vote?.vote || null;
      }

      // Get current metrics
      const [metrics] = await db
        .select()
        .from(celebrityMetrics)
        .where(eq(celebrityMetrics.celebrityId, celebrityId))
        .limit(1);

      res.json({
        userVote,
        underratedPct: metrics?.underratedPct ?? null,
        overratedPct: metrics?.overratedPct ?? null,
        fairlyRatedPct: metrics?.fairlyRatedPct ?? null,
        valueScore: metrics?.valueScore ?? null,
        underratedVotesCount: metrics?.underratedVotesCount ?? 0,
        overratedVotesCount: metrics?.overratedVotesCount ?? 0,
        fairlyRatedVotesCount: metrics?.fairlyRatedVotesCount ?? 0,
      });
    } catch (error: any) {
      console.error("[value-vote GET] Error:", error);
      res.status(500).json({ error: error.message || "Failed to get vote" });
    }
  });

  // GET /api/celebrity/:id/sentiment-stats - Get real sentiment stats from celebrity_metrics
  app.get("/api/celebrity/:id/sentiment-stats", async (req, res) => {
    try {
      const celebrityId = req.params.id;

      // Get metrics from database
      const [metrics] = await db
        .select()
        .from(celebrityMetrics)
        .where(eq(celebrityMetrics.celebrityId, celebrityId))
        .limit(1);

      if (!metrics) {
        // Return default stats if no metrics found
        return res.json({
          totalVotes: 0,
          averageRating: 3.0,
          distribution: {
            Hate: 10,
            Dislike: 15,
            Neutral: 30,
            Like: 25,
            Love: 20,
          }
        });
      }

      const totalVotes = metrics.approvalVotesCount || 0;
      const avgRating = metrics.approvalAvgRating || 3.0;

      const hashFromId = (id: string): number => {
        let h = 0;
        for (let i = 0; i < id.length; i++) {
          h = ((h << 5) - h + id.charCodeAt(i)) | 0;
        }
        return Math.abs(h);
      };

      const seededRandom = (seed: number, index: number): number => {
        let x = Math.sin(seed * 9301 + index * 49297 + 233280) * 10000;
        return x - Math.floor(x);
      };

      const generateDistribution = (avg: number, personId: string) => {
        const seed = hashFromId(personId);
        const weights = [0, 0, 0, 0, 0];

        for (let i = 0; i < 5; i++) {
          const rating = i + 1;
          const distance = Math.abs(rating - avg);
          const base = Math.exp(-distance * 0.8);
          const jitter = (seededRandom(seed, i) - 0.5) * 0.35 * base;
          weights[i] = Math.max(base + jitter, 0.01);
        }

        const total = weights.reduce((a, b) => a + b, 0);
        const normalized = weights.map(w => Math.round((w / total) * 100));

        const sum = normalized.reduce((a, b) => a + b, 0);
        if (sum !== 100) {
          const maxIdx = normalized.indexOf(Math.max(...normalized));
          normalized[maxIdx] += (100 - sum);
        }

        return {
          Hate: normalized[0],
          Dislike: normalized[1],
          Neutral: normalized[2],
          Like: normalized[3],
          Love: normalized[4],
        };
      };

      res.json({
        totalVotes,
        averageRating: parseFloat(avgRating.toFixed(1)),
        distribution: generateDistribution(avgRating, celebrityId)
      });
    } catch (error: any) {
      console.error("[sentiment-stats GET] Error:", error);
      res.status(500).json({ error: error.message || "Failed to get sentiment stats" });
    }
  });

  // GET /api/source-health - Get current data source health status for UI banner
  app.get("/api/source-health", async (req, res) => {
    try {
      const health = getCurrentHealthSnapshot();
      const hasDegradedSources = hasAnyDegradedSource();
      
      // Calculate staleness for each source
      const now = new Date();
      const getStaleMinutes = (lastHealthy: Date | null): number | null => {
        if (!lastHealthy) return null;
        return Math.round((now.getTime() - lastHealthy.getTime()) / (1000 * 60));
      };
      
      res.json({
        hasDegradedSources,
        summary: getHealthSummary(),
        sources: {
          news: {
            state: health.news.state,
            reason: health.news.reason,
            staleMinutes: getStaleMinutes(health.news.lastHealthyTimestamp),
            isHealthy: health.news.state === "HEALTHY",
          },
          search: {
            state: health.search.state,
            reason: health.search.reason,
            staleMinutes: getStaleMinutes(health.search.lastHealthyTimestamp),
            isHealthy: health.search.state === "HEALTHY",
          },
          wiki: {
            state: health.wiki.state,
            reason: health.wiki.reason,
            staleMinutes: getStaleMinutes(health.wiki.lastHealthyTimestamp),
            isHealthy: health.wiki.state === "HEALTHY",
          },
        },
      });
    } catch (error: any) {
      console.error("[source-health GET] Error:", error);
      res.status(500).json({ error: error.message || "Failed to get source health" });
    }
  });

  // --- Shared: get fallback people from latest completed run snapshots ---
  async function getSnapshotFallbackPeople(): Promise<Array<{
    id: string;
    name: string;
    avatar: string | null;
    bio: string | null;
    category: string | null;
    rank: number;
    trendScore: number | null;
    fameIndex: number | null;
    change24h: number | null;
    change7d: number | null;
  }> | null> {
    try {
      const latestRun = await db
        .select({ id: ingestionRuns.id, startedAt: ingestionRuns.startedAt })
        .from(ingestionRuns)
        .where(and(
          eq(ingestionRuns.status, "completed"),
          eq(ingestionRuns.scoreVersion, SCORE_VERSION),
        ))
        .orderBy(desc(ingestionRuns.startedAt))
        .limit(1);

      if (latestRun.length === 0) return null;

      const fallbackRunId = latestRun[0].id;

      const snapshotRows = await db.execute(sql`
        SELECT 
          ts.person_id,
          ts.fame_index,
          ts.trend_score,
          tp.name,
          tp.avatar,
          tp.category,
          tp.bio
        FROM trend_snapshots ts
        JOIN tracked_people tp ON tp.id = ts.person_id
        WHERE ts.run_id = ${fallbackRunId}
          AND ts.score_version = ${SCORE_VERSION}
        ORDER BY ts.fame_index DESC NULLS LAST
      `);

      const rows = Array.isArray(snapshotRows) ? snapshotRows : (snapshotRows as any).rows ?? [];
      if (rows.length === 0) return null;

      return (rows as any[]).map((row: any, idx: number) => ({
        id: row.person_id,
        name: row.name,
        avatar: row.avatar,
        bio: row.bio,
        category: row.category,
        rank: idx + 1,
        trendScore: row.trend_score,
        fameIndex: row.fame_index,
        change24h: null,
        change7d: null,
      }));
    } catch (err) {
      console.error("[fallback] Snapshot fallback people error:", err);
      return null;
    }
  }

  // --- Snapshot-based fallback for empty trending_people ---
  async function buildSnapshotFallbackLeaderboard(
    tab: string,
    search: string | undefined,
    category: string | undefined,
    limit: number,
    offset: number,
    sortDir: string
  ) {
    try {
      const latestRun = await db
        .select({ id: ingestionRuns.id, startedAt: ingestionRuns.startedAt, scoreVersion: ingestionRuns.scoreVersion })
        .from(ingestionRuns)
        .where(and(
          eq(ingestionRuns.status, "completed"),
          eq(ingestionRuns.scoreVersion, SCORE_VERSION),
        ))
        .orderBy(desc(ingestionRuns.startedAt))
        .limit(1);

      if (latestRun.length === 0) return null;

      const fallbackRunId = latestRun[0].id;
      const fallbackRunAt = latestRun[0].startedAt;

      const snapshotRows = await db.execute(sql`
        SELECT 
          ts.person_id,
          ts.fame_index,
          ts.trend_score,
          ts.mass_score,
          ts.velocity_score,
          ts.momentum,
          tp.name,
          tp.avatar,
          tp.category,
          tp.bio
        FROM trend_snapshots ts
        JOIN tracked_people tp ON tp.id = ts.person_id
        WHERE ts.run_id = ${fallbackRunId}
          AND ts.score_version = ${SCORE_VERSION}
        ORDER BY ts.fame_index DESC NULLS LAST
      `);

      const rows = Array.isArray(snapshotRows) ? snapshotRows : (snapshotRows as any).rows ?? [];
      if (rows.length === 0) return null;

      let filtered = rows as any[];
      if (category && category !== "all") {
        filtered = filtered.filter((r: any) => r.category === category);
      }
      if (search && search.trim()) {
        const term = search.trim().toLowerCase();
        filtered = filtered.filter((r: any) => r.name?.toLowerCase().includes(term));
      }

      if (sortDir === "asc") {
        filtered.sort((a: any, b: any) => (a.fame_index ?? 0) - (b.fame_index ?? 0));
      }

      const totalCount = filtered.length;
      const paged = filtered.slice(offset, offset + limit);

      const data = paged.map((row: any, idx: number) => ({
        id: row.person_id,
        name: row.name,
        avatar: row.avatar,
        category: row.category,
        rank: offset + idx + 1,
        trendScore: row.trend_score,
        fameIndex: row.fame_index,
        change24h: null,
        change7d: null,
        liveRank: null,
        fameIndexLive: null,
        liveUpdatedAt: null,
        approvalPct: null,
        approvalVotesCount: null,
        underratedPct: null,
        overratedPct: null,
        fairlyRatedPct: null,
        valueScore: null,
        leaderboardRank: sortDir === 'asc' ? totalCount - offset - idx : offset + idx + 1,
        userValueVote: null,
        rankChange: 0,
      }));

      return {
        tab,
        sortDir,
        total: data.length,
        totalCount,
        data,
        thresholds: { rankChangeP90: 999, deltaP90: 999, negRankChangeP10: -999, negDeltaP10: -999 },
        baselineStatus: "fallback",
        meta: {
          currentRunId: null,
          baseline24hRunId: null,
          baseline24hAgeHours: null,
          baselineStatus: "fallback",
          coveragePct: 0,
          scoreVersion: SCORE_VERSION,
          fallbackUsed: true,
          fallbackRunId,
          fallbackRunAt: fallbackRunAt?.toISOString() ?? null,
        },
      };
    } catch (err) {
      console.error("[leaderboard] Snapshot fallback error:", err);
      return null;
    }
  }

  // GET /api/leaderboard - Enhanced leaderboard with tab support
  app.get("/api/leaderboard", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const tab = (req.query.tab as string) || 'fame'; // 'fame' | 'approval' | 'value'
      const sortDir = (req.query.sortDir as string) || (req.query.sort as string) || 'desc'; // 'asc' | 'desc'
      const category = req.query.category as string;
      const search = req.query.search as string;
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const userId = req.userId;

      // Build conditions array
      const conditions: SQL<unknown>[] = [];
      
      if (category && category !== 'all') {
        conditions.push(eq(trendingPeople.category, category));
      }
      
      if (search && search.trim()) {
        const searchTerm = `%${search.trim().toLowerCase()}%`;
        conditions.push(sql`LOWER(${trendingPeople.name}) LIKE ${searchTerm}`);
      }

      let countQuery = db
        .select({ count: sql<number>`COUNT(*)` })
        .from(trendingPeople);
      
      if (conditions.length > 0) {
        countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
      }
      
      const [countResult] = await countQuery;
      const totalCount = Number(countResult?.count) || 0;

      // --- SNAPSHOT FALLBACK: If trending_people is empty, reconstruct from latest completed run ---
      if (totalCount === 0) {
        console.log("[leaderboard] trending_people is empty, attempting snapshot fallback...");
        const fallbackResult = await buildSnapshotFallbackLeaderboard(tab, search, category, limit, offset, sortDir);
        if (fallbackResult) {
          console.log(`[leaderboard] Snapshot fallback serving ${fallbackResult.data.length} people from run ${fallbackResult.meta.fallbackRunId}`);
          return res.json(fallbackResult);
        }
        console.log("[leaderboard] No snapshot fallback available either");
      }

      let query = db
        .select({
          id: trendingPeople.id,
          name: trendingPeople.name,
          avatar: trendingPeople.avatar,
          category: trendingPeople.category,
          rank: trendingPeople.rank,
          trendScore: trendingPeople.trendScore,
          fameIndex: trendingPeople.fameIndex,
          change24h: trendingPeople.change24h,
          change7d: trendingPeople.change7d,
          liveRank: trendingPeople.liveRank,
          fameIndexLive: trendingPeople.fameIndexLive,
          liveUpdatedAt: trendingPeople.liveUpdatedAt,
          imageSlug: trackedPeople.imageSlug,
          approvalPct: celebrityMetrics.approvalPct,
          approvalAvgRating: celebrityMetrics.approvalAvgRating,
          approvalVotesCount: celebrityMetrics.approvalVotesCount,
          underratedPct: celebrityMetrics.underratedPct,
          overratedPct: celebrityMetrics.overratedPct,
          fairlyRatedPct: celebrityMetrics.fairlyRatedPct,
          valueScore: celebrityMetrics.valueScore,
        })
        .from(trendingPeople)
        .leftJoin(trackedPeople, eq(trendingPeople.id, trackedPeople.id))
        .leftJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId));

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      if (tab === 'approval') {
        if (sortDir === 'asc') {
          query = query.orderBy(sql`${celebrityMetrics.approvalAvgRating} ASC NULLS LAST, ${celebrityMetrics.approvalVotesCount} ASC NULLS LAST, ${trendingPeople.name} ASC`) as typeof query;
        } else {
          query = query.orderBy(sql`${celebrityMetrics.approvalAvgRating} DESC NULLS LAST, ${celebrityMetrics.approvalVotesCount} DESC NULLS LAST, ${trendingPeople.name} ASC`) as typeof query;
        }
      } else {
        let orderByColumn: any;
        switch (tab) {
          case 'value':
            orderByColumn = celebrityMetrics.valueScore;
            break;
          case 'fame':
          default:
            orderByColumn = sql`COALESCE(${trendingPeople.fameIndexLive}, ${trendingPeople.fameIndex})`;
            break;
        }

        if (sortDir === 'asc') {
          query = query.orderBy(sql`${orderByColumn} ASC NULLS LAST, ${trendingPeople.name} ASC`) as typeof query;
        } else {
          query = query.orderBy(sql`${orderByColumn} DESC NULLS LAST, ${trendingPeople.name} ASC`) as typeof query;
        }
      }

      query = query.limit(limit).offset(offset) as typeof query;

      const results = await query;

      let userValueVotes: Record<string, string> = {};
      if (userId && tab === 'value') {
        const votes = await db
          .select({ celebrityId: celebrityValueVotes.celebrityId, vote: celebrityValueVotes.vote })
          .from(celebrityValueVotes)
          .where(eq(celebrityValueVotes.userId, userId));

        for (const v of votes) {
          userValueVotes[v.celebrityId] = v.vote;
        }
      }

      const prevRankLookup = await getSnapshotRankMap();
      const baselineStatus = prevRankLookup.size > 0 ? "normal" : "degraded";

      const allPeopleForThresholds = await db
        .select({
          id: trendingPeople.id,
          rank: trendingPeople.rank,
          change24h: trendingPeople.change24h,
        })
        .from(trendingPeople);

      const allRankChanges = allPeopleForThresholds
        .map(p => (prevRankLookup.get(p.id) ?? p.rank) - p.rank)
        .filter(v => v !== 0);
      const allDeltas = allPeopleForThresholds
        .map(p => p.change24h)
        .filter((v): v is number => v != null && v !== 0);

      const positiveRC = allRankChanges.filter(v => v > 0).sort((a, b) => b - a);
      const positiveDeltas = allDeltas.filter(v => v > 0).sort((a, b) => b - a);
      const negativeRC = allRankChanges.filter(v => v < 0).sort((a, b) => a - b);
      const negativeDeltas = allDeltas.filter(v => v < 0).sort((a, b) => a - b);

      const p5Idx = (arr: number[]) => Math.max(0, Math.ceil(arr.length * 0.05) - 1);
      const p10Idx = (arr: number[]) => Math.max(0, Math.ceil(arr.length * 0.10) - 1);

      const canonicalThresholds = {
        rankChangeP90: positiveRC.length > 0 ? positiveRC[p5Idx(positiveRC)] : 999,
        deltaP90: positiveDeltas.length > 0 ? positiveDeltas[p5Idx(positiveDeltas)] : 999,
        negRankChangeP10: negativeRC.length > 0 ? negativeRC[p10Idx(negativeRC)] : -999,
        negDeltaP10: negativeDeltas.length > 0 ? negativeDeltas[p10Idx(negativeDeltas)] : -999,
      };

      const leaderboard = results.map((person, index) => {
        const prevRank = prevRankLookup.get(person.id) ?? person.rank;
        return {
          ...person,
          leaderboardRank: sortDir === 'asc' ? totalCount - offset - index : offset + index + 1,
          userValueVote: userValueVotes[person.id] || null,
          rankChange: prevRank - person.rank,
        };
      });

      const baselineMeta = await getBaselineDiagnostics(totalCount);
      const baselineDegraded = baselineMeta.baseline24hStatus !== "normal";
      const safeLeaderboard = baselineDegraded
        ? leaderboard.map(p => ({ ...p, change24h: null, change7d: null }))
        : leaderboard;

      res.json({
        tab,
        sortDir,
        total: safeLeaderboard.length,
        totalCount,
        data: safeLeaderboard,
        thresholds: canonicalThresholds,
        baselineStatus: baselineMeta.baseline24hStatus,
        meta: {
          currentRunId: baselineMeta.currentRunId,
          baseline24hRunId: baselineMeta.baseline24hRunId,
          baseline24hAgeHours: baselineMeta.baseline24hAgeHours,
          baselineStatus: baselineMeta.baseline24hStatus,
          coveragePct: baselineMeta.baseline24hCoveragePct,
          scoreVersion: baselineMeta.scoreVersion,
          fallbackUsed: false,
          fallbackRunId: null,
        },
      });
    } catch (error: any) {
      console.error("[leaderboard] Error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch leaderboard" });
    }
  });

  // POST /api/celebrity-metrics/sync - Sync all celebrity metrics (admin)
  app.post("/api/celebrity-metrics/sync", async (req, res) => {
    try {
      // Get all celebrities from trending_people
      const celebrities = await db.select({ id: trendingPeople.id }).from(trendingPeople);
      
      let synced = 0;
      for (const celebrity of celebrities) {
        await recomputeCelebrityMetrics(celebrity.id);
        synced++;
      }

      res.json({ success: true, synced });
    } catch (error: any) {
      console.error("[celebrity-metrics/sync] Error:", error);
      res.status(500).json({ error: error.message || "Failed to sync metrics" });
    }
  });

  // ===== INSIGHT COMMENTS API =====
  
  // Get all comments for an insight (with nested structure)
  app.get("/api/insight-comments/:insightId", async (req, res) => {
    try {
      const { insightId } = req.params;
      
      // Fetch all comments for this insight
      const comments = await db
        .select()
        .from(insightComments)
        .where(eq(insightComments.insightId, insightId))
        .orderBy(desc(insightComments.createdAt));

      // Fetch vote counts for all comments
      const commentIds = comments.map(c => c.id);
      
      let voteCounts: Record<string, { upvotes: number; downvotes: number }> = {};
      
      if (commentIds.length > 0) {
        const upvoteCounts = await db
          .select({ 
            commentId: commentVotes.commentId, 
            count: count() 
          })
          .from(commentVotes)
          .where(and(
            sql`${commentVotes.commentId} IN ${commentIds}`,
            eq(commentVotes.voteType, 'up')
          ))
          .groupBy(commentVotes.commentId);
          
        const downvoteCounts = await db
          .select({ 
            commentId: commentVotes.commentId, 
            count: count() 
          })
          .from(commentVotes)
          .where(and(
            sql`${commentVotes.commentId} IN ${commentIds}`,
            eq(commentVotes.voteType, 'down')
          ))
          .groupBy(commentVotes.commentId);
          
        // Build vote counts map
        for (const id of commentIds) {
          const up = upvoteCounts.find(v => v.commentId === id);
          const down = downvoteCounts.find(v => v.commentId === id);
          voteCounts[id] = {
            upvotes: up ? Number(up.count) : 0,
            downvotes: down ? Number(down.count) : 0,
          };
        }
      }

      // Add vote counts to comments
      const commentsWithVotes = comments.map(comment => ({
        ...comment,
        upvotes: voteCounts[comment.id]?.upvotes || 0,
        downvotes: voteCounts[comment.id]?.downvotes || 0,
      }));

      res.json(commentsWithVotes);
    } catch (error: any) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ error: error.message || "Failed to fetch comments" });
    }
  });

  // Create a new comment (protected route)
  app.post("/api/insight-comments", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { insightId, parentId, username, content } = req.body;
      
      // Validate required fields
      if (!insightId || !content) {
        return res.status(400).json({ error: "insightId and content are required" });
      }

      // Create the comment
      const [newComment] = await db
        .insert(insightComments)
        .values({
          insightId,
          parentId: parentId || null,
          userId,
          username: username || userId.substring(0, 8),
          content,
        })
        .returning();

      res.status(201).json({
        ...newComment,
        upvotes: 0,
        downvotes: 0,
      });
    } catch (error: any) {
      console.error("Error creating comment:", error);
      res.status(500).json({ error: error.message || "Failed to create comment" });
    }
  });

  // Vote on a comment (protected route)
  app.post("/api/insight-comments/:id/vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { voteType } = req.body;
      const userId = req.userId!;

      if (!voteType || !['up', 'down'].includes(voteType)) {
        return res.status(400).json({ error: "voteType must be 'up' or 'down'" });
      }

      // Check if user already voted
      const existingVote = await db
        .select()
        .from(commentVotes)
        .where(and(
          eq(commentVotes.commentId, id),
          eq(commentVotes.userId, userId)
        ))
        .limit(1);

      if (existingVote.length > 0) {
        if (existingVote[0].voteType === voteType) {
          // Same vote - remove it (toggle off)
          await db
            .delete(commentVotes)
            .where(and(
              eq(commentVotes.commentId, id),
              eq(commentVotes.userId, userId)
            ));
        } else {
          // Different vote - update it
          await db
            .update(commentVotes)
            .set({ voteType })
            .where(and(
              eq(commentVotes.commentId, id),
              eq(commentVotes.userId, userId)
            ));
        }
      } else {
        // Create new vote
        await db
          .insert(commentVotes)
          .values({
            commentId: id,
            userId,
            voteType,
          });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error voting on comment:", error);
      res.status(500).json({ error: error.message || "Failed to vote" });
    }
  });

  // Get user's vote status for comments (protected route)
  app.get("/api/insight-comments/:insightId/votes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { insightId } = req.params;
      const userId = req.userId!;
      
      // Get all comments for this insight
      const insightCommentsData = await db
        .select({ id: insightComments.id })
        .from(insightComments)
        .where(eq(insightComments.insightId, insightId));

      const commentIds = insightCommentsData.map(c => c.id);

      if (commentIds.length === 0) {
        return res.json({});
      }

      // Get user's votes for these comments
      const votes = await db
        .select()
        .from(commentVotes)
        .where(and(
          eq(commentVotes.userId, userId),
          sql`${commentVotes.commentId} IN ${commentIds}`
        ));

      // Convert to map: commentId -> voteType
      const voteMap = votes.reduce((acc, vote) => {
        acc[vote.commentId] = vote.voteType;
        return acc;
      }, {} as Record<string, string>);

      res.json(voteMap);
    } catch (error) {
      console.error("Error fetching user comment votes:", error);
      res.status(500).json({ error: "Failed to fetch user votes" });
    }
  });

  // Get AI-generated celebrity profile with 7-day caching and web search grounding
  app.get("/api/celebrity-profile/:personId", async (req, res) => {
    try {
      const { personId } = req.params;
      const forceRefresh = req.query.refresh === 'true';
      const CACHE_DURATION_DAYS = 7; // Reduced from 30 to 7 days
      
      // Check cache first (unless force refresh)
      const cached = await storage.getCelebrityProfile(personId);
      if (cached && !forceRefresh) {
        // Check if cache is still fresh (within 7 days)
        const cacheAge = Date.now() - new Date(cached.generatedAt).getTime();
        const cacheDuration = CACHE_DURATION_DAYS * 24 * 60 * 60 * 1000;
        
        if (cacheAge < cacheDuration) {
          return res.json(cached);
        }
        // Cache is stale, will regenerate below
      }
      
      // Get person name from storage
      const person = await storage.getTrendingPerson(personId);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }
      
      // Fetch web search context for grounding (current news/info about the person)
      console.log(`[Profile] Fetching web search context for ${person.name}...`);
      const [webContext, netWorthContext] = await Promise.all([
        fetchWebSearchContext(person.name),
        fetchNetWorthContext(person.name),
      ]);
      
      // Initialize OpenAI with Replit AI Integrations
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });
      
      // Build context from web search
      let webContextSection = "";
      if (webContext && (webContext.headlines.length > 0 || webContext.snippets.length > 0)) {
        webContextSection = `
CURRENT WEB SEARCH RESULTS (use this for up-to-date information):
Recent Headlines:
${webContext.headlines.slice(0, 5).map(h => `- ${h}`).join('\n')}

Recent Information Snippets:
${webContext.snippets.slice(0, 5).map(s => `- ${s}`).join('\n')}

`;
      }
      
      // Build net worth context section
      let netWorthSection = "";
      if (netWorthContext && netWorthContext.sources.length > 0) {
        netWorthSection = `
NET WORTH SEARCH RESULTS (use the MOST RECENT authoritative source for accurate net worth):
${netWorthContext.sources.map(s => `- "${s.title}": ${s.snippet}`).join('\n')}

IMPORTANT: Prefer Forbes, Bloomberg, or Celebrity Net Worth sources for net worth estimates. Use the most recent figure available.
${netWorthContext.estimate ? `Quick extract found: ${netWorthContext.estimate} (verify against sources above)` : ''}

`;
      }
      
      // Generate comprehensive profile using AI with web grounding
      const currentYear = new Date().getFullYear();
      const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
      const prompt = `You are a celebrity data expert. Generate accurate, factual information about ${person.name}.

${webContextSection}${netWorthSection}CRITICAL INSTRUCTIONS:
1. Today is ${currentDate}. Use your most current knowledge.
2. This person's data will be cached for 7 days, so accuracy is essential.
3. If this person is a politician, CEO, or public figure, state their CURRENT title/position as of ${currentYear}.
4. POLITICAL FIGURES - USE CURRENT FACTS:
   - Donald Trump: Inaugurated as 47th U.S. President on January 20, 2025 (second term)
   - JD Vance: Current U.S. Vice President (since January 20, 2025)
   - Joe Biden: Former President (term ended January 20, 2025)
   - Kamala Harris: Former Vice President (term ended January 20, 2025)
   - Karoline Leavitt: 36th White House Press Secretary (since January 2025, youngest ever at 27)
   - David Sacks: White House Special Advisor for AI and Crypto (appointed January 2025, "AI and Crypto Czar")
5. For politicians: If they are currently serving in office, this MUST be stated clearly with their current title.
6. For business leaders: State their current company and role.
7. If someone was recently elected or appointed to a new role, mention this prominently.
8. IMPORTANT: DO NOT mention net worth, wealth, or financial figures in shortBio or longBio. Net worth goes ONLY in the estimatedNetWorth field.

NET WORTH REFERENCE DATA (January 2026 - use these as anchors for estimation):
- Elon Musk: ~$700 billion (first to cross $700B, owns Tesla, SpaceX at $800B valuation, xAI)
- Jeff Bezos: ~$240 billion
- Mark Zuckerberg: ~$230 billion
- Larry Ellison: ~$220 billion
- Bernard Arnault: ~$200 billion
- Bill Gates: ~$160 billion
- Warren Buffett: ~$145 billion
- Larry Page: ~$165 billion
- Sergey Brin: ~$155 billion
- Jensen Huang: ~$130 billion (NVIDIA CEO)
- Shayne Coplan: ~$1 billion (Polymarket founder, youngest self-made billionaire Oct 2025)
- Taylor Swift: ~$1.6 billion
- Rihanna: ~$1.4 billion
- Kim Kardashian: ~$1.7 billion
- Kylie Jenner: ~$700 million
- Drake: ~$300 million
- LeBron James: ~$1.2 billion
- Cristiano Ronaldo: ~$600 million
Use these as reference points to estimate other individuals' net worth relative to their success/wealth tier.

Return a JSON object with exactly these fields:
{
  "shortBio": "A concise 2-3 sentence summary emphasizing their CURRENT primary role and achievements. DO NOT mention net worth here. (150-200 characters)",
  "longBio": "A comprehensive 4-6 sentence biography covering their current position, career highlights, and achievements. DO NOT mention net worth or wealth here. (400-600 characters)",
  "knownFor": "Their primary areas of expertise or fame, comma-separated (e.g., 'Tech entrepreneurship, SpaceX, Tesla, X/Twitter')",
  "fromCountry": "Their country of origin (full name, e.g., 'South Africa')",
  "fromCountryCode": "ISO 3166-1 alpha-2 code (e.g., 'ZA')",
  "basedIn": "Where they currently live or work (full name, e.g., 'United States')", 
  "basedInCountryCode": "ISO 3166-1 alpha-2 code (e.g., 'US')",
  "estimatedNetWorth": "Provide a rough estimate in format like '$700 billion' or '$450 million'. For billionaires, estimate to nearest $1-10B depending on wealth tier. For millionaires, estimate to nearest $50M. Use the reference data above as anchors. Never say 'not available' or 'unknown'."
}

Be factual, accurate, and emphasize their current status. Only return the JSON object, nothing else.`;

      // Using gpt-4o for accurate and current knowledge with web grounding
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 1000,
      });
      
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response from AI");
      }
      
      const parsed = JSON.parse(content);
      
      const profileData: InsertCelebrityProfile = {
        personId,
        personName: person.name,
        shortBio: parsed.shortBio || "No biography available",
        longBio: parsed.longBio || null,
        knownFor: parsed.knownFor || "Various achievements",
        fromCountry: parsed.fromCountry || "Unknown",
        fromCountryCode: parsed.fromCountryCode?.toUpperCase() || "XX",
        basedIn: parsed.basedIn || "Unknown",
        basedInCountryCode: parsed.basedInCountryCode?.toUpperCase() || "XX",
        estimatedNetWorth: parsed.estimatedNetWorth || "Not available",
        generatedAt: new Date(),
      };
      
      // Cache the result (update if exists, insert if new)
      let profile: CelebrityProfile;
      if (cached) {
        profile = await storage.updateCelebrityProfile(personId, profileData) as CelebrityProfile;
      } else {
        profile = await storage.setCelebrityProfile(profileData);
      }
      
      console.log(`[Profile] Generated profile for ${person.name} using gpt-4o with web grounding`);
      res.json(profile);
    } catch (error: any) {
      console.error("Error generating celebrity profile:", error);
      res.status(500).json({ error: "Failed to generate profile", message: error.message });
    }
  });

  // Admin endpoint to refresh all celebrity profiles with new model and web grounding
  app.post("/api/admin/refresh-all-profiles", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      
      // Check admin role (set in auth middleware)
      if (authReq.userRole !== 'admin') {
        return res.status(403).json({ error: "Admin access required" });
      }
      
      // Get all tracked people
      const people = await db.select().from(trackedPeople);
      console.log(`[Admin] Starting profile refresh for ${people.length} celebrities...`);
      
      // Process in batches to avoid rate limits
      const BATCH_SIZE = 5;
      const DELAY_MS = 2000;
      let successCount = 0;
      let errorCount = 0;
      
      for (let i = 0; i < people.length; i += BATCH_SIZE) {
        const batch = people.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (person) => {
          try {
            // Fetch web search context and net worth in parallel
            const [webContext, netWorthContext] = await Promise.all([
              fetchWebSearchContext(person.name),
              fetchNetWorthContext(person.name),
            ]);
            
            // Initialize OpenAI
            const openai = new OpenAI({
              apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
              baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
            });
            
            // Build context from web search
            let webContextSection = "";
            if (webContext && (webContext.headlines.length > 0 || webContext.snippets.length > 0)) {
              webContextSection = `
CURRENT WEB SEARCH RESULTS (use this for up-to-date information):
Recent Headlines:
${webContext.headlines.slice(0, 5).map(h => `- ${h}`).join('\n')}

Recent Information Snippets:
${webContext.snippets.slice(0, 5).map(s => `- ${s}`).join('\n')}

`;
            }
            
            // Build net worth context section
            let netWorthSection = "";
            if (netWorthContext && netWorthContext.sources.length > 0) {
              netWorthSection = `
NET WORTH SEARCH RESULTS (use the MOST RECENT authoritative source for accurate net worth):
${netWorthContext.sources.map(s => `- "${s.title}": ${s.snippet}`).join('\n')}

IMPORTANT: Prefer Forbes, Bloomberg, or Celebrity Net Worth sources. Use the MOST RECENT figure available.
${netWorthContext.estimate ? `Quick extract found: ${netWorthContext.estimate} (verify against sources above)` : ''}

`;
            }
            
            const currentYear = new Date().getFullYear();
            const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
            const prompt = `You are a celebrity data expert. Generate accurate, factual information about ${person.name}.

${webContextSection}${netWorthSection}CRITICAL INSTRUCTIONS:
1. Today is ${currentDate}. Use your most current knowledge.
2. This person's data will be cached for 7 days, so accuracy is essential.
3. If this person is a politician, CEO, or public figure, state their CURRENT title/position as of ${currentYear}.
4. POLITICAL FIGURES - USE CURRENT FACTS:
   - Donald Trump: Inaugurated as 47th U.S. President on January 20, 2025 (second term)
   - JD Vance: Current U.S. Vice President (since January 20, 2025)
   - Joe Biden: Former President (term ended January 20, 2025)
   - Kamala Harris: Former Vice President (term ended January 20, 2025)
   - Karoline Leavitt: 36th White House Press Secretary (since January 2025, youngest ever at 27)
   - David Sacks: White House Special Advisor for AI and Crypto (appointed January 2025, "AI and Crypto Czar")
5. For politicians: If they are currently serving in office, this MUST be stated clearly with their current title.
6. For business leaders: State their current company and role.
7. If someone was recently elected or appointed to a new role, mention this prominently.
8. IMPORTANT: DO NOT mention net worth, wealth, or financial figures in shortBio or longBio. Net worth goes ONLY in the estimatedNetWorth field.

NET WORTH REFERENCE DATA (January 2026 - use these as anchors for estimation):
- Elon Musk: ~$700 billion (first to cross $700B, owns Tesla, SpaceX at $800B valuation, xAI)
- Jeff Bezos: ~$240 billion
- Mark Zuckerberg: ~$230 billion
- Larry Ellison: ~$220 billion
- Bernard Arnault: ~$200 billion
- Bill Gates: ~$160 billion
- Warren Buffett: ~$145 billion
- Larry Page: ~$165 billion
- Sergey Brin: ~$155 billion
- Jensen Huang: ~$130 billion (NVIDIA CEO)
- Shayne Coplan: ~$1 billion (Polymarket founder, youngest self-made billionaire Oct 2025)
- Taylor Swift: ~$1.6 billion
- Rihanna: ~$1.4 billion
- Kim Kardashian: ~$1.7 billion
- Kylie Jenner: ~$700 million
- Drake: ~$300 million
- LeBron James: ~$1.2 billion
- Cristiano Ronaldo: ~$600 million
Use these as reference points to estimate other individuals' net worth relative to their success/wealth tier.

Return a JSON object with exactly these fields:
{
  "shortBio": "A concise 2-3 sentence summary emphasizing their CURRENT primary role and achievements. DO NOT mention net worth here. (150-200 characters)",
  "longBio": "A comprehensive 4-6 sentence biography covering their current position, career highlights, and achievements. DO NOT mention net worth or wealth here. (400-600 characters)",
  "knownFor": "Their primary areas of expertise or fame, comma-separated",
  "fromCountry": "Their country of origin (full name)",
  "fromCountryCode": "ISO 3166-1 alpha-2 code",
  "basedIn": "Where they currently live or work (full name)", 
  "basedInCountryCode": "ISO 3166-1 alpha-2 code",
  "estimatedNetWorth": "Provide a rough estimate in format like '$700 billion' or '$450 million'. For billionaires, estimate to nearest $1-10B depending on wealth tier. For millionaires, estimate to nearest $50M. Use the reference data above as anchors. Never say 'not available' or 'unknown'."
}

Be factual, accurate, and emphasize their current status. Only return the JSON object, nothing else.`;

            const response = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: [{ role: "user", content: prompt }],
              response_format: { type: "json_object" },
              max_tokens: 1000,
            });
            
            const content = response.choices[0]?.message?.content;
            if (!content) throw new Error("No response from AI");
            
            const parsed = JSON.parse(content);
            
            const profileData: InsertCelebrityProfile = {
              personId: person.id,
              personName: person.name,
              shortBio: parsed.shortBio || "No biography available",
              longBio: parsed.longBio || null,
              knownFor: parsed.knownFor || "Various achievements",
              fromCountry: parsed.fromCountry || "Unknown",
              fromCountryCode: parsed.fromCountryCode?.toUpperCase() || "XX",
              basedIn: parsed.basedIn || "Unknown",
              basedInCountryCode: parsed.basedInCountryCode?.toUpperCase() || "XX",
              estimatedNetWorth: parsed.estimatedNetWorth || "Not available",
              generatedAt: new Date(),
            };
            
            // Check if profile exists
            const existing = await storage.getCelebrityProfile(person.id);
            if (existing) {
              await storage.updateCelebrityProfile(person.id, profileData);
            } else {
              await storage.setCelebrityProfile(profileData);
            }
            
            successCount++;
            console.log(`[Admin] Refreshed profile for ${person.name} (${successCount}/${people.length})`);
          } catch (err: any) {
            errorCount++;
            console.error(`[Admin] Failed to refresh profile for ${person.name}:`, err.message);
          }
        }));
        
        // Wait between batches to avoid rate limits
        if (i + BATCH_SIZE < people.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }
      
      // Log admin action
      await db.insert(adminAuditLog).values({
        adminId: authReq.userId || 'unknown',
        actionType: 'refresh_all_profiles',
        targetTable: 'celebrity_profiles',
        targetId: 'all',
        metadata: { successCount, errorCount, total: people.length },
      });
      
      res.json({ 
        success: true, 
        message: `Refreshed ${successCount} profiles, ${errorCount} errors`,
        successCount,
        errorCount,
        total: people.length
      });
    } catch (error: any) {
      console.error("Error refreshing all profiles:", error);
      res.status(500).json({ error: "Failed to refresh profiles", message: error.message });
    }
  });

  // ============ WHY TRENDING - AI-Generated Summary ============
  // Improvements (Feb 2026):
  //   A) Top-10 hysteresis: sticky eligibility (enter <=10, exit >=12 or 2 consecutive checks outside)
  //   B) Input hash: skip OpenAI call if headlines unchanged, just extend TTL
  //   C) Provenance: store model, promptVersion, headlinesUsed in cached payload
  //   D) Rate limit: max 1 OpenAI generation per person per 30 minutes

  const WHY_TRENDING_PROMPT_VERSION = 4;
  const WHY_TRENDING_CACHE_TTL_HOURS = 6;
  const WHY_TRENDING_RATE_LIMIT_MINUTES = 30;

  function extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url.slice(0, 30);
    }
  }

  function normalizeTitle(title: string): string {
    let t = title;
    t = t.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
    t = t.replace(/\s*[-–—|]\s*(CNN|Reuters|AP|BBC|NBC|CBS|ABC|Fox News|CNBC|Bloomberg|Forbes|WSJ|The Guardian|The New York Times|Associated Press|NPR|USA Today|The Washington Post|Sky News|Al Jazeera|MSNBC|The Hill|Politico|TechCrunch|The Verge|Variety|TMZ|E! News|People|Entertainment Weekly|ESPN|Daily Mail|NY Post|New York Post|Axios|Business Insider|The Independent)\.?$/i, "");
    t = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    return t;
  }

  function computeHeadlineHash(sources: Array<{ title: string; link?: string }>): string {
    const stableIds = sources.map(s => {
      const domain = s.link ? extractDomain(s.link) : "unknown";
      return `${domain}|${normalizeTitle(s.title)}`;
    });
    return createHash("sha256").update(stableIds.sort().join("||")).digest("hex").slice(0, 16);
  }

  async function getTop10Eligibility(personId: string): Promise<{ eligible: boolean; lastRankSeen: number; consecutiveOutside: number }> {
    const eligibilityCacheKey = `top10_eligible:${personId}`;
    const [row] = await db.select().from(apiCache).where(eq(apiCache.cacheKey, eligibilityCacheKey)).limit(1);
    if (row) {
      try {
        return JSON.parse(row.responseData);
      } catch {}
    }
    return { eligible: false, lastRankSeen: 999, consecutiveOutside: 0 };
  }

  async function updateTop10Eligibility(personId: string, rank: number | null): Promise<boolean> {
    const eligibilityCacheKey = `top10_eligible:${personId}`;
    const state = await getTop10Eligibility(personId);
    const currentRank = rank ?? 999;

    if (currentRank <= 10) {
      state.eligible = true;
      state.consecutiveOutside = 0;
    } else if (currentRank >= 12) {
      state.eligible = false;
      state.consecutiveOutside = 0;
    } else {
      state.consecutiveOutside += 1;
      if (state.consecutiveOutside >= 2) {
        state.eligible = false;
      }
    }
    state.lastRankSeen = currentRank;

    const now = new Date();
    const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    await db.insert(apiCache).values({
      cacheKey: eligibilityCacheKey,
      provider: "system",
      responseData: JSON.stringify(state),
      fetchedAt: now,
      expiresAt: farFuture,
    }).onConflictDoUpdate({
      target: apiCache.cacheKey,
      set: {
        responseData: JSON.stringify(state),
        fetchedAt: now,
      },
    });

    return state.eligible;
  }

  app.get("/api/why-trending/:personId", async (req, res) => {
    try {
      const { personId } = req.params;
      
      const person = await storage.getTrendingPerson(personId);
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }
      
      const hotMover = req.query.hotMover === "true";
      
      const eligible = hotMover || await updateTop10Eligibility(personId, person.rank ?? null);
      
      if (!eligible) {
        return res.json({
          personId,
          personName: person.name,
          hasContext: false,
          message: "Why Trending is only available for top 10 ranked celebrities and Hot Movers",
          fetchedAt: new Date(),
        });
      }
      
      // Check existing cache (may be expired - we still need it for input hash comparison)
      const cacheKey = `why_trending:${personId}`;
      const [cached] = await db
        .select()
        .from(apiCache)
        .where(eq(apiCache.cacheKey, cacheKey))
        .limit(1);
      
      // If cache exists and is still valid, return it immediately
      if (cached && cached.expiresAt && cached.expiresAt > new Date()) {
        const hitResult = JSON.parse(cached.responseData);
        hitResult.cacheStatus = "HIT";
        if (hitResult.provenance?.generatedAt) {
          hitResult.staleAgeMinutes = Math.round((Date.now() - new Date(hitResult.provenance.generatedAt).getTime()) / 60000);
        }
        return res.json(hitResult);
      }
      
      // E) Single-flight lock: prevent cache stampede when multiple users hit cold cache simultaneously
      const lockKey = `why_trending_lock:${personId}`;
      const WHY_TRENDING_LOCK_TTL_SECONDS = 90;
      const [lockRow] = await db.select().from(apiCache).where(eq(apiCache.cacheKey, lockKey)).limit(1);
      if (lockRow && lockRow.expiresAt && lockRow.expiresAt > new Date()) {
        console.log(`[WhyTrending] Generation locked for ${person.name}, serving stale or empty`);
        if (cached) {
          try {
            const staleResult = JSON.parse(cached.responseData);
            staleResult.cacheStatus = "LOCKED_STALE";
            if (staleResult.provenance?.generatedAt) {
              staleResult.staleAgeMinutes = Math.round((Date.now() - new Date(staleResult.provenance.generatedAt).getTime()) / 60000);
            }
            return res.json(staleResult);
          } catch {}
        }
        return res.json({
          personId,
          personName: person.name,
          hasContext: false,
          cacheStatus: "LOCKED_COLD",
          message: "Summary is being generated, please try again shortly",
          fetchedAt: new Date(),
        });
      }
      
      // Acquire single-flight lock before doing any work
      const lockNow = new Date();
      const lockExpires = new Date(lockNow.getTime() + WHY_TRENDING_LOCK_TTL_SECONDS * 1000);
      await db.insert(apiCache).values({
        cacheKey: lockKey,
        provider: "system",
        responseData: JSON.stringify({ personId, lockedAt: lockNow.toISOString() }),
        fetchedAt: lockNow,
        expiresAt: lockExpires,
      }).onConflictDoUpdate({
        target: apiCache.cacheKey,
        set: { fetchedAt: lockNow, expiresAt: lockExpires, responseData: JSON.stringify({ personId, lockedAt: lockNow.toISOString() }) },
      });
      
      // Fetch fresh news via Serper (Serper has its own 6h cache)
      const newsContext = await fetchTrendingNewsContext(person.name);
      
      // Helper: release single-flight lock (expire immediately)
      const releaseLock = async () => {
        try {
          await db.insert(apiCache).values({
            cacheKey: lockKey,
            provider: "system",
            responseData: JSON.stringify({ personId, releasedAt: new Date().toISOString() }),
            fetchedAt: new Date(),
            expiresAt: new Date(0),
          }).onConflictDoUpdate({
            target: apiCache.cacheKey,
            set: { expiresAt: new Date(0), fetchedAt: new Date() },
          });
        } catch {}
      };
      
      if (!newsContext || newsContext.sources.length === 0) {
        await releaseLock();
        return res.json({
          personId,
          personName: person.name,
          hasContext: false,
          cacheStatus: "NO_NEWS",
          staleAgeMinutes: null,
          message: "No recent trending context available",
          fetchedAt: new Date(),
        });
      }
      
      // B) Compute input hash from domain+normalizedTitle (stable even if tracking URLs change)
      const currentInputHash = computeHeadlineHash(newsContext.sources);
      
      // If we have a previous cached result and the input hash is unchanged, extend TTL without calling OpenAI
      if (cached) {
        try {
          const previousResult = JSON.parse(cached.responseData);
          const cachedPromptVersion = previousResult.provenance?.promptVersion ?? 0;
          if (previousResult.inputHash === currentInputHash && previousResult.hasContext && cachedPromptVersion >= WHY_TRENDING_PROMPT_VERSION) {
            console.log(`[WhyTrending] Input hash unchanged for ${person.name}, extending TTL (skipping OpenAI)`);
            const extendNow = new Date();
            const extendExpiresAt = new Date(extendNow.getTime() + WHY_TRENDING_CACHE_TTL_HOURS * 60 * 60 * 1000);
            previousResult.fetchedAt = extendNow;
            previousResult.cacheStatus = "STALE_EXTENDED";
            previousResult.staleAgeMinutes = previousResult.provenance?.generatedAt
              ? Math.round((Date.now() - new Date(previousResult.provenance.generatedAt).getTime()) / 60000)
              : null;
            const updatedResponseData = JSON.stringify(previousResult);
            await db.insert(apiCache).values({
              cacheKey,
              provider: "ai_trending",
              responseData: updatedResponseData,
              fetchedAt: extendNow,
              expiresAt: extendExpiresAt,
            }).onConflictDoUpdate({
              target: apiCache.cacheKey,
              set: { responseData: updatedResponseData, fetchedAt: extendNow, expiresAt: extendExpiresAt },
            });
            await releaseLock();
            return res.json(previousResult);
          }
        } catch {}
      }
      
      // D) Per-person rate limit: no more than 1 OpenAI generation per 30 minutes
      const rateLimitKey = `why_trending_ratelimit:${personId}`;
      const [rateLimitRow] = await db.select().from(apiCache).where(eq(apiCache.cacheKey, rateLimitKey)).limit(1);
      if (rateLimitRow && rateLimitRow.expiresAt && rateLimitRow.expiresAt > new Date()) {
        console.log(`[WhyTrending] Rate limited for ${person.name}, returning stale cache or empty`);
        await releaseLock();
        if (cached) {
          try {
            const rlResult = JSON.parse(cached.responseData);
            rlResult.cacheStatus = "RATE_LIMITED";
            rlResult.staleAgeMinutes = rlResult.provenance?.generatedAt
              ? Math.round((Date.now() - new Date(rlResult.provenance.generatedAt).getTime()) / 60000)
              : null;
            return res.json(rlResult);
          } catch {}
        }
        return res.json({
          personId,
          personName: person.name,
          hasContext: false,
          cacheStatus: "RATE_LIMITED",
          staleAgeMinutes: null,
          message: "Rate limited - please try again later",
          fetchedAt: new Date(),
        });
      }
      
      // Call OpenAI to generate summary
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });
      
      const headlinesText = newsContext.sources.map(s => s.title).join('\n');
      const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      const systemPrompt = `You are a neutral news summarizer. Today's date is ${todayStr}. Use the headlines provided to determine what is currently happening. Treat all information in the headlines as current events happening right now.

CRITICAL RULES:
- Do NOT add titles like "former", "ex-", or "President" to anyone's name unless that exact title appears in the headlines.
- If the headlines simply say a person's name without a title, use just their name — do NOT infer or add titles from your training data.
- Never call someone "former President" or "former CEO" unless the headline explicitly uses that phrase.
- When in doubt, just use the person's name without any title prefix.`;

      const userPrompt = `Based on these recent news headlines about ${person.name}, write a brief 1-2 sentence summary explaining why they are currently trending or in the news.

IMPORTANT GUIDELINES:
- Be strictly neutral and objective — do not express opinions or take sides
- Focus only on factual events and actions, not interpretations or judgments
- Avoid loaded, biased, or emotionally charged language
- Do not use words like "controversial", "criticized", "scandal", "backlash" unless directly quoting a headline
- Present information as a neutral news reporter would
- For political figures, be especially careful to remain impartial and balanced
- Use titles and roles as implied by the headlines, not from your training data

Headlines:
${headlinesText}

Return a JSON object with:
{
  "summary": "1-2 sentence neutral, factual summary of why they're trending",
  "category": "One of: Politics, Business, Music, Sports, Technology, Legal, Personal Life, Controversy, or General News"
}

Be concise, factual, and strictly neutral. Only return the JSON object.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 200,
      });
      
      const content = response.choices[0]?.message?.content;
      const parsed = content ? JSON.parse(content) : { summary: newsContext.headline, category: newsContext.category };
      
      // C) Build result with provenance fields + input hash + debug fields
      const generatedAt = new Date().toISOString();
      const result = {
        personId,
        personName: person.name,
        hasContext: true,
        summary: parsed.summary || newsContext.headline,
        category: parsed.category || newsContext.category,
        topHeadline: newsContext.headline,
        sources: newsContext.sources.slice(0, 3),
        fetchedAt: new Date(),
        inputHash: currentInputHash,
        cacheStatus: "REGENERATED" as string,
        staleAgeMinutes: 0,
        provenance: {
          model: "gpt-4o-mini",
          promptVersion: WHY_TRENDING_PROMPT_VERSION,
          serperQuery: person.name,
          serperTbs: "qdr:w",
          headlinesUsed: newsContext.sources.slice(0, 5).map(s => ({ title: s.title, link: s.link })),
          generatedAt,
        },
      };
      
      const cacheNow = new Date();
      const cacheExpiresAt = new Date(cacheNow.getTime() + WHY_TRENDING_CACHE_TTL_HOURS * 60 * 60 * 1000);
      
      await db.insert(apiCache).values({
        cacheKey,
        provider: "ai_trending",
        responseData: JSON.stringify(result),
        fetchedAt: cacheNow,
        expiresAt: cacheExpiresAt,
      }).onConflictDoUpdate({
        target: apiCache.cacheKey,
        set: {
          responseData: JSON.stringify(result),
          fetchedAt: cacheNow,
          expiresAt: cacheExpiresAt,
        },
      });
      
      // D) Set rate limit marker AFTER successful generation (fail-safe: transient failures won't lock out for 30 min)
      const rlNow = new Date();
      const rlExpires = new Date(rlNow.getTime() + WHY_TRENDING_RATE_LIMIT_MINUTES * 60 * 1000);
      await db.insert(apiCache).values({
        cacheKey: rateLimitKey,
        provider: "system",
        responseData: JSON.stringify({ personId, generatedAt: rlNow.toISOString() }),
        fetchedAt: rlNow,
        expiresAt: rlExpires,
      }).onConflictDoUpdate({
        target: apiCache.cacheKey,
        set: { fetchedAt: rlNow, expiresAt: rlExpires, responseData: JSON.stringify({ personId, generatedAt: rlNow.toISOString() }) },
      });
      
      await releaseLock();
      
      console.log(`[WhyTrending] Generated new summary for ${person.name} (hash: ${currentInputHash})`);
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching why trending:", error);
      // Release lock on error so it doesn't block for 90s
      try {
        const errLockKey = `why_trending_lock:${req.params.personId}`;
        await db.insert(apiCache).values({
          cacheKey: errLockKey,
          provider: "system",
          responseData: JSON.stringify({ error: true }),
          fetchedAt: new Date(),
          expiresAt: new Date(0),
        }).onConflictDoUpdate({
          target: apiCache.cacheKey,
          set: { expiresAt: new Date(0), fetchedAt: new Date() },
        });
      } catch {}
      res.status(500).json({ error: "Failed to fetch trending context", message: error.message });
    }
  });

  // ==================== Matchups API ====================
  
  // Get all matchups with vote counts (with dynamic avatar lookup from tracked_people)
  app.get("/api/matchups", async (req, res) => {
    try {
      const { category } = req.query;
      
      // Get all matchups
      let matchupList = await db.select().from(matchups).orderBy(desc(matchups.createdAt));
      
      // Filter by category if provided
      if (category && category !== 'All') {
        matchupList = matchupList.filter(f => f.category === category);
      }
      
      // Public API: Only show live and inactive matchups (not draft/hidden/archived)
      matchupList = matchupList.filter(f => f.visibility === 'live' || f.visibility === 'inactive');
      
      // Build lookup maps for celebrity avatars (by ID and by name)
      const celebrities = await db.select({
        id: trackedPeople.id,
        name: trackedPeople.name,
        avatar: trackedPeople.avatar,
      }).from(trackedPeople);
      
      const avatarByName: Record<string, string | null> = {};
      const avatarById: Record<string, string | null> = {};
      for (const celeb of celebrities) {
        avatarByName[celeb.name.toLowerCase()] = celeb.avatar;
        avatarById[celeb.id] = celeb.avatar;
      }
      
      // Get vote counts for each matchup and dynamically resolve avatars
      const matchupsWithVotes = await Promise.all(matchupList.map(async (matchup) => {
        const voteResults = await db.select({
          value: votes.value,
          count: count(),
        })
        .from(votes)
        .where(and(
          eq(votes.voteType, 'face_off'),
          eq(votes.targetId, matchup.id)
        ))
        .groupBy(votes.value);
        
        const realAVotes = Number(voteResults.find(v => v.value === 'option_a')?.count || 0);
        const realBVotes = Number(voteResults.find(v => v.value === 'option_b')?.count || 0);
        const displayAVotes = realAVotes + (matchup.seedVotesA || 0);
        const displayBVotes = realBVotes + (matchup.seedVotesB || 0);
        const totalVotes = displayAVotes + displayBVotes;
        
        const optionAImageResolved = (matchup.personAId && avatarById[matchup.personAId]) || matchup.optionAImage || avatarByName[matchup.optionAText.toLowerCase()] || null;
        const optionBImageResolved = (matchup.personBId && avatarById[matchup.personBId]) || matchup.optionBImage || avatarByName[matchup.optionBText.toLowerCase()] || null;
        
        return {
          ...matchup,
          optionAImage: optionAImageResolved,
          optionBImage: optionBImageResolved,
          optionAVotes: displayAVotes,
          optionBVotes: displayBVotes,
          totalVotes,
          optionAPercent: totalVotes > 0 ? Math.round((displayAVotes / totalVotes) * 100) : 50,
          optionBPercent: totalVotes > 0 ? Math.round((displayBVotes / totalVotes) * 100) : 50,
        };
      }));
      
      res.json(matchupsWithVotes);
    } catch (error: any) {
      console.error("Error fetching matchups:", error.message);
      res.status(500).json({ error: "Failed to fetch matchups" });
    }
  });
  
  app.get("/api/matchups/by-slug/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      
      const [matchup] = await db.select().from(matchups).where(eq(matchups.slug, slug));
      if (!matchup) {
        return res.status(404).json({ error: "Matchup not found" });
      }
      
      if (matchup.visibility !== 'live' && matchup.visibility !== 'inactive') {
        return res.status(404).json({ error: "Matchup not found" });
      }
      
      const celebrities = await db.select({
        id: trackedPeople.id,
        name: trackedPeople.name,
        avatar: trackedPeople.avatar,
      }).from(trackedPeople);
      
      const avatarByName: Record<string, string | null> = {};
      const avatarById: Record<string, string | null> = {};
      for (const celeb of celebrities) {
        avatarByName[celeb.name.toLowerCase()] = celeb.avatar;
        avatarById[celeb.id] = celeb.avatar;
      }
      
      const voteResults = await db.select({
        value: votes.value,
        count: count(),
      })
      .from(votes)
      .where(and(
        eq(votes.voteType, 'face_off'),
        eq(votes.targetId, matchup.id)
      ))
      .groupBy(votes.value);
      
      const realAVotes = Number(voteResults.find(v => v.value === 'option_a')?.count || 0);
      const realBVotes = Number(voteResults.find(v => v.value === 'option_b')?.count || 0);
      const displayAVotes = realAVotes + (matchup.seedVotesA || 0);
      const displayBVotes = realBVotes + (matchup.seedVotesB || 0);
      const totalVotes = displayAVotes + displayBVotes;
      
      const optionAImageResolved = (matchup.personAId && avatarById[matchup.personAId]) || matchup.optionAImage || avatarByName[matchup.optionAText.toLowerCase()] || null;
      const optionBImageResolved = (matchup.personBId && avatarById[matchup.personBId]) || matchup.optionBImage || avatarByName[matchup.optionBText.toLowerCase()] || null;
      
      res.json({
        ...matchup,
        optionAImage: optionAImageResolved,
        optionBImage: optionBImageResolved,
        optionAVotes: displayAVotes,
        optionBVotes: displayBVotes,
        totalVotes,
        optionAPercent: totalVotes > 0 ? Math.round((displayAVotes / totalVotes) * 100) : 50,
        optionBPercent: totalVotes > 0 ? Math.round((displayBVotes / totalVotes) * 100) : 50,
      });
    } catch (error: any) {
      console.error("Error fetching matchup by slug:", error.message);
      res.status(500).json({ error: "Failed to fetch matchup" });
    }
  });

  // Get user's votes on matchups (supports anonymous via session ID)
  app.get("/api/matchups/user-votes", optionalAuth, async (req: AuthRequest, res) => {
    try {
      // Use userId if logged in, otherwise use session ID
      const voterId = req.userId || req.sessionId;
      if (!voterId) {
        return res.json({});
      }
      
      const userVotes = await db.select()
        .from(votes)
        .where(and(
          eq(votes.userId, voterId),
          eq(votes.voteType, 'face_off')
        ));
      
      // Convert to a map of matchupId -> votedOption
      const voteMap: Record<string, string> = {};
      userVotes.forEach(vote => {
        voteMap[vote.targetId] = vote.value;
      });
      
      res.json(voteMap);
    } catch (error: any) {
      console.error("Error fetching user matchup votes:", error.message);
      res.status(500).json({ error: "Failed to fetch user votes" });
    }
  });
  
  // Submit a vote on a matchup (supports anonymous via session ID)
  app.post("/api/matchups/:id/vote", optionalAuth, async (req: AuthRequest, res) => {
    try {
      // Use userId if logged in, otherwise use session ID for anonymous voting
      const voterId = req.userId || req.sessionId;
      if (!voterId) {
        return res.status(400).json({ error: "Unable to track vote - no session available" });
      }
      
      const { id } = req.params;
      const { option, remove } = req.body;
      
      // Check if matchup exists
      const [matchup] = await db.select().from(matchups).where(eq(matchups.id, id));
      if (!matchup) {
        return res.status(404).json({ error: "Matchup not found" });
      }
      
      // Check if user/session already voted
      const [existingVote] = await db.select()
        .from(votes)
        .where(and(
          eq(votes.userId, voterId),
          eq(votes.voteType, 'face_off'),
          eq(votes.targetId, id)
        ));
      
      // Handle vote removal
      if (remove === true) {
        if (existingVote) {
          await db.delete(votes).where(eq(votes.id, existingVote.id));
        }
        const voteResults = await db.select({
          value: votes.value,
          count: count(),
        })
        .from(votes)
        .where(and(
          eq(votes.voteType, 'face_off'),
          eq(votes.targetId, id)
        ))
        .groupBy(votes.value);
        
        const realA = Number(voteResults.find(v => v.value === 'option_a')?.count || 0);
        const realB = Number(voteResults.find(v => v.value === 'option_b')?.count || 0);
        const dispA = realA + (matchup.seedVotesA || 0);
        const dispB = realB + (matchup.seedVotesB || 0);
        const totalVotes = dispA + dispB;
        
        return res.json({
          success: true,
          removed: true,
          optionAVotes: dispA,
          optionBVotes: dispB,
          totalVotes,
          optionAPercent: totalVotes > 0 ? Math.round((dispA / totalVotes) * 100) : 50,
          optionBPercent: totalVotes > 0 ? Math.round((dispB / totalVotes) * 100) : 50,
          votedOption: null,
        });
      }
      
      if (!option || (option !== 'option_a' && option !== 'option_b')) {
        return res.status(400).json({ error: "Invalid option. Must be 'option_a' or 'option_b'" });
      }
      
      let xpResult = null;
      
      if (existingVote) {
        if (existingVote.value !== option) {
          await db.update(votes)
            .set({ value: option })
            .where(eq(votes.id, existingVote.id));
        }
      } else {
        await db.insert(votes).values({
          userId: voterId,
          voteType: 'face_off',
          targetType: 'face_off',
          targetId: id,
          value: option,
          weight: 1.0,
        });
        
        // Award XP for authenticated users only on first vote (not vote changes)
        if (req.userId) {
          try {
            xpResult = await gamificationService.awardXp(
              req.userId,
              'vote_face_off',
              `face_off_${id}_${req.userId}`,
              { matchupId: id, votedOption: option }
            );
          } catch (xpError) {
            console.error("XP award failed:", xpError);
          }
        }
      }
      
      // Get updated vote counts
      const voteResults = await db.select({
        value: votes.value,
        count: count(),
      })
      .from(votes)
      .where(and(
        eq(votes.voteType, 'face_off'),
        eq(votes.targetId, id)
      ))
      .groupBy(votes.value);
      
      const realA2 = Number(voteResults.find(v => v.value === 'option_a')?.count || 0);
      const realB2 = Number(voteResults.find(v => v.value === 'option_b')?.count || 0);
      const dispA2 = realA2 + (matchup.seedVotesA || 0);
      const dispB2 = realB2 + (matchup.seedVotesB || 0);
      const totalVotes = dispA2 + dispB2;
      
      res.json({
        success: true,
        optionAVotes: dispA2,
        optionBVotes: dispB2,
        totalVotes,
        optionAPercent: totalVotes > 0 ? Math.round((dispA2 / totalVotes) * 100) : 50,
        optionBPercent: totalVotes > 0 ? Math.round((dispB2 / totalVotes) * 100) : 50,
        votedOption: option,
        xpAwarded: xpResult?.success ? xpResult.xpAwarded : 0,
      });
    } catch (error: any) {
      console.error("Error submitting matchup vote:", error.message);
      res.status(500).json({ error: "Failed to submit vote" });
    }
  });

  // ============================================================================
  // MATCHUP COMMENTS
  // ============================================================================

  app.get("/api/matchups/:slug/comments", async (req, res) => {
    try {
      const { slug } = req.params;
      const [matchup] = await db.select().from(matchups).where(eq(matchups.slug, slug));
      if (!matchup) {
        return res.status(404).json({ error: "Matchup not found" });
      }
      const comments = await db.select().from(matchupComments)
        .where(eq(matchupComments.matchupId, matchup.id))
        .orderBy(desc(matchupComments.createdAt));
      res.json(comments);
    } catch (error: any) {
      console.error("Error fetching matchup comments:", error.message);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  app.post("/api/matchups/:slug/comments", optionalAuth, async (req: AuthRequest, res) => {
    try {
      const { slug } = req.params;
      const { body } = req.body;
      if (!req.userId) {
        return res.status(401).json({ error: "Must be signed in to comment" });
      }
      if (!body || !body.trim()) {
        return res.status(400).json({ error: "Comment body is required" });
      }
      const [matchup] = await db.select().from(matchups).where(eq(matchups.slug, slug));
      if (!matchup) {
        return res.status(404).json({ error: "Matchup not found" });
      }
      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, req.userId));
      const [comment] = await db.insert(matchupComments).values({
        matchupId: matchup.id,
        userId: req.userId,
        username: profile?.username || null,
        avatarUrl: profile?.avatarUrl || null,
        body: body.trim(),
      }).returning();
      res.json(comment);
    } catch (error: any) {
      console.error("Error posting matchup comment:", error.message);
      res.status(500).json({ error: "Failed to post comment" });
    }
  });

  app.post("/api/matchups/comments/:commentId/vote", optionalAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: "Must be signed in to vote" });
      }
      const { commentId } = req.params;
      const { voteType } = req.body;
      if (!voteType || (voteType !== 'up' && voteType !== 'down')) {
        return res.status(400).json({ error: "Invalid vote type" });
      }
      const [existing] = await db.select().from(matchupCommentVotes)
        .where(and(eq(matchupCommentVotes.userId, req.userId), eq(matchupCommentVotes.commentId, commentId)));
      if (existing) {
        if (existing.voteType === voteType) {
          await db.delete(matchupCommentVotes).where(eq(matchupCommentVotes.id, existing.id));
          if (voteType === 'up') {
            await db.update(matchupComments).set({ upvotes: sql`GREATEST(upvotes - 1, 0)` }).where(eq(matchupComments.id, commentId));
          } else {
            await db.update(matchupComments).set({ downvotes: sql`GREATEST(downvotes - 1, 0)` }).where(eq(matchupComments.id, commentId));
          }
        } else {
          await db.update(matchupCommentVotes).set({ voteType }).where(eq(matchupCommentVotes.id, existing.id));
          if (voteType === 'up') {
            await db.update(matchupComments).set({ upvotes: sql`upvotes + 1`, downvotes: sql`GREATEST(downvotes - 1, 0)` }).where(eq(matchupComments.id, commentId));
          } else {
            await db.update(matchupComments).set({ downvotes: sql`downvotes + 1`, upvotes: sql`GREATEST(upvotes - 1, 0)` }).where(eq(matchupComments.id, commentId));
          }
        }
      } else {
        await db.insert(matchupCommentVotes).values({ commentId, userId: req.userId, voteType });
        if (voteType === 'up') {
          await db.update(matchupComments).set({ upvotes: sql`upvotes + 1` }).where(eq(matchupComments.id, commentId));
        } else {
          await db.update(matchupComments).set({ downvotes: sql`downvotes + 1` }).where(eq(matchupComments.id, commentId));
        }
      }
      const [updated] = await db.select().from(matchupComments).where(eq(matchupComments.id, commentId));
      res.json(updated);
    } catch (error: any) {
      console.error("Error voting on matchup comment:", error.message);
      res.status(500).json({ error: "Failed to vote on comment" });
    }
  });

  // ============================================================================
  // GAMIFICATION ROUTES
  // ============================================================================

  // Get user gamification stats (XP, rank, capabilities, credits)
  app.get("/api/gamification/stats", requireAuth, async (req: AuthRequest, res) => {
    try {
      const stats = await gamificationService.getUserStats(req.userId!);
      if (!stats) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(stats);
    } catch (error: any) {
      console.error("Error fetching user stats:", error.message);
      res.status(500).json({ error: "Failed to fetch user stats" });
    }
  });

  // Check a specific permission
  app.get("/api/gamification/check-permission/:capability", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { capability } = req.params;
      const hasPermission = await gamificationService.checkPermission(req.userId!, capability as any);
      res.json({ capability, hasPermission });
    } catch (error: any) {
      console.error("Error checking permission:", error.message);
      res.status(500).json({ error: "Failed to check permission" });
    }
  });

  // NOTE: XP awarding is handled INTERNALLY by action handlers (votes, comments, etc.)
  // There is NO public endpoint for XP awards - this prevents forging
  // XP is awarded via gamificationService.awardXp() called directly in handlers

  // NOTE: Credit adjustments are handled INTERNALLY by prediction handlers
  // Debits occur when placing predictions (via stake handlers)
  // Credits occur when winning predictions (via settlement handlers)

  // Get XP history for current user
  app.get("/api/gamification/xp-history", requireAuth, async (req: AuthRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const history = await gamificationService.getXpHistory(req.userId!, limit);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching XP history:", error.message);
      res.status(500).json({ error: "Failed to fetch XP history" });
    }
  });

  // Get credit history for current user
  app.get("/api/gamification/credit-history", requireAuth, async (req: AuthRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const history = await gamificationService.getCreditHistory(req.userId!, limit);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching credit history:", error.message);
      res.status(500).json({ error: "Failed to fetch credit history" });
    }
  });

  // Get daily XP summary (for showing remaining caps)
  app.get("/api/gamification/daily-summary", requireAuth, async (req: AuthRequest, res) => {
    try {
      const summary = await gamificationService.getDailyXpSummary(req.userId!);
      res.json(summary);
    } catch (error: any) {
      console.error("Error fetching daily summary:", error.message);
      res.status(500).json({ error: "Failed to fetch daily summary" });
    }
  });

  // Get available XP actions (for UI display)
  app.get("/api/gamification/xp-actions", async (req, res) => {
    try {
      const actions = await db.select().from(xpActions).where(eq(xpActions.isActive, true));
      res.json(actions);
    } catch (error: any) {
      console.error("Error fetching XP actions:", error.message);
      res.status(500).json({ error: "Failed to fetch XP actions" });
    }
  });

  // ==================== PROFILE ENDPOINTS ====================
  
  // Admin emails that get special privileges
  const ADMIN_EMAILS = ["shaun.burgess21@gmail.com", "andrewdburgess001@gmail.com"];
  
  // Sync profile after Supabase auth - creates profile if doesn't exist
  // Implements admin backdoor for specific emails
  app.post("/api/profile/sync", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const jwtEmail = req.userEmail || null;
      
      // Try to get user details from Supabase Admin API, but don't block on failure
      let email = jwtEmail;
      let fullName: string | null = null;
      let avatarUrl: string | null = null;
      
      try {
        const result = await supabaseServer.auth.admin.getUserById(userId);
        if (result.data?.user) {
          email = result.data.user.email || email;
          fullName = result.data.user.user_metadata?.full_name || result.data.user.user_metadata?.name || null;
          avatarUrl = result.data.user.user_metadata?.avatar_url || result.data.user.user_metadata?.picture || null;
        } else {
          console.warn(`[Profile] Admin API getUserById failed for ${userId}, falling back to JWT email: ${jwtEmail}`);
        }
      } catch (adminErr: any) {
        console.warn(`[Profile] Admin API error for ${userId}, falling back to JWT email: ${jwtEmail}`, adminErr?.message);
      }
      
      if (!email) {
        console.error(`[Profile] No email available for user ${userId} from JWT or Admin API`);
        return res.status(400).json({ error: "Could not determine user email" });
      }
      
      // Check if profile exists
      const existing = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      
      if (existing.length > 0) {
        // Update existing profile (update avatar/name if changed)
        const updateData: Partial<Profile> = {
          lastActiveAt: new Date(),
        };
        if (fullName && !existing[0].fullName) updateData.fullName = fullName;
        if (avatarUrl && !existing[0].avatarUrl) updateData.avatarUrl = avatarUrl;
        
        // Check if this is an admin email but profile doesn't have admin role yet
        // This handles the case where admin was manually set in DB or backdoor wasn't applied
        const shouldBeAdmin = email && ADMIN_EMAILS.includes(email.toLowerCase());
        if (shouldBeAdmin && existing[0].role !== "admin") {
          updateData.role = "admin";
          updateData.rank = "Hall of Famer";
          updateData.xpPoints = Math.max(existing[0].xpPoints, 100000);
          console.log(`[Profile] Upgrading ${email} to admin role via sync backdoor`);
        }
        
        await db.update(profiles).set(updateData).where(eq(profiles.id, userId));
        const updated = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
        
        // Debug logging for sync
        console.log(`[Profile] /api/profile/sync - User: ${userId}, Email: ${email}, Role: ${updated[0].role}`);
        
        return res.json(updated[0]);
      }
      
      // Create new profile
      const isAdmin = email && ADMIN_EMAILS.includes(email.toLowerCase());
      const username = email ? email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "") + Math.floor(Math.random() * 1000) : `user${Date.now()}`;
      
      const newProfile = {
        id: userId,
        username,
        fullName,
        avatarUrl,
        isPublic: true,
        role: isAdmin ? "admin" : "user",
        rank: isAdmin ? "Hall of Famer" : "Citizen",
        xpPoints: isAdmin ? 100000 : 0, // Admin starts with high XP
        predictCredits: 1000,
        currentStreak: 0,
        totalVotes: 0,
        totalPredictions: 0,
        winRate: 0,
        lastActiveAt: new Date(),
      };
      
      await db.insert(profiles).values(newProfile);
      
      console.log(`Created profile for ${email} - Role: ${newProfile.role}, Rank: ${newProfile.rank}`);
      
      res.json(newProfile);
    } catch (error: any) {
      console.error("Error syncing profile:", error.message);
      res.status(500).json({ error: "Failed to sync profile" });
    }
  });
  
  // Get current user's profile
  app.get("/api/profile/me", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const profile = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      
      if (profile.length === 0) {
        return res.status(404).json({ error: "Profile not found. Please sync your profile first." });
      }
      
      // Debug logging for admin access issues
      console.log(`[Profile] /api/profile/me - User: ${userId}, Role: ${profile[0].role}, Username: ${profile[0].username}`);
      
      res.json(profile[0]);
    } catch (error: any) {
      console.error("Error fetching profile:", error.message);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });
  
  // Update current user's profile
  app.patch("/api/profile/me", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const { username, fullName, avatarUrl, isPublic } = req.body;
      
      // Build update object with only provided fields
      const updateData: Partial<Profile> = {};
      if (username !== undefined) {
        // Validate username uniqueness
        const existingUsername = await db.select().from(profiles)
          .where(and(eq(profiles.username, username), sql`${profiles.id} != ${userId}`))
          .limit(1);
        if (existingUsername.length > 0) {
          return res.status(400).json({ error: "Username already taken" });
        }
        updateData.username = username;
      }
      if (fullName !== undefined) updateData.fullName = fullName;
      if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
      if (isPublic !== undefined) updateData.isPublic = isPublic;
      
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }
      
      await db.update(profiles).set(updateData).where(eq(profiles.id, userId));
      const updated = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      
      res.json(updated[0]);
    } catch (error: any) {
      console.error("Error updating profile:", error.message);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });
  
  // Get public profile by username
  app.get("/api/profile/u/:username", async (req, res) => {
    try {
      const { username } = req.params;
      const profile = await db.select().from(profiles).where(eq(profiles.username, username)).limit(1);
      
      if (profile.length === 0) {
        return res.status(404).json({ error: "Profile not found" });
      }
      
      // If profile is private, return limited info
      if (!profile[0].isPublic) {
        return res.json({
          username: profile[0].username,
          avatarUrl: profile[0].avatarUrl,
          rank: profile[0].rank,
          isPublic: false,
          message: "This profile is private"
        });
      }
      
      // Return full public profile
      res.json({
        username: profile[0].username,
        fullName: profile[0].fullName,
        avatarUrl: profile[0].avatarUrl,
        rank: profile[0].rank,
        xpPoints: profile[0].xpPoints,
        totalVotes: profile[0].totalVotes,
        totalPredictions: profile[0].totalPredictions,
        winRate: profile[0].winRate,
        isPublic: true,
        createdAt: profile[0].createdAt,
      });
    } catch (error: any) {
      console.error("Error fetching public profile:", error.message);
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });
  
  // Check if current user is admin
  app.get("/api/profile/is-admin", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      const profile = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      
      res.json({ 
        isAdmin: profile.length > 0 && profile[0].role === "admin",
        role: profile.length > 0 ? profile[0].role : null
      });
    } catch (error: any) {
      console.error("Error checking admin status:", error.message);
      res.status(500).json({ error: "Failed to check admin status" });
    }
  });
  
  // ==================
  // /me User Activity Endpoints
  // ==================
  
  // Get user's votes
  app.get("/api/me/votes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      
      // Get votes from votes table
      const userVotes = await db.select().from(votes).where(eq(votes.userId, userId)).orderBy(desc(votes.votedAt)).limit(50);
      
      // Transform votes to include target names
      const votesWithDetails = await Promise.all(userVotes.map(async (vote) => {
        let targetName = "Unknown";
        
        // Try to get celebrity name if it's a celebrity-related vote
        if (vote.targetId) {
          const person = await db.select({ name: trackedPeople.name }).from(trackedPeople).where(eq(trackedPeople.id, vote.targetId)).limit(1);
          if (person.length > 0) {
            targetName = person[0].name;
          }
        }
        
        return {
          id: vote.id,
          voteType: vote.voteType,
          value: vote.weight || 1,
          targetName,
          createdAt: vote.votedAt,
        };
      }));
      
      res.json(votesWithDetails);
    } catch (error: any) {
      console.error("Error fetching user votes:", error.message);
      res.status(500).json({ error: "Failed to fetch votes" });
    }
  });
  
  // Get user's predictions (placeholder for now)
  app.get("/api/me/predictions", requireAuth, async (req: AuthRequest, res) => {
    try {
      // For now, return empty array until predictions system is fully implemented
      res.json([]);
    } catch (error: any) {
      console.error("Error fetching user predictions:", error.message);
      res.status(500).json({ error: "Failed to fetch predictions" });
    }
  });
  
  // Get user's favorites
  app.get("/api/me/favorites", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      
      // Get user favorites from userFavourites table
      const userFavs = await db.select().from(userFavourites).where(eq(userFavourites.userId, userId)).limit(50);
      
      // Get celebrity details for each favorite
      const favoritesWithDetails = await Promise.all(userFavs.map(async (fav) => {
        const person = await db.select().from(trackedPeople).where(eq(trackedPeople.id, fav.personId)).limit(1);
        const trending = await db.select().from(trendingPeople).where(eq(trendingPeople.id, fav.personId)).limit(1);
        
        return {
          id: fav.id,
          celebrityId: fav.personId,
          name: person[0]?.name || "Unknown",
          imageUrl: person[0]?.avatar || null,
          category: person[0]?.category || "Other",
          rank: trending[0]?.rank || 999,
          change: trending[0]?.change24h || 0,
        };
      }));
      
      res.json(favoritesWithDetails);
    } catch (error: any) {
      console.error("Error fetching user favorites:", error.message);
      res.status(500).json({ error: "Failed to fetch favorites" });
    }
  });
  
  // ==================
  // Admin Endpoints
  // ==================
  
  // Helper middleware to check admin status with VERBOSE debugging
  const requireAdmin = async (req: AuthRequest, res: any, next: any) => {
    try {
      const userId = req.userId;
      console.log(`\n========== ADMIN ACCESS CHECK ==========`);
      console.log(`[requireAdmin] Step 1 - UserId from request: ${userId}`);
      
      if (!userId) {
        console.log(`[requireAdmin] FAIL - No userId in request`);
        return res.status(401).json({ error: "Authentication required" });
      }

      // Check 1: Look at the Profiles table (Database)
      const profile = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      const dbRole = profile.length > 0 ? profile[0].role : "NO_PROFILE_FOUND";
      const isDbAdmin = profile.length > 0 && profile[0].role === "admin";
      console.log(`[requireAdmin] Step 2 - Database profile found: ${profile.length > 0}`);
      console.log(`[requireAdmin] Step 3 - DB Role value: "${dbRole}" (type: ${typeof dbRole})`);
      console.log(`[requireAdmin] Step 4 - isDbAdmin check (role === "admin"): ${isDbAdmin}`);

      // Check 2: Look at Supabase Auth Metadata (with fallback to JWT email)
      let authEmail = (req as AuthRequest).userEmail || "NO_EMAIL";
      let isAuthAdmin = false;
      
      try {
        const { data: { user }, error: authError } = await supabaseServer.auth.admin.getUserById(userId);
        if (!authError && user) {
          authEmail = user.email || authEmail;
          isAuthAdmin = user.user_metadata?.role === 'admin';
        } else {
          console.log(`[requireAdmin] Admin API failed, using JWT email: ${authEmail}`);
        }
      } catch (adminErr: any) {
        console.log(`[requireAdmin] Admin API error, using JWT email: ${authEmail}`, adminErr?.message);
      }
      
      const authEmailLower = authEmail.toLowerCase();
      
      // Check against ADMIN_EMAILS list (case-insensitive)
      const adminEmailsLower = ADMIN_EMAILS.map(e => e.toLowerCase());
      const isInAdminList = adminEmailsLower.includes(authEmailLower);
      
      console.log(`[requireAdmin] SUMMARY: isDbAdmin=${isDbAdmin}, isAuthAdmin=${isAuthAdmin}, isInAdminList=${isInAdminList}, email=${authEmailLower}`);

      // If ANY check passes, let them in
      if (isDbAdmin || isAuthAdmin || isInAdminList) {
        console.log(`[requireAdmin] ACCESS GRANTED - Reason: ${isDbAdmin ? "DB_ROLE" : isInAdminList ? "EMAIL_LIST" : "AUTH_METADATA"}`);
        console.log(`==========================================\n`);
        return next();
      }

      console.log(`[requireAdmin] ACCESS DENIED - No admin role or email match`);
      console.log(`==========================================\n`);
      return res.status(403).json({ error: "Admin access required" });
    } catch (error: any) {
      console.error("[requireAdmin] ERROR:", error.message);
      console.log(`==========================================\n`);
      res.status(500).json({ error: "Failed to verify admin status" });
    }
  };
  
  // Engine Health Diagnostics - comprehensive snapshot/ingestion health check
  app.get("/api/admin/engine-health", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const h48Ago = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      const h24Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const hourlyBuckets = await db.execute(sql`
        SELECT 
          date_trunc('hour', timestamp) as hour,
          COUNT(*)::int as count,
          COUNT(DISTINCT person_id)::int as unique_people,
          MAX(snapshot_origin) as origin
        FROM trend_snapshots
        WHERE timestamp > ${h48Ago}
        GROUP BY date_trunc('hour', timestamp)
        ORDER BY hour DESC
      `);

      const latestSnapshotRow = await db.execute(sql`
        SELECT MAX(timestamp) as latest FROM trend_snapshots
      `);
      const latestSnapshot = latestSnapshotRow.rows?.[0]?.latest as string | null;

      const coverageRow = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*)::int FROM tracked_people) as tracked,
          (SELECT COUNT(*)::int FROM trending_people) as trending,
          (SELECT COUNT(*)::int FROM trending_people WHERE fame_index > 0) as with_score
      `);
      const coverage = coverageRow.rows?.[0] || { tracked: 0, trending: 0, with_score: 0 };

      const distRow = await db.execute(sql`
        SELECT 
          MIN(fame_index)::int as min_fame,
          MAX(fame_index)::int as max_fame,
          ROUND(AVG(fame_index))::int as avg_fame,
          ROUND(STDDEV(fame_index))::int as stddev_fame,
          ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY fame_index))::int as median_fame
        FROM trending_people
        WHERE fame_index > 0
      `);
      const distribution = distRow.rows?.[0] || {};

      const signalRow = await db.execute(sql`
        SELECT 
          SUM(CASE WHEN wiki_pageviews = 0 OR wiki_pageviews IS NULL THEN 1 ELSE 0 END)::int as zero_wiki,
          SUM(CASE WHEN news_count = 0 OR news_count IS NULL THEN 1 ELSE 0 END)::int as zero_news,
          SUM(CASE WHEN search_volume = 0 OR search_volume IS NULL THEN 1 ELSE 0 END)::int as zero_search,
          ROUND(AVG(confidence)::numeric, 2) as avg_confidence,
          COUNT(*)::int as batch_size
        FROM trend_snapshots
        WHERE timestamp = (SELECT MAX(timestamp) FROM trend_snapshots)
      `);
      const signals = signalRow.rows?.[0] || {};

      const refRow = await db.execute(sql`
        SELECT fetched_at, expires_at
        FROM api_cache 
        WHERE cache_key = 'system:source_stats_reference'
        LIMIT 1
      `);
      const sourceStatsRef = (refRow.rows?.[0] as { fetched_at: string; expires_at: string } | undefined) || null;

      // === BASELINE DIAGNOSTICS ===
      const t24hAgoHealth = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const t7dAgoHealth = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const BASELINE_24H_WINDOW = 6 * 60 * 60 * 1000;
      const BASELINE_7D_WINDOW = 24 * 60 * 60 * 1000;
      
      const [baseline24hRun] = await db
        .select({ id: ingestionRuns.id, finishedAt: ingestionRuns.finishedAt })
        .from(ingestionRuns)
        .where(and(
          eq(ingestionRuns.status, "completed"),
          gt(ingestionRuns.finishedAt, new Date(t24hAgoHealth.getTime() - BASELINE_24H_WINDOW)),
          lt(ingestionRuns.finishedAt, new Date(t24hAgoHealth.getTime() + BASELINE_24H_WINDOW))
        ))
        .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${t24hAgoHealth}::timestamp))`)
        .limit(1);
      
      const [baseline7dRun] = await db
        .select({ id: ingestionRuns.id, finishedAt: ingestionRuns.finishedAt })
        .from(ingestionRuns)
        .where(and(
          eq(ingestionRuns.status, "completed"),
          gt(ingestionRuns.finishedAt, new Date(t7dAgoHealth.getTime() - BASELINE_7D_WINDOW)),
          lt(ingestionRuns.finishedAt, new Date(t7dAgoHealth.getTime() + BASELINE_7D_WINDOW))
        ))
        .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${t7dAgoHealth}::timestamp))`)
        .limit(1);
      
      const baselineAge24hHours = baseline24hRun?.finishedAt 
        ? Math.round((now.getTime() - new Date(baseline24hRun.finishedAt).getTime()) / (1000 * 60 * 60) * 10) / 10
        : null;
      const baselineAge7dHours = baseline7dRun?.finishedAt
        ? Math.round((now.getTime() - new Date(baseline7dRun.finishedAt).getTime()) / (1000 * 60 * 60) * 10) / 10
        : null;
      
      // Count people missing 24h baseline
      let baselineCoverage24h = 0;
      if (baseline24hRun) {
        const [countRow] = await db
          .select({ cnt: sql<number>`COUNT(DISTINCT ${trendSnapshots.personId})` })
          .from(trendSnapshots)
          .where(eq(trendSnapshots.runId, baseline24hRun.id));
        baselineCoverage24h = Number(countRow?.cnt ?? 0);
      }
      
      // === SYSTEMIC CHANGE ALERT ===
      // Check if >90% of people have 24h changes in the same direction
      const trendingPeopleForAlert = await db
        .select({ change24h: trendingPeople.change24h })
        .from(trendingPeople)
        .where(isNotNull(trendingPeople.change24h));
      
      let positiveCount = 0;
      let negativeCount = 0;
      let totalWithChange = 0;
      for (const p of trendingPeopleForAlert) {
        const c = Number(p.change24h);
        if (c > 0) positiveCount++;
        else if (c < 0) negativeCount++;
        totalWithChange++;
      }
      const positivePct = totalWithChange > 0 ? Math.round(positiveCount / totalWithChange * 100) : 0;
      const negativePct = totalWithChange > 0 ? Math.round(negativeCount / totalWithChange * 100) : 0;
      const systemicChangeAlert = totalWithChange > 10 && (positivePct > 90 || negativePct > 90);

      const pollutedResult = await db.execute(sql`
        SELECT COUNT(*)::int as cnt FROM trend_snapshots WHERE run_id IS NULL
      `);
      const pollutedSnapshotCount = Number((pollutedResult.rows?.[0] as any)?.cnt ?? 0);

      const spotCheckRows = await db.execute(sql`
        SELECT name, fame_index, rank
        FROM trending_people
        ORDER BY RANDOM()
        LIMIT 5
      `);
      const allRanked = await db.execute(sql`
        SELECT name, fame_index, rank
        FROM trending_people
        ORDER BY fame_index DESC NULLS LAST
      `);
      
      let rankOrderCorrect = true;
      let rankIssues: string[] = [];
      const rankedPeople = allRanked.rows || [];
      for (let i = 0; i < rankedPeople.length; i++) {
        const expectedRank = i + 1;
        if (Number(rankedPeople[i].rank) !== expectedRank) {
          rankOrderCorrect = false;
          rankIssues.push(`${rankedPeople[i].name}: has rank ${rankedPeople[i].rank}, expected ${expectedRank}`);
        }
      }

      const buckets = (hourlyBuckets.rows || []).map((r: any) => new Date(r.hour).getTime()).sort((a: number, b: number) => a - b);
      let maxGapMinutes = 0;
      let gapsOver2h = 0;
      const gapDetails: { from: string; to: string; gapMinutes: number }[] = [];
      for (let i = 1; i < buckets.length; i++) {
        const gap = (buckets[i] - buckets[i - 1]) / (1000 * 60);
        if (gap > maxGapMinutes) maxGapMinutes = gap;
        if (gap > 120) {
          gapsOver2h++;
          gapDetails.push({
            from: new Date(buckets[i - 1]).toISOString(),
            to: new Date(buckets[i]).toISOString(),
            gapMinutes: Math.round(gap),
          });
        }
      }

      const backfilledHours = (hourlyBuckets.rows || [])
        .filter((r: any) => Number(r.count) > Number(coverage.tracked || 100))
        .map((r: any) => ({
          hour: new Date(r.hour).toISOString(),
          count: Number(r.count),
          expectedCount: Number(coverage.tracked || 100),
        }));

      const minutesSinceLastSnapshot = latestSnapshot 
        ? Math.round((now.getTime() - new Date(latestSnapshot).getTime()) / (1000 * 60))
        : null;

      // === INGESTION RUNS DATA (from ingestion_runs table) ===
      const recentRunsResult = await db.execute(sql`
        SELECT id, started_at, finished_at, status, hour_bucket,
               snapshots_written, people_processed, error_count, error_summary,
               source_timings, source_statuses, health_summary,
               lock_acquired_at, lock_released_at, heartbeat_at
        FROM ingestion_runs
        ORDER BY started_at DESC
        LIMIT 20
      `);
      const recentRuns = (recentRunsResult.rows || []).map((r: any) => ({
        id: r.id,
        startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
        finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
        status: r.status,
        hourBucket: r.hour_bucket ? new Date(r.hour_bucket).toISOString() : null,
        snapshotsWritten: Number(r.snapshots_written || 0),
        peopleProcessed: Number(r.people_processed || 0),
        errorCount: Number(r.error_count || 0),
        errorSummary: r.error_summary,
        sourceTimings: r.source_timings,
        sourceStatuses: r.source_statuses,
        healthSummary: r.health_summary,
        heartbeatAt: r.heartbeat_at ? new Date(r.heartbeat_at).toISOString() : null,
        durationMs: r.started_at && r.finished_at 
          ? new Date(r.finished_at).getTime() - new Date(r.started_at).getTime() 
          : null,
      }));

      const lastSuccessfulRun = recentRuns.find((r: any) => r.status === "completed");
      const currentlyRunning = recentRuns.find((r: any) => r.status === "running");

      const runs24hResult = await db.execute(sql`
        SELECT 
          COUNT(*)::int as total_runs,
          COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as completed,
          COUNT(CASE WHEN status = 'failed' THEN 1 END)::int as failed,
          COUNT(CASE WHEN status = 'locked_out' THEN 1 END)::int as locked_out,
          COUNT(CASE WHEN status = 'running' THEN 1 END)::int as currently_running
        FROM ingestion_runs
        WHERE started_at > ${h24Ago}
      `);
      const runs24h = runs24hResult.rows?.[0] || { total_runs: 0, completed: 0, failed: 0, locked_out: 0, currently_running: 0 };

      // Source health from the latest successful run
      const latestSourceTimings = lastSuccessfulRun?.sourceTimings || null;
      const latestSourceStatuses = lastSuccessfulRun?.sourceStatuses || null;

      res.json({
        timestamp: now.toISOString(),
        window: {
          start: h48Ago.toISOString(),
          end: now.toISOString(),
          timezone: "UTC",
        },
        ingestion: {
          lastSnapshotAt: latestSnapshot ? new Date(latestSnapshot).toISOString() : null,
          minutesSinceLastSnapshot,
          status: minutesSinceLastSnapshot !== null 
            ? minutesSinceLastSnapshot < 90 ? "fresh" 
            : minutesSinceLastSnapshot < 180 ? "aging" 
            : "stale"
            : "unknown",
          totalHoursWithData: buckets.length,
          lastSuccessfulFinish: lastSuccessfulRun?.finishedAt || null,
          lastSuccessfulDurationMs: lastSuccessfulRun?.durationMs || null,
          currentlyRunning: !!currentlyRunning,
          currentRunStartedAt: currentlyRunning?.startedAt || null,
          currentRunHeartbeatAt: currentlyRunning?.heartbeatAt || null,
        },
        ingestionRuns: {
          last24h: {
            totalRuns: Number(runs24h.total_runs),
            completed: Number(runs24h.completed),
            failed: Number(runs24h.failed),
            lockedOut: Number(runs24h.locked_out),
            currentlyRunning: Number(runs24h.currently_running),
          },
          recentRuns: recentRuns.slice(0, 10),
        },
        sourceHealth: {
          timings: latestSourceTimings,
          statuses: latestSourceStatuses,
          lastRunHealthSummary: lastSuccessfulRun?.healthSummary || null,
          liveStateMachine: (() => {
            const h = getCurrentHealthSnapshot();
            const fmt = (s: typeof h.news) => ({
              state: s.state,
              consecutiveFailures: s.consecutiveFailures,
              lastHealthyAt: s.lastHealthyTimestamp?.toISOString() ?? null,
              staleHours: s.lastHealthyTimestamp
                ? Math.round((now.getTime() - s.lastHealthyTimestamp.getTime()) / (1000 * 60 * 60) * 10) / 10
                : null,
              decayFactor: Math.round(getStalenessDecayFactor(s.lastHealthyTimestamp) * 100),
              coveragePct: s.prevCoveragePct ?? null,
              coverageDropRuns: s.coverageDropRuns ?? 0,
              consecutiveRecoveryRuns: s.consecutiveRecoveryRuns ?? 0,
              reason: s.reason,
            });
            const runMeta = getLastRunMeta();
            return {
              news: fmt(h.news), search: fmt(h.search), wiki: fmt(h.wiki),
              lastRun: runMeta ? {
                runId: runMeta.runId ?? null,
                newsProviderUsed: runMeta.newsProviderUsed,
                newsFreshCoveragePct: Math.round(runMeta.newsFreshCoveragePct),
                searchFreshCoveragePct: Math.round(runMeta.searchFreshCoveragePct),
                newsGovernorFactor: Math.round(runMeta.newsGovernorFactor * 100),
                searchGovernorFactor: Math.round(runMeta.searchGovernorFactor * 100),
                newsMedianArticles: runMeta.newsMedianArticles,
                newsMeanArticles: runMeta.newsMeanArticles,
                newsQualityLow: runMeta.newsQualityLow,
                finishedAt: runMeta.finishedAt instanceof Date ? runMeta.finishedAt.toISOString() : String(runMeta.finishedAt),
                mediastackSuccessPct: runMeta.mediastackSuccessPct != null ? Math.round(runMeta.mediastackSuccessPct) : null,
                mediastackNonZeroPct: runMeta.mediastackNonZeroPct != null ? Math.round(runMeta.mediastackNonZeroPct) : null,
                mediastackTop25NonZeroPct: runMeta.mediastackTop25NonZeroPct != null ? Math.round(runMeta.mediastackTop25NonZeroPct) : null,
                mediastackIsRefresh: runMeta.mediastackIsRefresh ?? null,
                mediastackLastFetchAt: runMeta.mediastackLastFetchAt ?? null,
                perPersonFallback: runMeta.perPersonFallback ?? null,
              } : null,
            };
          })(),
        },
        mediastackBudget: await (async () => {
          try {
            return await getMediastackBudgetSummary();
          } catch (err) {
            return { error: "Failed to fetch budget summary" };
          }
        })(),
        coverage: {
          trackedPeople: Number(coverage.tracked),
          trendingPeople: Number(coverage.trending),
          withFameScore: Number(coverage.with_score),
          allHaveScores: Number(coverage.trending) === Number(coverage.with_score),
        },
        staleness: {
          ageMinutes: minutesSinceLastSnapshot,
          isStale: minutesSinceLastSnapshot !== null && minutesSinceLastSnapshot >= 120,
          isCritical: minutesSinceLastSnapshot !== null && minutesSinceLastSnapshot >= 240,
          latestSnapshotAt: latestSnapshot ? new Date(latestSnapshot).toISOString() : null,
        },
        gaps: {
          maxGapMinutes: Math.round(maxGapMinutes),
          gapsOver2hCount: gapsOver2h,
          gapDetails: gapDetails.slice(0, 5),
        },
        backfill: {
          backfilledHoursCount: backfilledHours.length,
          backfilledHours: backfilledHours.slice(0, 5),
        },
        fameDistribution: {
          min: Number(distribution.min_fame || 0),
          max: Number(distribution.max_fame || 0),
          average: Number(distribution.avg_fame || 0),
          median: Number(distribution.median_fame || 0),
          stddev: Number(distribution.stddev_fame || 0),
        },
        signalQuality: {
          batchSize: Number(signals.batch_size || 0),
          zeroWiki: Number(signals.zero_wiki || 0),
          zeroNews: Number(signals.zero_news || 0),
          zeroSearch: Number(signals.zero_search || 0),
          avgConfidence: Number(signals.avg_confidence || 0),
        },
        sourceStatsReference: sourceStatsRef ? {
          lastComputed: new Date(sourceStatsRef.fetched_at).toISOString(),
          expiresAt: new Date(sourceStatsRef.expires_at).toISOString(),
          minutesSinceComputed: Math.round((now.getTime() - new Date(sourceStatsRef.fetched_at).getTime()) / (1000 * 60)),
        } : null,
        rankIntegrity: {
          isCorrect: rankOrderCorrect,
          issueCount: rankIssues.length,
          issues: rankIssues.slice(0, 5),
        },
        baselineDiagnostics: {
          baseline24h: {
            runId: baseline24hRun?.id ?? null,
            finishedAt: baseline24hRun?.finishedAt ? new Date(baseline24hRun.finishedAt).toISOString() : null,
            ageHours: baselineAge24hHours,
            status: baseline24hRun ? "normal" : "degraded",
            snapshotCoverage: baselineCoverage24h,
          },
          baseline7d: {
            runId: baseline7dRun?.id ?? null,
            finishedAt: baseline7dRun?.finishedAt ? new Date(baseline7dRun.finishedAt).toISOString() : null,
            ageHours: baselineAge7dHours,
            status: baseline7dRun ? "normal" : "degraded",
          },
          currentRunId: lastSuccessfulRun?.id ?? null,
          pollutedSnapshots: pollutedSnapshotCount,
        },
        systemicChangeAlert: {
          alert: systemicChangeAlert,
          message: systemicChangeAlert 
            ? `WARNING: ${positivePct > 90 ? positivePct + '% positive' : negativePct + '% negative'} — baseline likely wrong or ingestion gap`
            : "OK — changes are distributed normally",
          breakdown: {
            totalWithChange: totalWithChange,
            positiveCount,
            negativeCount,
            positivePct,
            negativePct,
          },
        },
        persistedInstrumentation: await (async () => {
          try {
            const systemKeys = await db.select({
              cacheKey: apiCache.cacheKey,
              responseData: apiCache.responseData,
              fetchedAt: apiCache.fetchedAt,
            }).from(apiCache).where(
              inArray(apiCache.cacheKey, [
                'system:lastRunMeta',
                'system:healthSummary',
                'system:source_health_state',
              ])
            );
            const result: Record<string, any> = {};
            for (const row of systemKeys) {
              try {
                result[row.cacheKey] = {
                  data: JSON.parse(row.responseData),
                  persistedAt: row.fetchedAt ? new Date(row.fetchedAt).toISOString() : null,
                };
              } catch {
                result[row.cacheKey] = { data: null, error: "parse_failed", persistedAt: row.fetchedAt ? new Date(row.fetchedAt).toISOString() : null };
              }
            }
            const expectedKeys = ['system:lastRunMeta', 'system:healthSummary', 'system:source_health_state'];
            for (const k of expectedKeys) {
              if (!result[k]) result[k] = { data: null, status: "missing" };
            }
            return result;
          } catch (err) {
            return { error: "Failed to query persisted instrumentation" };
          }
        })(),
        spotCheck: (spotCheckRows.rows || []).map((r: any) => ({
          name: r.name,
          fameIndex: Number(r.fame_index),
          rank: Number(r.rank),
        })),
        hourlyBreakdown: (hourlyBuckets.rows || []).slice(0, 24).map((r: any) => ({
          hour: new Date(r.hour).toISOString(),
          snapshotCount: Number(r.count),
          uniquePeople: Number(r.unique_people),
          origin: r.origin,
        })),
        rankChurn: await (async () => {
          try {
            const churnRows = await db.execute(sql`
              WITH hourly_latest AS (
                SELECT 
                  ts.person_id,
                  date_trunc('hour', ts.timestamp) as hour,
                  ts.fame_index,
                  ROW_NUMBER() OVER (
                    PARTITION BY ts.person_id, date_trunc('hour', ts.timestamp)
                    ORDER BY ts.timestamp DESC
                  ) as rn
                FROM trend_snapshots ts
                WHERE ts.timestamp > ${h48Ago}
              ),
              deduped AS (
                SELECT person_id, hour, fame_index FROM hourly_latest WHERE rn = 1
              ),
              hours_list AS (
                SELECT DISTINCT hour FROM deduped ORDER BY hour
              ),
              hour_pairs AS (
                SELECT 
                  h.hour as current_hour,
                  LAG(h.hour) OVER (ORDER BY h.hour) as prev_hour
                FROM hours_list h
              ),
              cohort_ranked AS (
                SELECT 
                  hp.current_hour as hour,
                  cur.person_id,
                  cur.fame_index as current_fame,
                  prev.fame_index as prev_fame,
                  RANK() OVER (PARTITION BY hp.current_hour ORDER BY cur.fame_index DESC) as current_rank,
                  RANK() OVER (PARTITION BY hp.current_hour ORDER BY prev.fame_index DESC) as prev_rank,
                  -- IMPORTANT: cast to numeric to avoid integer division truncating to 0
                  CASE WHEN prev.fame_index > 0 
                    THEN ROUND(((cur.fame_index::numeric - prev.fame_index::numeric) / prev.fame_index::numeric * 100), 4)
                    ELSE NULL END as pct_change
                FROM hour_pairs hp
                INNER JOIN deduped cur ON cur.hour = hp.current_hour
                INNER JOIN deduped prev ON prev.hour = hp.prev_hour AND prev.person_id = cur.person_id
                WHERE hp.prev_hour IS NOT NULL
              )
              SELECT 
                hour,
                COUNT(*)::int as cohort_size,
                COUNT(CASE WHEN current_rank != prev_rank THEN 1 END)::int as rank_changes,
                ROUND(AVG(ABS(current_rank - prev_rank))::numeric, 2) as avg_rank_move,
                MAX(ABS(current_rank - prev_rank))::int as max_rank_move,
                ROUND(MIN(pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as min_pct_change,
                ROUND(PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as p10_pct_change,
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as median_pct_change,
                ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as p90_pct_change,
                ROUND(MAX(pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as max_pct_change,
                ROUND(STDDEV(pct_change) FILTER (WHERE pct_change IS NOT NULL)::numeric, 4) as score_volatility_stddev,
                COUNT(CASE WHEN ABS(pct_change) > 5 THEN 1 END)::int as big_movers_5pct,
                COUNT(CASE WHEN ABS(pct_change) > 0.5 OR ABS(current_rank - prev_rank) >= 3 THEN 1 END)::int as meaningful_changes,
                COUNT(CASE WHEN current_rank != prev_rank AND ABS(pct_change) <= 0.5 AND ABS(current_rank - prev_rank) < 3 THEN 1 END)::int as noise_shuffles,
                COUNT(CASE WHEN ABS(pct_change) >= 2 THEN 1 END)::int as movers_2pct
              FROM cohort_ranked
              GROUP BY hour
              ORDER BY hour DESC
              LIMIT 48
            `);
            return (churnRows.rows || []).map((r: any) => ({
              hour: new Date(r.hour).toISOString(),
              cohortSize: Number(r.cohort_size),
              rankChanges: Number(r.rank_changes),
              avgRankMove: Number(r.avg_rank_move) || 0,
              maxRankMove: Number(r.max_rank_move) || 0,
              minPctChange: Number(r.min_pct_change) || 0,
              p10PctChange: Number(r.p10_pct_change) || 0,
              medianPctChange: Number(r.median_pct_change) || 0,
              p90PctChange: Number(r.p90_pct_change) || 0,
              maxPctChange: Number(r.max_pct_change) || 0,
              scoreVolatilityStddev: Number(r.score_volatility_stddev) || 0,
              bigMovers5pct: Number(r.big_movers_5pct) || 0,
              meaningfulChanges: Number(r.meaningful_changes) || 0,
              noiseShuffles: Number(r.noise_shuffles) || 0,
              movers2pct: Number(r.movers_2pct) || 0,
            }));
          } catch (err) {
            return { error: "Failed to compute rank churn" };
          }
        })(),
        emaTuningConfig: {
          EMA_BASE_ALPHA: parseFloat(process.env.EMA_BASE_ALPHA || '0.15'),
          EMA_2_SOURCE_ALPHA: parseFloat(process.env.EMA_2_SOURCE_ALPHA || '0.15'),
          EMA_3_SOURCE_ALPHA: parseFloat(process.env.EMA_3_SOURCE_ALPHA || '0.22'),
          EMA_HIGH_BASELINE_MIN_ALPHA: parseFloat(process.env.EMA_HIGH_BASELINE_MIN_ALPHA || '0.20'),
          EMA_HIGH_BASELINE_VELOCITY_THRESHOLD: parseFloat(process.env.EMA_HIGH_BASELINE_VELOCITY_THRESHOLD || '65'),
          EMA_HIGH_BASELINE_MIN_STRONG_SOURCES: parseFloat(process.env.EMA_HIGH_BASELINE_MIN_STRONG_SOURCES || '2'),
          EMA_DOWNWARD_MULTIPLIER: parseFloat(process.env.EMA_DOWNWARD_MULTIPLIER || '1.2'),
          source: 'env_with_defaults',
        },
      });
    } catch (error: any) {
      console.error("Error fetching engine health:", error.message);
      res.status(500).json({ error: "Failed to fetch engine health diagnostics" });
    }
  });

  // Score audit endpoint - per-person component breakdown for debugging
  app.get("/api/admin/score-audit/:personId", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { personId } = req.params;
      
      const person = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personId)).limit(1);
      if (person.length === 0) {
        return res.status(404).json({ error: "Person not found" });
      }
      
      const trendingEntry = await db.select().from(trendingPeople).where(eq(trendingPeople.name, person[0].name)).limit(1);
      
      const snapshots = await db.select().from(trendSnapshots)
        .where(eq(trendSnapshots.personId, personId))
        .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
        .limit(10);
      
      const healthSnapshot = getCurrentHealthSnapshot();
      
      const snapshotBreakdown = snapshots.map(s => {
        let diag: Record<string, any> | null = null;
        try {
          diag = typeof s.diagnostics === 'string' ? JSON.parse(s.diagnostics) : (s.diagnostics as Record<string, any>);
        } catch { /* malformed diagnostics */ }
        return {
          timestamp: s.timestamp,
          runId: s.runId,
          rawValues: {
            wikiPageviews: s.wikiPageviews,
            newsCount: s.newsCount,
            searchVolume: s.searchVolume,
            wiki7dAvg: diag?.raw?.wiki7d ?? null,
          },
          scores: {
            massScore: s.massScore,
            velocityScore: s.velocityScore,
            velocityAdjusted: s.velocityAdjusted,
            trendScore: s.trendScore,
            fameIndex: s.fameIndex,
          },
          freshness: diag?.fresh ?? null,
          stabilization: diag?.stab ?? null,
          momentum: s.momentum,
          confidence: s.confidence,
          diversityMultiplier: s.diversityMultiplier,
          snapshotOrigin: s.snapshotOrigin,
          diagnostics: diag,
        };
      });
      
      res.json({
        person: {
          id: person[0].id,
          name: person[0].name,
          wikiSlug: person[0].wikiSlug,
          searchQueryOverride: person[0].searchQueryOverride,
        },
        currentRanking: trendingEntry.length > 0 ? {
          fameIndex: trendingEntry[0].fameIndex,
          fameIndexLive: trendingEntry[0].fameIndexLive,
          rank: trendingEntry[0].rank,
          liveRank: trendingEntry[0].liveRank,
          change24h: trendingEntry[0].change24h,
          trendScore: trendingEntry[0].trendScore,
        } : null,
        sourceHealth: {
          news: {
            state: healthSnapshot.news.state,
            lastHealthyTimestamp: healthSnapshot.news.lastHealthyTimestamp,
            consecutiveFailures: healthSnapshot.news.consecutiveFailures,
            reason: healthSnapshot.news.reason,
          },
          search: {
            state: healthSnapshot.search.state,
            lastHealthyTimestamp: healthSnapshot.search.lastHealthyTimestamp,
            consecutiveFailures: healthSnapshot.search.consecutiveFailures,
            reason: healthSnapshot.search.reason,
          },
          wiki: {
            state: healthSnapshot.wiki.state,
            lastHealthyTimestamp: healthSnapshot.wiki.lastHealthyTimestamp,
            consecutiveFailures: healthSnapshot.wiki.consecutiveFailures,
            reason: healthSnapshot.wiki.reason,
          },
        },
        weightConfig: {
          massAllocation: 0.40,
          velocityAllocation: 0.60,
          velocityWeights: { wiki: 0.25, news: 0.35, search: 0.40, x: 0 },
          wikiVelocityBlend: "0.6*24h + 0.4*7d_avg",
          asymmetricCaps: "up=base, down=base*1.5",
          asymmetricEma: "down_alpha=base*1.5",
        },
        last10Snapshots: snapshotBreakdown,
        auditTimestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Score Audit] Error:", error);
      res.status(500).json({ error: "Failed to generate score audit" });
    }
  });

  // Get admin stats
  app.get("/api/admin/stats", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      // Get counts
      const [usersCount] = await db.select({ count: sql<number>`count(*)` }).from(profiles);
      const [celebritiesCount] = await db.select({ count: sql<number>`count(*)` }).from(trackedPeople);
      const [votesCount] = await db.select({ count: sql<number>`count(*)` }).from(votes);
      
      res.json({
        totalUsers: Number(usersCount?.count || 0),
        totalCelebrities: Number(celebritiesCount?.count || 0),
        totalVotes: Number(votesCount?.count || 0),
        totalPredictions: 0,
        lastDataRefresh: null,
      });
    } catch (error: any) {
      console.error("Error fetching admin stats:", error.message);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Get traffic stats for admin dashboard
  app.get("/api/admin/traffic", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      // Single aggregated query for all counts (more efficient than multiple queries)
      const [stats] = await db.select({
        total: sql<number>`count(*)`,
        today: sql<number>`count(*) FILTER (WHERE ${pageViews.createdAt} >= ${today})`,
        last7Days: sql<number>`count(*) FILTER (WHERE ${pageViews.createdAt} >= ${sevenDaysAgo})`,
        last30Days: sql<number>`count(*) FILTER (WHERE ${pageViews.createdAt} >= ${thirtyDaysAgo})`,
      }).from(pageViews);
      
      // Top pages (last 7 days) - separate query with limit
      const topPages = await db.select({
        path: pageViews.path,
        views: sql<number>`count(*)`,
      })
        .from(pageViews)
        .where(gte(pageViews.createdAt, sevenDaysAgo))
        .groupBy(pageViews.path)
        .orderBy(sql`count(*) DESC`)
        .limit(5);
      
      res.json({
        total: Number(stats?.total || 0),
        today: Number(stats?.today || 0),
        last7Days: Number(stats?.last7Days || 0),
        last30Days: Number(stats?.last30Days || 0),
        topPages: topPages.map(p => ({ path: p.path, views: Number(p.views) })),
      });
    } catch (error: any) {
      console.error("Error fetching traffic stats:", error.message);
      res.status(500).json({ error: "Failed to fetch traffic stats" });
    }
  });
  
  // ============ ENTITY RESOLUTION DIAGNOSTICS ============
  
  app.get("/api/admin/diagnostics/entity/:personId", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runEntityDiagnostic } = await import("./diagnostics/entity-resolution");
      const result = await runEntityDiagnostic(req.params.personId);
      if (!result) {
        return res.status(404).json({ error: "Person not found" });
      }
      res.json(result);
    } catch (error: any) {
      console.error("Entity diagnostic error:", error.message);
      res.status(500).json({ error: "Failed to run entity diagnostic" });
    }
  });

  app.post("/api/admin/diagnostics/entity-batch", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runBatchEntityDiagnostic } = await import("./diagnostics/entity-resolution");
      const personIds = req.body?.personIds as string[] | undefined;
      const results = await runBatchEntityDiagnostic(personIds);
      res.json({ results, total: results.length });
    } catch (error: any) {
      console.error("Batch entity diagnostic error:", error.message);
      res.status(500).json({ error: "Failed to run batch entity diagnostic" });
    }
  });

  // Refresh data (trigger data ingestion)
  app.post("/api/admin/refresh-data", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runDataIngestion } = await import("./jobs/ingest");
      const result = await runDataIngestion();
      res.json({ 
        success: true, 
        message: "Data refresh completed",
        processed: result.processed,
        errors: result.errors,
        duration: result.duration,
      });
    } catch (error: any) {
      console.error("Error refreshing data:", error.message);
      res.status(500).json({ error: "Failed to refresh data" });
    }
  });
  
  // Run scoring engine PREVIEW (computes scores from cached API data WITHOUT writing to DB)
  // NOTE: This is a preview-only endpoint. Only ingest.ts writes to trending_people.
  app.post("/api/admin/run-scoring", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runQuickScoring } = await import("./jobs/quick-score");
      const result = await runQuickScoring();
      res.json({ 
        success: true, 
        message: "Scoring PREVIEW complete (NOT written to DB - only ingest.ts writes)",
        processed: result.processed,
        errors: result.errors,
        healthSummary: result.healthSummary,
        previewResults: result.results.slice(0, 20), // Return top 20 for preview
      });
    } catch (error: any) {
      console.error("Error running scoring preview:", error.message);
      res.status(500).json({ error: "Failed to run scoring preview" });
    }
  });

  // Seed approval data for "Cast Your Vote" widget (Approval Leaderboard)
  app.post("/api/admin/seed-approval", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { seedApprovalData } = await import("./seed-approval-data");
      const result = await seedApprovalData();
      
      // Log the admin action
      const adminId = req.userId!;
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: "admin",
        actionType: "seed_approval_data",
        targetTable: "user_votes",
        targetId: "approval-leaderboard",
        metadata: { seeded: result.seeded, skipped: result.skipped, errors: result.errors.length },
      });
      
      res.json({
        success: result.success,
        message: `Seeded ${result.seeded} celebrities, skipped ${result.skipped}`,
        seeded: result.seeded,
        skipped: result.skipped,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error("Seed approval error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Clear seed approval data
  app.post("/api/admin/clear-seed-approval", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { clearSeedApprovalData } = await import("./seed-approval-data");
      const result = await clearSeedApprovalData();
      res.json(result);
    } catch (error: any) {
      console.error("Clear seed approval error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Capture snapshots (admin version - uses session auth)
  app.post("/api/admin/capture-snapshots", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { captureHourlySnapshots } = await import("./jobs/snapshot-scheduler");
      const result = await captureHourlySnapshots();
      res.json({ 
        success: true, 
        message: "Snapshots captured",
        captured: result.captured,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error("Error capturing snapshots:", error.message);
      res.status(500).json({ error: "Failed to capture snapshots" });
    }
  });

  // Admin image upload to Supabase Storage
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only PNG, JPG, and WEBP files are allowed'));
      }
    },
  });

  app.post("/api/admin/upload-image", requireAuth, requireAdmin, upload.single('file'), async (req: AuthRequest, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const moduleName = (req.body.moduleName as string) || "general";
      const slugOrId = (req.body.slugOrId as string) || "unnamed";
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      const timestamp = Date.now();
      const filePath = `${moduleName}/${slugOrId}/${timestamp}${ext}`;
      const bucketName = "public-images";

      const { data: buckets } = await supabaseServer.storage.listBuckets();
      const bucketExists = buckets?.some(b => b.name === bucketName);
      if (!bucketExists) {
        const { error: createError } = await supabaseServer.storage.createBucket(bucketName, {
          public: true,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          fileSizeLimit: 2 * 1024 * 1024,
        });
        if (createError) {
          console.error("Failed to create bucket:", createError);
          return res.status(500).json({ error: "Failed to create storage bucket" });
        }
      }

      const { data, error } = await supabaseServer.storage
        .from(bucketName)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        console.error("Supabase upload error:", error);
        return res.status(500).json({ error: "Failed to upload image" });
      }

      const { data: urlData } = supabaseServer.storage
        .from(bucketName)
        .getPublicUrl(filePath);

      res.json({ url: urlData.publicUrl, path: filePath });
    } catch (error: any) {
      console.error("Upload error:", error);
      if (error.message?.includes('Only PNG')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // Get all users (for admin moderation)
  app.get("/api/admin/users", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const search = (req.query.search as string) || "";
      
      let users;
      if (search) {
        users = await db.select().from(profiles)
          .where(sql`${profiles.username} ILIKE ${'%' + search + '%'} OR ${profiles.fullName} ILIKE ${'%' + search + '%'}`)
          .limit(100);
      } else {
        users = await db.select().from(profiles).limit(100);
      }
      
      res.json(users.map(u => ({
        id: u.id,
        username: u.username,
        fullName: u.fullName,
        role: u.role,
        rank: u.rank,
        xpPoints: u.xpPoints,
        predictCredits: u.predictCredits,
        totalVotes: u.totalVotes,
        totalPredictions: u.totalPredictions,
        createdAt: u.createdAt,
        isBanned: u.role === 'banned',
      })));
    } catch (error: any) {
      console.error("Error fetching users:", error.message);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Adjust user credits (with audit logging) - uses transaction for consistency
  app.post("/api/admin/adjust-credits", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const adminId = req.userId!;
      const { userId, amount, reason } = req.body;
      
      if (!userId || amount === undefined || !reason) {
        return res.status(400).json({ error: "userId, amount, and reason are required" });
      }
      
      // Get current user balance
      const [user] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const newBalance = Math.max(0, user.predictCredits + amount);
      const idempotencyKey = `admin_adjust_${adminId}_${userId}_${Date.now()}`;
      
      // Use transaction to ensure ledger and profile stay in sync
      await db.transaction(async (tx) => {
        // Create credit ledger entry
        await tx.insert(creditLedger).values({
          userId,
          txnType: 'admin_adjustment',
          amount,
          walletType: 'VIRTUAL',
          balanceAfter: newBalance,
          source: 'admin',
          idempotencyKey,
          metadata: { reason, adjustedBy: adminId },
        });
        
        // Update user balance
        await tx.update(profiles).set({ predictCredits: newBalance }).where(eq(profiles.id, userId));
        
        // Audit log
        await tx.insert(adminAuditLog).values({
          adminId,
          actionType: 'adjust_credits',
          targetTable: 'profiles',
          targetId: userId,
          previousData: { predictCredits: user.predictCredits },
          newData: { predictCredits: newBalance },
          metadata: { amount, reason },
        });
      });
      
      res.json({ success: true, newBalance });
    } catch (error: any) {
      console.error("Error adjusting credits:", error.message);
      res.status(500).json({ error: "Failed to adjust credits" });
    }
  });

  // Ban user (with audit logging)
  app.post("/api/admin/ban-user", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const adminId = req.userId!;
      const { userId, reason } = req.body;
      
      if (!userId || !reason) {
        return res.status(400).json({ error: "userId and reason are required" });
      }
      
      // Get user
      const [user] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Can't ban admins
      if (user.role === 'admin') {
        return res.status(403).json({ error: "Cannot ban admin users" });
      }
      
      // Update role to banned
      await db.update(profiles).set({ role: 'banned' }).where(eq(profiles.id, userId));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        actionType: 'ban_user',
        targetTable: 'profiles',
        targetId: userId,
        previousData: { role: user.role },
        newData: { role: 'banned' },
        metadata: { reason },
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error banning user:", error.message);
      res.status(500).json({ error: "Failed to ban user" });
    }
  });

  // Get prediction markets (for admin CMS)
  app.get("/api/admin/markets", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const markets = await db.select().from(predictionMarkets).orderBy(desc(predictionMarkets.createdAt));
      res.json(markets);
    } catch (error: any) {
      console.error("Error fetching markets:", error.message);
      res.status(500).json({ error: "Failed to fetch markets" });
    }
  });

  // Get audit log entries
  app.get("/api/admin/audit-log", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { limit: limitParam, actionType, targetTable } = req.query;
      const limitNum = Math.min(parseInt(limitParam as string) || 50, 200);
      
      let query = db.select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(limitNum);
      
      const logs = await query;
      
      // Filter in JS for simplicity (small dataset)
      let filteredLogs = logs;
      if (actionType && typeof actionType === 'string') {
        filteredLogs = filteredLogs.filter(log => log.actionType === actionType);
      }
      if (targetTable && typeof targetTable === 'string') {
        filteredLogs = filteredLogs.filter(log => log.targetTable === targetTable);
      }
      
      res.json(filteredLogs);
    } catch (error: any) {
      console.error("Error fetching audit log:", error.message);
      res.status(500).json({ error: "Failed to fetch audit log" });
    }
  });

  // Get all celebrities for management
  app.get("/api/admin/celebrities", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { search, status } = req.query;
      
      let celebrities = await db.select().from(trackedPeople).orderBy(trackedPeople.name);
      
      if (search && typeof search === 'string') {
        const searchLower = search.toLowerCase();
        celebrities = celebrities.filter(c => 
          c.name.toLowerCase().includes(searchLower) ||
          (c.category && c.category.toLowerCase().includes(searchLower))
        );
      }
      
      if (status && typeof status === 'string') {
        celebrities = celebrities.filter(c => c.status === status);
      }
      
      res.json(celebrities);
    } catch (error: any) {
      console.error("Error fetching celebrities:", error.message);
      res.status(500).json({ error: "Failed to fetch celebrities" });
    }
  });

  // Update celebrity
  app.patch("/api/admin/celebrities/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { name, category, status, wikiSlug, xHandle, avatar, searchQueryOverride } = req.body;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Celebrity not found" });
      }
      
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (category !== undefined) updates.category = category;
      if (status !== undefined) updates.status = status;
      if (wikiSlug !== undefined) updates.wikiSlug = wikiSlug;
      if (xHandle !== undefined) updates.xHandle = xHandle;
      if (avatar !== undefined) updates.avatar = avatar;
      if (searchQueryOverride !== undefined) updates.searchQueryOverride = searchQueryOverride || null;
      
      await db.update(trackedPeople).set(updates).where(eq(trackedPeople.id, id));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'update_celebrity',
        targetTable: 'tracked_people',
        targetId: id,
        previousData: existing,
        newData: updates,
      });
      
      const [updated] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, id));
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating celebrity:", error.message);
      res.status(500).json({ error: "Failed to update celebrity" });
    }
  });

  // Delete celebrity
  app.delete("/api/admin/celebrities/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Celebrity not found" });
      }
      
      await db.delete(trackedPeople).where(eq(trackedPeople.id, id));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_celebrity',
        targetTable: 'tracked_people',
        targetId: id,
        previousData: existing,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting celebrity:", error.message);
      res.status(500).json({ error: "Failed to delete celebrity" });
    }
  });

  // ============ ADMIN: SCORE BREAKDOWN (Why Did This Move?) ============
  app.get("/api/admin/celebrities/:id/score-breakdown", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      // Get celebrity
      const [celebrity] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, id));
      if (!celebrity) {
        return res.status(404).json({ error: "Celebrity not found" });
      }
      
      // Get latest 2 on-hour snapshots for this celebrity (current + previous hour)
      const recentSnapshots = await db.select()
        .from(trendSnapshots)
        .where(and(
          eq(trendSnapshots.personId, id),
          sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
          eq(trendSnapshots.snapshotOrigin, 'ingest')
        ))
        .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
        .limit(2);
      
      const latestSnapshot = recentSnapshots[0];
      const previousSnapshot = recentSnapshots[1] || null;
      
      if (!latestSnapshot) {
        return res.status(404).json({ error: "No snapshot data found for this celebrity" });
      }
      
      // Get current rank from leaderboard
      const allSnapshots = await db.select({
        personId: trendSnapshots.personId,
        fameIndex: trendSnapshots.fameIndex,
      })
        .from(trendSnapshots)
        .where(sql`timestamp = date_trunc('hour', timestamp) AND snapshot_origin = 'ingest' AND timestamp = (SELECT MAX(timestamp) FROM trend_snapshots ts2 WHERE ts2.person_id = trend_snapshots.person_id AND ts2.timestamp = date_trunc('hour', ts2.timestamp) AND ts2.snapshot_origin = 'ingest')`)
        .orderBy(desc(trendSnapshots.fameIndex));
      
      const currentRank = allSnapshots.findIndex(s => s.personId === id) + 1;
      
      // Get previous rank from previous snapshot's fame index
      let previousRank = currentRank;
      if (previousSnapshot) {
        const prevAllSnapshots = await db.execute(sql`
          SELECT person_id, fame_index 
          FROM trend_snapshots 
          WHERE timestamp = date_trunc('hour', timestamp)
            AND snapshot_origin = 'ingest'
            AND timestamp = (
              SELECT MAX(timestamp) FROM trend_snapshots 
              WHERE timestamp < ${latestSnapshot.timestamp}
                AND timestamp = date_trunc('hour', timestamp)
                AND snapshot_origin = 'ingest'
            )
          ORDER BY fame_index DESC
        `);
        const prevRankIndex = (prevAllSnapshots.rows as any[]).findIndex(s => s.person_id === id);
        previousRank = prevRankIndex >= 0 ? prevRankIndex + 1 : currentRank;
      }
      
      // Get 24h historical on-hour snapshots for the chart
      const time24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const historicalSnapshots = await db.select({
        timestamp: trendSnapshots.timestamp,
        fameIndex: trendSnapshots.fameIndex,
        trendScore: trendSnapshots.trendScore,
        wikiPageviews: trendSnapshots.wikiPageviews,
        newsCount: trendSnapshots.newsCount,
        searchVolume: trendSnapshots.searchVolume,
      })
        .from(trendSnapshots)
        .where(and(
          eq(trendSnapshots.personId, id),
          gte(trendSnapshots.timestamp, time24hAgo),
          sql`${trendSnapshots.timestamp} = date_trunc('hour', ${trendSnapshots.timestamp})`,
          eq(trendSnapshots.snapshotOrigin, 'ingest')
        ))
        .orderBy(trendSnapshots.timestamp);
      
      // Get population stats for percentile comparison
      const sourceStats = await getSourceStats();
      
      // Raw inputs from latest snapshot
      const rawInputs = {
        wikiPageviews: latestSnapshot.wikiPageviews || 0,
        newsCount: latestSnapshot.newsCount || 0,
        searchVolume: latestSnapshot.searchVolume || 0,
      };
      
      // Calculate normalized percentiles for each source
      const normalizedPercentiles = {
        wiki: normalizeSourceValue(rawInputs.wikiPageviews, sourceStats.wiki),
        news: normalizeSourceValue(rawInputs.newsCount, sourceStats.news),
        search: normalizeSourceValue(rawInputs.searchVolume, sourceStats.search),
      };
      
      // Get 7-day baselines for this celebrity for spike detection
      const time7dAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const baselineResult = await db.execute(sql`
        SELECT 
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wiki_pageviews) as wiki_p50,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY news_count) as news_p50,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY search_volume) as search_p50
        FROM trend_snapshots
        WHERE person_id = ${id}
          AND timestamp >= ${time7dAgo}
          AND timestamp = date_trunc('hour', timestamp)
          AND snapshot_origin = 'ingest'
      `);
      
      const baselines = {
        wiki: Number((baselineResult.rows[0] as any)?.wiki_p50) || rawInputs.wikiPageviews,
        news: Number((baselineResult.rows[0] as any)?.news_p50) || rawInputs.newsCount,
        search: Number((baselineResult.rows[0] as any)?.search_p50) || rawInputs.searchVolume,
      };
      
      // Check spike status for each source
      const spikeStatus = {
        wiki: isSourceSpiking(rawInputs.wikiPageviews, baselines.wiki, 1.5, SPIKE_MIN_DELTA.wiki),
        news: isSourceSpiking(rawInputs.newsCount, baselines.news, 1.5, SPIKE_MIN_DELTA.news),
        search: isSourceSpiking(rawInputs.searchVolume, baselines.search, 1.5, SPIKE_MIN_DELTA.search),
      };
      
      const spikingSourceCount = Object.values(spikeStatus).filter(Boolean).length;
      
      // Stabilization parameters based on spike count
      const stabilizationParams = {
        spikingSourceCount,
        effectiveRateCap: getDynamicRateLimit(spikingSourceCount),
        effectiveAlpha: getDynamicAlpha(spikingSourceCount),
        isRecalibrationActive: isRecalibrationModeActive(),
      };
      
      // Final score breakdown
      const scoreBreakdown = {
        massScore: latestSnapshot.massScore || 0,
        velocityScore: latestSnapshot.velocityScore || 0,
        velocityAdjusted: latestSnapshot.velocityAdjusted || 0,
        diversityMultiplier: latestSnapshot.diversityMultiplier || 1.0,
        trendScore: latestSnapshot.trendScore,
        fameIndex: latestSnapshot.fameIndex || 0,
        momentum: latestSnapshot.momentum,
        drivers: latestSnapshot.drivers,
      };
      
      // Weights configuration
      const weights = {
        mass: MASS_ALLOCATION,
        velocity: VELOCITY_ALLOCATION,
        velocityBreakdown: {
          wiki: PLATFORM_WEIGHTS.velocity.wiki,
          news: PLATFORM_WEIGHTS.velocity.news,
          search: PLATFORM_WEIGHTS.velocity.search,
        },
      };
      
      // Population stats for context
      const populationStats = {
        wiki: sourceStats.wiki,
        news: sourceStats.news,
        search: sourceStats.search,
      };
      
      // Previous hour comparison for quick debugging
      const prevFameIndex = previousSnapshot?.fameIndex ?? 0;
      const currFameIndex = latestSnapshot.fameIndex ?? 0;
      const previousHourComparison = previousSnapshot ? {
        previousFameIndex: prevFameIndex,
        rawFameIndexBeforeStabilization: currFameIndex, // Using final since raw isn't stored
        currentFameIndex: currFameIndex,
        rawChangePercent: prevFameIndex > 0 
          ? ((currFameIndex - prevFameIndex) / prevFameIndex) * 100 
          : 0,
        finalChangePercent: prevFameIndex > 0 
          ? ((currFameIndex - prevFameIndex) / prevFameIndex) * 100 
          : 0,
        wasRateLimited: false, // Rate limiting flag not stored in schema
        previousRank,
        currentRank,
      } : null;
      
      // Source freshness (when was each source last updated)
      const sourceFreshness = {
        wiki: {
          lastUpdated: latestSnapshot.timestamp,
          value: latestSnapshot.wikiPageviews || 0,
          isStale: false, // Within the same snapshot, considered fresh
        },
        news: {
          lastUpdated: latestSnapshot.timestamp,
          value: latestSnapshot.newsCount || 0,
          isStale: false,
        },
        search: {
          lastUpdated: latestSnapshot.timestamp,
          value: latestSnapshot.searchVolume || 0,
          isStale: false,
        },
      };
      
      res.json({
        celebrity: {
          id: celebrity.id,
          name: celebrity.name,
          category: celebrity.category,
          avatar: celebrity.avatar,
        },
        snapshotTimestamp: latestSnapshot.timestamp,
        rawInputs,
        baselines,
        normalizedPercentiles,
        spikeStatus,
        stabilizationParams,
        scoreBreakdown,
        weights,
        populationStats,
        historicalSnapshots,
        previousHourComparison,
        sourceFreshness,
        currentRank,
      });
    } catch (error: any) {
      console.error("Error fetching score breakdown:", error.message);
      res.status(500).json({ error: "Failed to fetch score breakdown" });
    }
  });

  // Add new celebrity
  app.post("/api/admin/celebrities", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { name, category, status, wikiSlug, xHandle, avatar, searchQueryOverride } = req.body;
      const adminId = req.userId!;
      
      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }
      
      const [created] = await db.insert(trackedPeople).values({
        name,
        category: category || 'Other',
        status: status || 'main_leaderboard',
        wikiSlug: wikiSlug || null,
        xHandle: xHandle || null,
        avatar: avatar || null,
        searchQueryOverride: searchQueryOverride || null,
      }).returning();
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'create_celebrity',
        targetTable: 'tracked_people',
        targetId: created.id,
        newData: created,
      });
      
      res.json(created);
    } catch (error: any) {
      console.error("Error creating celebrity:", error.message);
      res.status(500).json({ error: "Failed to create celebrity" });
    }
  });

  // Get celebrity images for management
  app.get("/api/admin/celebrities/:id/images", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const images = await db.select().from(celebrityImages)
        .where(eq(celebrityImages.personId, id))
        .orderBy(desc(celebrityImages.isPrimary), desc(sql`(${celebrityImages.votesUp} - ${celebrityImages.votesDown})`));
      res.json(images);
    } catch (error: any) {
      console.error("Error fetching celebrity images:", error.message);
      res.status(500).json({ error: "Failed to fetch images" });
    }
  });

  // Add celebrity image
  app.post("/api/admin/celebrities/:id/images", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { imageUrl, isPrimary } = req.body;
      const adminId = req.userId!;
      
      if (!imageUrl) {
        return res.status(400).json({ error: "Image URL is required" });
      }
      
      // If setting as primary, unset all other primary images
      if (isPrimary) {
        await db.update(celebrityImages).set({ isPrimary: false }).where(eq(celebrityImages.personId, id));
      }
      
      const [created] = await db.insert(celebrityImages).values({
        personId: id,
        imageUrl,
        isPrimary: isPrimary || false,
      }).returning();
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'add_celebrity_image',
        targetTable: 'celebrity_images',
        targetId: created.id,
        newData: created,
      });
      
      res.json(created);
    } catch (error: any) {
      console.error("Error adding celebrity image:", error.message);
      res.status(500).json({ error: "Failed to add image" });
    }
  });

  // Delete celebrity image
  app.delete("/api/admin/celebrities/:id/images/:imageId", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id, imageId } = req.params;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(celebrityImages)
        .where(and(eq(celebrityImages.id, imageId), eq(celebrityImages.personId, id)));
      
      if (!existing) {
        return res.status(404).json({ error: "Image not found" });
      }
      
      await db.delete(celebrityImages).where(eq(celebrityImages.id, imageId));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_celebrity_image',
        targetTable: 'celebrity_images',
        targetId: imageId,
        previousData: existing,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting celebrity image:", error.message);
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  // Set primary celebrity image
  app.post("/api/admin/celebrities/:id/images/:imageId/set-primary", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id, imageId } = req.params;
      const adminId = req.userId!;
      
      // Unset all primary images for this celebrity
      await db.update(celebrityImages).set({ isPrimary: false }).where(eq(celebrityImages.personId, id));
      
      // Set the new primary
      await db.update(celebrityImages).set({ isPrimary: true }).where(eq(celebrityImages.id, imageId));
      
      // Also update the main avatar on tracked_people
      const [image] = await db.select().from(celebrityImages).where(eq(celebrityImages.id, imageId));
      if (image) {
        await db.update(trackedPeople).set({ avatar: image.imageUrl }).where(eq(trackedPeople.id, id));
      }
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'set_primary_image',
        targetTable: 'celebrity_images',
        targetId: imageId,
        metadata: { personId: id },
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error setting primary image:", error.message);
      res.status(500).json({ error: "Failed to set primary image" });
    }
  });

  // Get community insights for moderation
  app.get("/api/admin/moderation/insights", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { status } = req.query;
      
      let insights = await db.select({
        id: communityInsights.id,
        personId: communityInsights.personId,
        userId: communityInsights.userId,
        content: communityInsights.content,
        createdAt: communityInsights.createdAt,
        upvotes: sql<number>`(SELECT COUNT(*) FROM insight_votes WHERE insight_id = ${communityInsights.id} AND vote_type = 'up')`,
        downvotes: sql<number>`(SELECT COUNT(*) FROM insight_votes WHERE insight_id = ${communityInsights.id} AND vote_type = 'down')`,
      }).from(communityInsights).orderBy(desc(communityInsights.createdAt)).limit(100);
      
      res.json(insights);
    } catch (error: any) {
      console.error("Error fetching insights for moderation:", error.message);
      res.status(500).json({ error: "Failed to fetch insights" });
    }
  });

  // Delete community insight (moderation)
  app.delete("/api/admin/moderation/insights/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(communityInsights).where(eq(communityInsights.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Insight not found" });
      }
      
      // Delete associated votes and comments first
      await db.delete(insightVotes).where(eq(insightVotes.insightId, id));
      await db.delete(insightComments).where(eq(insightComments.insightId, id));
      await db.delete(communityInsights).where(eq(communityInsights.id, id));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_insight',
        targetTable: 'community_insights',
        targetId: id,
        previousData: existing,
        metadata: { reason },
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting insight:", error.message);
      res.status(500).json({ error: "Failed to delete insight" });
    }
  });

  // Get comments for moderation
  app.get("/api/admin/moderation/comments", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const comments = await db.select({
        id: insightComments.id,
        insightId: insightComments.insightId,
        userId: insightComments.userId,
        content: insightComments.content,
        createdAt: insightComments.createdAt,
      }).from(insightComments).orderBy(desc(insightComments.createdAt)).limit(100);
      
      res.json(comments);
    } catch (error: any) {
      console.error("Error fetching comments for moderation:", error.message);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  // Delete comment (moderation)
  app.delete("/api/admin/moderation/comments/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(insightComments).where(eq(insightComments.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Comment not found" });
      }
      
      // Delete associated votes first
      await db.delete(commentVotes).where(eq(commentVotes.commentId, id));
      await db.delete(insightComments).where(eq(insightComments.id, id));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_comment',
        targetTable: 'insight_comments',
        targetId: id,
        previousData: existing,
        metadata: { reason },
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting comment:", error.message);
      res.status(500).json({ error: "Failed to delete comment" });
    }
  });

  // Matchups CRUD
  app.get("/api/admin/matchups", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const matchupList = await db.select().from(matchups).orderBy(matchups.displayOrder, desc(matchups.createdAt));
      res.json(matchupList);
    } catch (error: any) {
      console.error("Error fetching matchups:", error.message);
      res.status(500).json({ error: "Failed to fetch matchups" });
    }
  });

  app.post("/api/admin/matchups", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { title, category, optionAText, optionAImage, optionBText, optionBImage, isActive, visibility, featured, slug, personAId, personBId, promptText, seedVotesA, seedVotesB } = req.body;
      const adminId = req.userId!;
      
      if (!title || !optionAText || !optionBText) {
        return res.status(400).json({ error: "Title and both options are required" });
      }
      
      // Get next display order
      const [maxOrder] = await db.select({ max: sql<number>`COALESCE(MAX(display_order), 0)` }).from(matchups);
      const nextOrder = (maxOrder?.max || 0) + 1;
      
      const effectiveVisibility = visibility || 'live';
      const [created] = await db.insert(matchups).values({
        title,
        category: category || 'General',
        optionAText,
        optionAImage: optionAImage || null,
        optionBText,
        optionBImage: optionBImage || null,
        isActive: effectiveVisibility === 'live',
        displayOrder: nextOrder,
        visibility: effectiveVisibility,
        featured: featured || false,
        slug: slug || null,
        personAId: personAId || null,
        personBId: personBId || null,
        promptText: promptText || null,
        seedVotesA: parseInt(seedVotesA) || 0,
        seedVotesB: parseInt(seedVotesB) || 0,
      }).returning();
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'create_faceoff',
        targetTable: 'face_offs',
        targetId: created.id,
        newData: created,
      });
      
      res.json(created);
    } catch (error: any) {
      console.error("Error creating matchup:", error.message);
      res.status(500).json({ error: "Failed to create matchup" });
    }
  });

  app.get("/api/admin/matchups/check-slug", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { slug, excludeId } = req.query;
      if (!slug) return res.json({ available: false });
      
      const results = await db.select({ id: matchups.id }).from(matchups).where(eq(matchups.slug, slug as string));
      
      const available = results.length === 0 || (excludeId && results.length === 1 && results[0].id === excludeId);
      res.json({ available });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to check slug" });
    }
  });

  app.patch("/api/admin/matchups/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { title, category, optionAText, optionAImage, optionBText, optionBImage, isActive, displayOrder, visibility, featured, slug, personAId, personBId, promptText, seedVotesA, seedVotesB } = req.body;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(matchups).where(eq(matchups.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Matchup not found" });
      }
      
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (category !== undefined) updates.category = category;
      if (optionAText !== undefined) updates.optionAText = optionAText;
      if (optionAImage !== undefined) updates.optionAImage = optionAImage;
      if (optionBText !== undefined) updates.optionBText = optionBText;
      if (optionBImage !== undefined) updates.optionBImage = optionBImage;
      if (isActive !== undefined) { updates.isActive = isActive; updates.visibility = isActive ? 'live' : 'inactive'; }
      if (displayOrder !== undefined) updates.displayOrder = displayOrder;
      if (visibility !== undefined) { updates.visibility = visibility; updates.isActive = visibility === 'live'; }
      if (featured !== undefined) updates.featured = featured;
      if (slug !== undefined) updates.slug = slug;
      if (personAId !== undefined) updates.personAId = personAId;
      if (personBId !== undefined) updates.personBId = personBId;
      if (promptText !== undefined) updates.promptText = promptText;
      if (seedVotesA !== undefined) updates.seedVotesA = parseInt(seedVotesA) || 0;
      if (seedVotesB !== undefined) updates.seedVotesB = parseInt(seedVotesB) || 0;
      
      await db.update(matchups).set(updates).where(eq(matchups.id, id));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'update_faceoff',
        targetTable: 'face_offs',
        targetId: id,
        previousData: existing,
        newData: updates,
      });
      
      const [updated] = await db.select().from(matchups).where(eq(matchups.id, id));
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating matchup:", error.message);
      res.status(500).json({ error: "Failed to update matchup" });
    }
  });

  app.delete("/api/admin/matchups/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(matchups).where(eq(matchups.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Matchup not found" });
      }
      
      // Delete associated votes first
      await db.delete(votes).where(and(eq(votes.voteType, 'face_off'), eq(votes.targetId, id)));
      await db.delete(matchups).where(eq(matchups.id, id));
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_faceoff',
        targetTable: 'face_offs',
        targetId: id,
        previousData: existing,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting matchup:", error.message);
      res.status(500).json({ error: "Failed to delete matchup" });
    }
  });

  // Reorder matchups
  app.post("/api/admin/matchups/reorder", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { orderedIds } = req.body;
      const adminId = req.userId!;
      
      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: "orderedIds must be an array" });
      }
      
      // Update each matchup with its new order
      for (let i = 0; i < orderedIds.length; i++) {
        await db.update(matchups).set({ displayOrder: i + 1 }).where(eq(matchups.id, orderedIds[i]));
      }
      
      // Audit log
      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'reorder_faceoffs',
        targetTable: 'face_offs',
        targetId: 'bulk',
        newData: { orderedIds },
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error reordering matchups:", error.message);
      res.status(500).json({ error: "Failed to reorder matchups" });
    }
  });

  // ===========================================
  // PUBLIC: TRENDING POLLS
  // ===========================================

  app.get("/api/trending-polls", async (req, res) => {
    try {
      const polls = await db
        .select({
          id: trendingPolls.id,
          headline: trendingPolls.headline,
          subjectText: trendingPolls.subjectText,
          description: trendingPolls.description,
          category: trendingPolls.category,
          personId: trendingPolls.personId,
          imageUrl: trendingPolls.imageUrl,
          slug: trendingPolls.slug,
          seedSupportCount: trendingPolls.seedSupportCount,
          seedNeutralCount: trendingPolls.seedNeutralCount,
          seedOpposeCount: trendingPolls.seedOpposeCount,
          status: trendingPolls.status,
          createdAt: trendingPolls.createdAt,
          personName: trackedPeople.name,
          personAvatar: trackedPeople.avatar,
        })
        .from(trendingPolls)
        .leftJoin(trackedPeople, eq(trendingPolls.personId, trackedPeople.id))
        .where(eq(trendingPolls.status, 'live'))
        .orderBy(desc(trendingPolls.createdAt));

      const result = polls.map(p => {
        const total = (p.seedSupportCount || 0) + (p.seedNeutralCount || 0) + (p.seedOpposeCount || 0);
        return {
          id: p.id,
          headline: p.headline,
          subjectText: p.subjectText,
          description: p.description,
          category: p.category,
          personId: p.personId,
          personName: p.personName || null,
          personAvatar: p.personAvatar || null,
          imageUrl: p.imageUrl,
          slug: p.slug || null,
          totalVotes: total,
          approvePercent: total > 0 ? Math.round(((p.seedSupportCount || 0) / total) * 100) : 0,
          neutralPercent: total > 0 ? Math.round(((p.seedNeutralCount || 0) / total) * 100) : 0,
          disapprovePercent: total > 0 ? Math.round(((p.seedOpposeCount || 0) / total) * 100) : 0,
          status: p.status,
        };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching public trending polls:", error.message);
      res.status(500).json({ error: "Failed to fetch trending polls" });
    }
  });

  // ===========================================
  // PUBLIC: TRENDING POLL DETAIL (by slug)
  // ===========================================

  app.get("/api/polls/:slug", optionalAuth, async (req, res) => {
    try {
      const { slug } = req.params;
      const authReq = req as AuthRequest;
      const userId = authReq.userId || null;

      const [poll] = await db
        .select({
          id: trendingPolls.id,
          headline: trendingPolls.headline,
          subjectText: trendingPolls.subjectText,
          description: trendingPolls.description,
          category: trendingPolls.category,
          personId: trendingPolls.personId,
          imageUrl: trendingPolls.imageUrl,
          slug: trendingPolls.slug,
          featured: trendingPolls.featured,
          visibility: trendingPolls.visibility,
          status: trendingPolls.status,
          timeline: trendingPolls.timeline,
          deadlineAt: trendingPolls.deadlineAt,
          seedSupportCount: trendingPolls.seedSupportCount,
          seedNeutralCount: trendingPolls.seedNeutralCount,
          seedOpposeCount: trendingPolls.seedOpposeCount,
          createdAt: trendingPolls.createdAt,
          personName: trackedPeople.name,
          personAvatar: trackedPeople.avatar,
        })
        .from(trendingPolls)
        .leftJoin(trackedPeople, eq(trendingPolls.personId, trackedPeople.id))
        .where(eq(trendingPolls.slug, slug))
        .limit(1);

      if (!poll) {
        return res.status(404).json({ error: "Poll not found" });
      }

      const realVotes = await db
        .select({
          choice: trendingPollVotes.choice,
          cnt: count(),
        })
        .from(trendingPollVotes)
        .where(eq(trendingPollVotes.pollId, poll.id))
        .groupBy(trendingPollVotes.choice);

      const realCounts: Record<string, number> = {};
      for (const rv of realVotes) {
        realCounts[rv.choice] = Number(rv.cnt);
      }

      const supportCount = (poll.seedSupportCount || 0) + (realCounts['support'] || 0);
      const neutralCount = (poll.seedNeutralCount || 0) + (realCounts['neutral'] || 0);
      const opposeCount = (poll.seedOpposeCount || 0) + (realCounts['oppose'] || 0);
      const totalVotes = supportCount + neutralCount + opposeCount;

      let userVote: string | null = null;
      if (userId) {
        const [uv] = await db
          .select({ choice: trendingPollVotes.choice })
          .from(trendingPollVotes)
          .where(and(
            eq(trendingPollVotes.pollId, poll.id),
            eq(trendingPollVotes.userId, userId)
          ))
          .limit(1);
        if (uv) userVote = uv.choice;
      }

      res.json({
        ...poll,
        supportCount,
        neutralCount,
        opposeCount,
        totalVotes,
        approvePercent: totalVotes > 0 ? Math.round((supportCount / totalVotes) * 100) : 0,
        neutralPercent: totalVotes > 0 ? Math.round((neutralCount / totalVotes) * 100) : 0,
        disapprovePercent: totalVotes > 0 ? Math.round((opposeCount / totalVotes) * 100) : 0,
        userVote,
      });
    } catch (error: any) {
      console.error("Error fetching poll by slug:", error.message);
      res.status(500).json({ error: "Failed to fetch poll" });
    }
  });

  // ===========================================
  // PUBLIC: TRENDING POLL VOTE
  // ===========================================

  app.post("/api/polls/:slug/vote", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { slug } = req.params;
      const { choice } = req.body;

      if (!choice || !['support', 'neutral', 'oppose'].includes(choice)) {
        return res.status(400).json({ error: "Choice must be 'support', 'neutral', or 'oppose'" });
      }

      const [poll] = await db
        .select({ id: trendingPolls.id })
        .from(trendingPolls)
        .where(eq(trendingPolls.slug, slug))
        .limit(1);

      if (!poll) {
        return res.status(404).json({ error: "Poll not found" });
      }

      const [existing] = await db
        .select()
        .from(trendingPollVotes)
        .where(and(
          eq(trendingPollVotes.pollId, poll.id),
          eq(trendingPollVotes.userId, authReq.userId!)
        ))
        .limit(1);

      if (existing) {
        await db
          .update(trendingPollVotes)
          .set({ choice, updatedAt: new Date() })
          .where(eq(trendingPollVotes.id, existing.id));
      } else {
        await db
          .insert(trendingPollVotes)
          .values({
            pollId: poll.id,
            userId: authReq.userId!,
            choice,
          });
      }

      res.json({ success: true, choice });
    } catch (error: any) {
      console.error("Error voting on poll:", error.message);
      res.status(500).json({ error: "Failed to cast vote" });
    }
  });

  // ===========================================
  // PUBLIC: TRENDING POLL COMMENTS
  // ===========================================

  app.get("/api/polls/:slug/comments", async (req, res) => {
    try {
      const { slug } = req.params;

      const [poll] = await db
        .select({ id: trendingPolls.id })
        .from(trendingPolls)
        .where(eq(trendingPolls.slug, slug))
        .limit(1);

      if (!poll) {
        return res.status(404).json({ error: "Poll not found" });
      }

      const comments = await db
        .select()
        .from(trendingPollComments)
        .where(eq(trendingPollComments.pollId, poll.id))
        .orderBy(desc(trendingPollComments.createdAt))
        .limit(100);

      res.json(comments);
    } catch (error: any) {
      console.error("Error fetching poll comments:", error.message);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  app.post("/api/polls/:slug/comments", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { slug } = req.params;
      const { body, parentId } = req.body;

      if (!body || typeof body !== "string" || body.trim().length === 0) {
        return res.status(400).json({ error: "Comment body is required" });
      }

      const [poll] = await db
        .select({ id: trendingPolls.id })
        .from(trendingPolls)
        .where(eq(trendingPolls.slug, slug))
        .limit(1);

      if (!poll) {
        return res.status(404).json({ error: "Poll not found" });
      }

      const [profile] = await db
        .select({ username: profiles.username, avatarUrl: profiles.avatarUrl })
        .from(profiles)
        .where(eq(profiles.id, authReq.userId!))
        .limit(1);

      const [created] = await db
        .insert(trendingPollComments)
        .values({
          pollId: poll.id,
          userId: authReq.userId!,
          username: profile?.username || null,
          avatarUrl: profile?.avatarUrl || null,
          body: body.trim(),
          parentId: parentId || null,
        })
        .returning();

      res.json(created);
    } catch (error: any) {
      console.error("Error creating poll comment:", error.message);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  app.post("/api/polls/comments/:commentId/vote", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { commentId } = req.params;
      const { voteType } = req.body;

      if (!voteType || !['up', 'down'].includes(voteType)) {
        return res.status(400).json({ error: "voteType must be 'up' or 'down'" });
      }

      const [existingVote] = await db
        .select()
        .from(trendingPollCommentVotes)
        .where(and(
          eq(trendingPollCommentVotes.commentId, commentId),
          eq(trendingPollCommentVotes.userId, authReq.userId!)
        ))
        .limit(1);

      if (existingVote) {
        if (existingVote.voteType === voteType) {
          await db.delete(trendingPollCommentVotes).where(eq(trendingPollCommentVotes.id, existingVote.id));
          await db.update(trendingPollComments).set({
            [voteType === 'up' ? 'upvotes' : 'downvotes']: sql`${voteType === 'up' ? trendingPollComments.upvotes : trendingPollComments.downvotes} - 1`,
          }).where(eq(trendingPollComments.id, commentId));
          return res.json({ success: true, action: "removed" });
        } else {
          await db.update(trendingPollCommentVotes).set({ voteType }).where(eq(trendingPollCommentVotes.id, existingVote.id));
          const oldCol = existingVote.voteType === 'up' ? 'upvotes' : 'downvotes';
          const newCol = voteType === 'up' ? 'upvotes' : 'downvotes';
          await db.update(trendingPollComments).set({
            [oldCol]: sql`${oldCol === 'upvotes' ? trendingPollComments.upvotes : trendingPollComments.downvotes} - 1`,
            [newCol]: sql`${newCol === 'upvotes' ? trendingPollComments.upvotes : trendingPollComments.downvotes} + 1`,
          }).where(eq(trendingPollComments.id, commentId));
          return res.json({ success: true, action: "changed" });
        }
      } else {
        await db.insert(trendingPollCommentVotes).values({
          commentId,
          userId: authReq.userId!,
          voteType,
        });
        await db.update(trendingPollComments).set({
          [voteType === 'up' ? 'upvotes' : 'downvotes']: sql`${voteType === 'up' ? trendingPollComments.upvotes : trendingPollComments.downvotes} + 1`,
        }).where(eq(trendingPollComments.id, commentId));
        return res.json({ success: true, action: "added" });
      }
    } catch (error: any) {
      console.error("Error voting on poll comment:", error.message);
      res.status(500).json({ error: "Failed to vote on comment" });
    }
  });

  // ===========================================
  // ADMIN: TRENDING POLLS CRUD
  // ===========================================

  app.get("/api/admin/trending-polls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const pollList = await db.select().from(trendingPolls).orderBy(desc(trendingPolls.createdAt));
      res.json(pollList);
    } catch (error: any) {
      console.error("Error fetching trending polls:", error.message);
      res.status(500).json({ error: "Failed to fetch trending polls" });
    }
  });

  app.post("/api/admin/trending-polls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { status, category, headline, subjectText, personId, description, timeline, deadlineAt, imageUrl, seedSupportCount, seedNeutralCount, seedOpposeCount, slug, featured, visibility } = req.body;
      const adminId = req.userId!;

      if (!headline || !subjectText || !category) {
        return res.status(400).json({ error: "Headline, subject text, and category are required" });
      }

      const effectiveVisibility = visibility || status || "draft";
      const effectiveStatus = (effectiveVisibility === "inactive") ? "draft" : effectiveVisibility;
      const [created] = await db.insert(trendingPolls).values({
        status: effectiveStatus,
        category,
        headline,
        subjectText,
        personId: personId || null,
        description: description || null,
        timeline: timeline || null,
        deadlineAt: deadlineAt ? new Date(deadlineAt) : null,
        imageUrl: imageUrl || null,
        seedSupportCount: seedSupportCount || 0,
        seedNeutralCount: seedNeutralCount || 0,
        seedOpposeCount: seedOpposeCount || 0,
        slug: slug || null,
        featured: featured ?? false,
        visibility: effectiveVisibility,
        createdBy: adminId,
      }).returning();

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'create_trending_poll',
        targetTable: 'trending_polls',
        targetId: created.id,
        newData: created,
      });

      res.json(created);
    } catch (error: any) {
      console.error("Error creating trending poll:", error.message, error.detail || "");
      const detail = error.detail || error.message || "Unknown error";
      if (detail.includes("foreign key") || detail.includes("violates")) {
        res.status(400).json({ error: "Invalid linked celebrity ID. Please select a celebrity from the dropdown.", details: detail });
      } else {
        res.status(500).json({ error: `Failed to create trending poll: ${detail}`, details: detail });
      }
    }
  });

  app.patch("/api/admin/trending-polls/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;

      const [existing] = await db.select().from(trendingPolls).where(eq(trendingPolls.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Trending poll not found" });
      }

      const { status, category, headline, subjectText, personId, description, timeline, deadlineAt, imageUrl, seedSupportCount, seedNeutralCount, seedOpposeCount, slug, featured, visibility } = req.body;

      const updates: any = { updatedAt: new Date() };
      if (visibility !== undefined) {
        updates.visibility = visibility;
        updates.status = (visibility === "inactive") ? "draft" : visibility;
      } else if (status !== undefined) {
        updates.status = status;
      }
      if (category !== undefined) updates.category = category;
      if (headline !== undefined) updates.headline = headline;
      if (subjectText !== undefined) updates.subjectText = subjectText;
      if (personId !== undefined) updates.personId = personId || null;
      if (description !== undefined) updates.description = description || null;
      if (timeline !== undefined) updates.timeline = timeline || null;
      if (deadlineAt !== undefined) updates.deadlineAt = deadlineAt ? new Date(deadlineAt) : null;
      if (imageUrl !== undefined) updates.imageUrl = imageUrl || null;
      if (seedSupportCount !== undefined) updates.seedSupportCount = seedSupportCount;
      if (seedNeutralCount !== undefined) updates.seedNeutralCount = seedNeutralCount;
      if (seedOpposeCount !== undefined) updates.seedOpposeCount = seedOpposeCount;
      if (slug !== undefined) updates.slug = slug || null;
      if (featured !== undefined) updates.featured = featured;

      const [updated] = await db.update(trendingPolls).set(updates).where(eq(trendingPolls.id, id)).returning();

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'update_trending_poll',
        targetTable: 'trending_polls',
        targetId: id,
        previousData: existing,
        newData: updated,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating trending poll:", error.message, error.detail || "");
      const detail = error.detail || error.message || "Unknown error";
      if (detail.includes("foreign key") || detail.includes("violates")) {
        res.status(400).json({ error: "Invalid linked celebrity ID. Please select a celebrity from the dropdown.", details: detail });
      } else {
        res.status(500).json({ error: `Failed to update trending poll: ${detail}`, details: detail });
      }
    }
  });

  app.delete("/api/admin/trending-polls/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;

      const [existing] = await db.select().from(trendingPolls).where(eq(trendingPolls.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Trending poll not found" });
      }

      await db.delete(trendingPolls).where(eq(trendingPolls.id, id));

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_trending_poll',
        targetTable: 'trending_polls',
        targetId: id,
        previousData: existing,
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting trending poll:", error.message);
      res.status(500).json({ error: "Failed to delete trending poll" });
    }
  });

  // ===========================================
  // ADMIN: SEED TRENDING POLLS FROM HARDCODED DATA
  // ===========================================

  app.post("/api/admin/seed-trending-polls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const SEED_TOPICS = [
        { headline: "Elon buys Twitter", description: "Was the $44B acquisition a smart move?", category: "Tech", approvePercent: 35, neutralPercent: 20, disapprovePercent: 45, totalVotes: 89432, personName: "Elon Musk" },
        { headline: "AI replacing jobs", description: "Should we embrace or regulate AI in the workplace?", category: "Tech", approvePercent: 28, neutralPercent: 32, disapprovePercent: 40, totalVotes: 156789 },
        { headline: "Taylor's Eras Tour pricing", description: "Are dynamic ticket prices fair to fans?", category: "Music", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 234567, personName: "Taylor Swift" },
        { headline: "Spotify's royalty model", description: "Are artists fairly compensated by streaming?", category: "Music", approvePercent: 22, neutralPercent: 28, disapprovePercent: 50, totalVotes: 145678 },
        { headline: "MrBeast's philanthropy", description: "Is it genuine or just content?", category: "Creator", approvePercent: 68, neutralPercent: 20, disapprovePercent: 12, totalVotes: 98765, personName: "MrBeast" },
        { headline: "NFL Sunday Ticket pricing", description: "Is streaming football too expensive?", category: "Sports", approvePercent: 18, neutralPercent: 22, disapprovePercent: 60, totalVotes: 76543 },
        { headline: "Meta's rebrand to AI company", description: "Is the pivot from social media working?", category: "Tech", approvePercent: 25, neutralPercent: 35, disapprovePercent: 40, totalVotes: 112345, personName: "Mark Zuckerberg" },
        { headline: "Drake vs Kendrick beef", description: "Who won the rap battle?", category: "Music", approvePercent: 45, neutralPercent: 15, disapprovePercent: 40, totalVotes: 287654, personName: "Drake" },
        { headline: "LeBron's longevity", description: "Greatest athlete of all time?", category: "Sports", approvePercent: 55, neutralPercent: 25, disapprovePercent: 20, totalVotes: 198765, personName: "LeBron James" },
        { headline: "Crypto regulation", description: "Should governments control digital currencies?", category: "Business", approvePercent: 40, neutralPercent: 20, disapprovePercent: 40, totalVotes: 134567 },
        { headline: "TikTok ban debate", description: "National security vs free speech?", category: "Politics", approvePercent: 35, neutralPercent: 30, disapprovePercent: 35, totalVotes: 256789 },
        { headline: "OpenAI board drama", description: "Was firing Sam Altman justified?", category: "Tech", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 189432, personName: "Sam Altman" },
        { headline: "Beyonce's country album", description: "Authentic exploration or cultural appropriation?", category: "Music", approvePercent: 65, neutralPercent: 20, disapprovePercent: 15, totalVotes: 176543, personName: "Beyonce" },
        { headline: "YouTube Premium worth it?", description: "Is ad-free viewing worth the subscription?", category: "Creator", approvePercent: 48, neutralPercent: 22, disapprovePercent: 30, totalVotes: 87654 },
        { headline: "F1's US expansion", description: "Is Formula 1 becoming too commercial?", category: "Sports", approvePercent: 40, neutralPercent: 35, disapprovePercent: 25, totalVotes: 65432 },
        { headline: "Billionaire space race", description: "Vanity project or advancing humanity?", category: "Tech", approvePercent: 30, neutralPercent: 25, disapprovePercent: 45, totalVotes: 145678 },
        { headline: "Student loan forgiveness", description: "Fair policy or overreach?", category: "Politics", approvePercent: 52, neutralPercent: 18, disapprovePercent: 30, totalVotes: 234567 },
        { headline: "Ozempic for weight loss", description: "Medical breakthrough or vanity?", category: "Business", approvePercent: 38, neutralPercent: 32, disapprovePercent: 30, totalVotes: 112345 },
        { headline: "Twitch streamer earnings", description: "Are top streamers overpaid?", category: "Creator", approvePercent: 25, neutralPercent: 35, disapprovePercent: 40, totalVotes: 78965 },
        { headline: "Climate activism tactics", description: "Is disruption effective or counterproductive?", category: "Politics", approvePercent: 35, neutralPercent: 25, disapprovePercent: 40, totalVotes: 167890 },
      ];

      let inserted = 0;
      let skipped = 0;

      for (const topic of SEED_TOPICS) {
        const [existing] = await db
          .select({ id: trendingPolls.id })
          .from(trendingPolls)
          .where(eq(trendingPolls.headline, topic.headline))
          .limit(1);

        if (existing) {
          skipped++;
          continue;
        }

        let personId: string | null = null;
        if (topic.personName) {
          const [matched] = await db
            .select({ id: trackedPeople.id })
            .from(trackedPeople)
            .where(ilike(trackedPeople.name, topic.personName))
            .limit(1);
          if (matched) {
            personId = matched.id;
          }
        }

        const seedSupportCount = Math.round((topic.approvePercent / 100) * topic.totalVotes);
        const seedNeutralCount = Math.round((topic.neutralPercent / 100) * topic.totalVotes);
        const seedOpposeCount = Math.round((topic.disapprovePercent / 100) * topic.totalVotes);

        await db.insert(trendingPolls).values({
          status: 'live',
          category: topic.category,
          headline: topic.headline,
          subjectText: topic.description,
          description: topic.description,
          personId,
          imageUrl: null,
          seedSupportCount,
          seedNeutralCount,
          seedOpposeCount,
          createdBy: req.userId || null,
        });

        inserted++;
      }

      res.json({ success: true, inserted, skipped });
    } catch (error: any) {
      console.error("Error seeding trending polls:", error.message);
      res.status(500).json({ error: "Failed to seed trending polls" });
    }
  });

  // ===========================================
  // PUBLIC: OPINION POLLS (Multi-option polls)
  // ===========================================

  app.get("/api/opinion-polls", async (req, res) => {
    try {
      const userId = (() => {
        try {
          const authHeader = req.headers.authorization;
          if (!authHeader?.startsWith('Bearer ')) return null;
          const token = authHeader.split(' ')[1];
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'authoridex-secret-key');
          return (decoded as any).userId || null;
        } catch { return null; }
      })();

      const polls = await db
        .select()
        .from(opinionPolls)
        .where(eq(opinionPolls.visibility, 'live'))
        .orderBy(desc(opinionPolls.createdAt));

      const result = await Promise.all(polls.map(async (poll) => {
        const options = await db
          .select({
            id: opinionPollOptions.id,
            name: opinionPollOptions.name,
            imageUrl: opinionPollOptions.imageUrl,
            personId: opinionPollOptions.personId,
            orderIndex: opinionPollOptions.orderIndex,
            seedCount: opinionPollOptions.seedCount,
            personName: trackedPeople.name,
            personAvatar: trackedPeople.avatar,
          })
          .from(opinionPollOptions)
          .leftJoin(trackedPeople, eq(opinionPollOptions.personId, trackedPeople.id))
          .where(eq(opinionPollOptions.pollId, poll.id))
          .orderBy(asc(opinionPollOptions.orderIndex));

        const voteCounts = await db
          .select({
            optionId: opinionPollVotes.optionId,
            cnt: count(),
          })
          .from(opinionPollVotes)
          .where(eq(opinionPollVotes.pollId, poll.id))
          .groupBy(opinionPollVotes.optionId);

        const voteMap = new Map(voteCounts.map(v => [v.optionId, Number(v.cnt)]));

        const optionsWithVotes = options.map(o => {
          const realVotes = voteMap.get(o.id) || 0;
          const seedVotes = o.seedCount || 0;
          const displayVotes = realVotes + seedVotes;
          return { ...o, displayVotes };
        });
        const totalDisplayVotes = optionsWithVotes.reduce((sum, o) => sum + o.displayVotes, 0);

        let userVote: string | null = null;
        if (userId) {
          const [uv] = await db
            .select({ optionId: opinionPollVotes.optionId })
            .from(opinionPollVotes)
            .where(and(eq(opinionPollVotes.pollId, poll.id), eq(opinionPollVotes.userId, userId)))
            .limit(1);
          if (uv) userVote = uv.optionId;
        }

        return {
          ...poll,
          options: optionsWithVotes.map(o => ({
            id: o.id,
            name: o.name,
            imageUrl: o.personAvatar || o.imageUrl || null,
            personId: o.personId,
            personName: o.personName || null,
            votes: o.displayVotes,
            percent: totalDisplayVotes > 0 ? Math.round((o.displayVotes / totalDisplayVotes) * 100) : 0,
          })),
          totalOptions: options.length,
          totalVotes: totalDisplayVotes,
          userVote,
        };
      }));

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching opinion polls:", error.message);
      res.status(500).json({ error: "Failed to fetch opinion polls" });
    }
  });

  app.get("/api/opinion-polls/:slug", optionalAuth, async (req, res) => {
    try {
      const { slug } = req.params;
      const authReq = req as AuthRequest;
      const userId = authReq.userId || null;

      const [poll] = await db
        .select()
        .from(opinionPolls)
        .where(eq(opinionPolls.slug, slug))
        .limit(1);

      if (!poll) {
        return res.status(404).json({ error: "Opinion poll not found" });
      }

      const options = await db
        .select({
          id: opinionPollOptions.id,
          name: opinionPollOptions.name,
          imageUrl: opinionPollOptions.imageUrl,
          personId: opinionPollOptions.personId,
          orderIndex: opinionPollOptions.orderIndex,
          seedCount: opinionPollOptions.seedCount,
          personName: trackedPeople.name,
          personAvatar: trackedPeople.avatar,
        })
        .from(opinionPollOptions)
        .leftJoin(trackedPeople, eq(opinionPollOptions.personId, trackedPeople.id))
        .where(eq(opinionPollOptions.pollId, poll.id))
        .orderBy(asc(opinionPollOptions.orderIndex));

      const voteCounts = await db
        .select({
          optionId: opinionPollVotes.optionId,
          cnt: count(),
        })
        .from(opinionPollVotes)
        .where(eq(opinionPollVotes.pollId, poll.id))
        .groupBy(opinionPollVotes.optionId);

      const voteMap = new Map(voteCounts.map(v => [v.optionId, Number(v.cnt)]));

      const optionsWithVotes = options.map(o => {
        const realVotes = voteMap.get(o.id) || 0;
        const seedVotes = o.seedCount || 0;
        const displayVotes = realVotes + seedVotes;
        return { ...o, realVotes, seedVotes, displayVotes };
      });
      const totalDisplayVotes = optionsWithVotes.reduce((sum, o) => sum + o.displayVotes, 0);

      let userVote: string | null = null;
      if (userId) {
        const [uv] = await db
          .select({ optionId: opinionPollVotes.optionId })
          .from(opinionPollVotes)
          .where(and(eq(opinionPollVotes.pollId, poll.id), eq(opinionPollVotes.userId, userId)))
          .limit(1);
        if (uv) userVote = uv.optionId;
      }

      const [commentCount] = await db
        .select({ cnt: count() })
        .from(opinionPollComments)
        .where(eq(opinionPollComments.pollId, poll.id));

      res.json({
        ...poll,
        options: optionsWithVotes.map(o => ({
          id: o.id,
          name: o.name,
          imageUrl: o.personAvatar || o.imageUrl || null,
          personId: o.personId,
          personName: o.personName || null,
          orderIndex: o.orderIndex,
          votes: o.displayVotes,
          realVotes: o.realVotes,
          seedVotes: o.seedVotes,
          percent: totalDisplayVotes > 0 ? Math.round((o.displayVotes / totalDisplayVotes) * 100) : 0,
        })),
        totalVotes: totalDisplayVotes,
        userVote,
        commentCount: Number(commentCount?.cnt || 0),
      });
    } catch (error: any) {
      console.error("Error fetching opinion poll:", error.message);
      res.status(500).json({ error: "Failed to fetch opinion poll" });
    }
  });

  app.post("/api/opinion-polls/:slug/vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { slug } = req.params;
      const { optionId } = req.body;
      const userId = req.userId!;

      if (!optionId) {
        return res.status(400).json({ error: "optionId is required" });
      }

      const [poll] = await db
        .select({ id: opinionPolls.id })
        .from(opinionPolls)
        .where(eq(opinionPolls.slug, slug))
        .limit(1);

      if (!poll) {
        return res.status(404).json({ error: "Poll not found" });
      }

      const [option] = await db
        .select({ id: opinionPollOptions.id })
        .from(opinionPollOptions)
        .where(and(eq(opinionPollOptions.id, optionId), eq(opinionPollOptions.pollId, poll.id)))
        .limit(1);

      if (!option) {
        return res.status(400).json({ error: "Invalid option for this poll" });
      }

      const [existing] = await db
        .select({ id: opinionPollVotes.id })
        .from(opinionPollVotes)
        .where(and(eq(opinionPollVotes.pollId, poll.id), eq(opinionPollVotes.userId, userId)))
        .limit(1);

      if (existing) {
        await db.update(opinionPollVotes)
          .set({ optionId, updatedAt: new Date() })
          .where(eq(opinionPollVotes.id, existing.id));
      } else {
        await db.insert(opinionPollVotes).values({
          pollId: poll.id,
          optionId,
          userId,
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error voting on opinion poll:", error.message);
      res.status(500).json({ error: "Failed to vote" });
    }
  });

  // Opinion Poll Comments
  app.get("/api/opinion-polls/:slug/comments", async (req, res) => {
    try {
      const { slug } = req.params;
      const sort = (req.query.sort as string) || 'top';

      const [poll] = await db
        .select({ id: opinionPolls.id })
        .from(opinionPolls)
        .where(eq(opinionPolls.slug, slug))
        .limit(1);

      if (!poll) return res.status(404).json({ error: "Poll not found" });

      const orderClause = sort === 'newest'
        ? desc(opinionPollComments.createdAt)
        : desc(opinionPollComments.upvotes);

      const comments = await db
        .select()
        .from(opinionPollComments)
        .where(eq(opinionPollComments.pollId, poll.id))
        .orderBy(orderClause);

      res.json(comments);
    } catch (error: any) {
      console.error("Error fetching opinion poll comments:", error.message);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  app.post("/api/opinion-polls/:slug/comments", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { slug } = req.params;
      const userId = req.userId!;
      const { body, parentId } = req.body;

      if (!body?.trim()) {
        return res.status(400).json({ error: "Comment body is required" });
      }

      const [poll] = await db
        .select({ id: opinionPolls.id })
        .from(opinionPolls)
        .where(eq(opinionPolls.slug, slug))
        .limit(1);

      if (!poll) return res.status(404).json({ error: "Poll not found" });

      let username = "Anonymous";
      let avatarUrl = null;
      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
      if (profile) {
        username = profile.displayName || profile.username || "Anonymous";
        avatarUrl = profile.avatarUrl || null;
      }

      const [created] = await db.insert(opinionPollComments).values({
        pollId: poll.id,
        userId,
        username,
        avatarUrl,
        body: body.trim(),
        parentId: parentId || null,
      }).returning();

      res.json(created);
    } catch (error: any) {
      console.error("Error posting opinion poll comment:", error.message);
      res.status(500).json({ error: "Failed to post comment" });
    }
  });

  app.post("/api/opinion-polls/comments/:commentId/vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { commentId } = req.params;
      const { voteType } = req.body;
      const userId = req.userId!;

      if (!['up', 'down'].includes(voteType)) {
        return res.status(400).json({ error: "voteType must be 'up' or 'down'" });
      }

      const [existing] = await db
        .select()
        .from(opinionPollCommentVotes)
        .where(and(eq(opinionPollCommentVotes.commentId, commentId), eq(opinionPollCommentVotes.userId, userId)))
        .limit(1);

      if (existing) {
        if (existing.voteType === voteType) {
          await db.delete(opinionPollCommentVotes).where(eq(opinionPollCommentVotes.id, existing.id));
          const col = voteType === 'up' ? opinionPollComments.upvotes : opinionPollComments.downvotes;
          await db.update(opinionPollComments).set({ [voteType === 'up' ? 'upvotes' : 'downvotes']: sql`${col} - 1` }).where(eq(opinionPollComments.id, commentId));
        } else {
          await db.update(opinionPollCommentVotes).set({ voteType }).where(eq(opinionPollCommentVotes.id, existing.id));
          const oldCol = existing.voteType === 'up' ? 'upvotes' : 'downvotes';
          const newCol = voteType === 'up' ? 'upvotes' : 'downvotes';
          await db.update(opinionPollComments).set({
            [oldCol]: sql`${existing.voteType === 'up' ? opinionPollComments.upvotes : opinionPollComments.downvotes} - 1`,
            [newCol]: sql`${voteType === 'up' ? opinionPollComments.upvotes : opinionPollComments.downvotes} + 1`,
          }).where(eq(opinionPollComments.id, commentId));
        }
      } else {
        await db.insert(opinionPollCommentVotes).values({ commentId, userId, voteType });
        const col = voteType === 'up' ? 'upvotes' : 'downvotes';
        await db.update(opinionPollComments).set({ [col]: sql`${voteType === 'up' ? opinionPollComments.upvotes : opinionPollComments.downvotes} + 1` }).where(eq(opinionPollComments.id, commentId));
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error voting on opinion poll comment:", error.message);
      res.status(500).json({ error: "Failed to vote on comment" });
    }
  });

  // ===========================================
  // ADMIN: OPINION POLLS CRUD
  // ===========================================

  app.get("/api/admin/opinion-polls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const polls = await db.select().from(opinionPolls).orderBy(desc(opinionPolls.createdAt));
      const result = await Promise.all(polls.map(async (poll) => {
        const options = await db
          .select({
            id: opinionPollOptions.id,
            name: opinionPollOptions.name,
            imageUrl: opinionPollOptions.imageUrl,
            personId: opinionPollOptions.personId,
            orderIndex: opinionPollOptions.orderIndex,
            seedCount: opinionPollOptions.seedCount,
          })
          .from(opinionPollOptions)
          .where(eq(opinionPollOptions.pollId, poll.id))
          .orderBy(asc(opinionPollOptions.orderIndex));

        const [realVoteCount] = await db
          .select({ cnt: count() })
          .from(opinionPollVotes)
          .where(eq(opinionPollVotes.pollId, poll.id));

        const totalSeedVotes = options.reduce((sum, o) => sum + (o.seedCount || 0), 0);

        return { ...poll, options, totalVotes: Number(realVoteCount?.cnt || 0) + totalSeedVotes };
      }));
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching admin opinion polls:", error.message);
      res.status(500).json({ error: "Failed to fetch opinion polls" });
    }
  });

  app.post("/api/admin/opinion-polls", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { title, slug, category, description, summary, imageUrl, featured, visibility, options } = req.body;
      const adminId = req.userId!;

      if (!title || !slug || !category) {
        return res.status(400).json({ error: "Title, slug, and category are required" });
      }

      if (!options || !Array.isArray(options) || options.length < 3 || options.length > 20) {
        return res.status(400).json({ error: "Between 3 and 20 options are required" });
      }

      const [created] = await db.insert(opinionPolls).values({
        title,
        slug,
        category,
        description: description || null,
        summary: summary || null,
        imageUrl: imageUrl || null,
        featured: featured ?? false,
        visibility: visibility || 'draft',
        createdBy: adminId,
      }).returning();

      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        await db.insert(opinionPollOptions).values({
          pollId: created.id,
          name: opt.name,
          imageUrl: opt.imageUrl || null,
          personId: opt.personId || null,
          orderIndex: i,
          seedCount: opt.seedCount || 0,
        });
      }

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'create_opinion_poll',
        targetTable: 'opinion_polls',
        targetId: created.id,
        newData: { ...created, options },
      });

      res.json(created);
    } catch (error: any) {
      console.error("Error creating opinion poll:", error.message, error.detail || "");
      const detail = error.detail || error.message || "Unknown error";
      if (detail.includes("unique") || detail.includes("duplicate")) {
        res.status(400).json({ error: "A poll with this slug already exists. Please choose a different slug." });
      } else {
        res.status(500).json({ error: `Failed to create opinion poll: ${detail}` });
      }
    }
  });

  app.patch("/api/admin/opinion-polls/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;
      const { title, slug, category, description, summary, imageUrl, featured, visibility, options } = req.body;

      const [existing] = await db.select().from(opinionPolls).where(eq(opinionPolls.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Opinion poll not found" });
      }

      const updates: any = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (slug !== undefined) updates.slug = slug;
      if (category !== undefined) updates.category = category;
      if (description !== undefined) updates.description = description || null;
      if (summary !== undefined) updates.summary = summary || null;
      if (imageUrl !== undefined) updates.imageUrl = imageUrl || null;
      if (featured !== undefined) updates.featured = featured;
      if (visibility !== undefined) updates.visibility = visibility;

      const [updated] = await db.update(opinionPolls).set(updates).where(eq(opinionPolls.id, id)).returning();

      if (options && Array.isArray(options)) {
        await db.delete(opinionPollOptions).where(eq(opinionPollOptions.pollId, id));
        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          await db.insert(opinionPollOptions).values({
            pollId: id,
            name: opt.name,
            imageUrl: opt.imageUrl || null,
            personId: opt.personId || null,
            orderIndex: i,
            seedCount: opt.seedCount || 0,
          });
        }
      }

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'update_opinion_poll',
        targetTable: 'opinion_polls',
        targetId: id,
        previousData: existing,
        newData: updated,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating opinion poll:", error.message, error.detail || "");
      const detail = error.detail || error.message || "Unknown error";
      res.status(500).json({ error: `Failed to update opinion poll: ${detail}` });
    }
  });

  app.delete("/api/admin/opinion-polls/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;

      const [existing] = await db.select().from(opinionPolls).where(eq(opinionPolls.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Opinion poll not found" });
      }

      await db.delete(opinionPolls).where(eq(opinionPolls.id, id));

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: 'delete_opinion_poll',
        targetTable: 'opinion_polls',
        targetId: id,
        previousData: existing,
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting opinion poll:", error.message);
      res.status(500).json({ error: "Failed to delete opinion poll" });
    }
  });

  // ===========================================
  // CRON ENDPOINTS (Serverless/Vercel Compatible)
  // ===========================================
  // These endpoints can be triggered by external schedulers (Vercel Cron, GitHub Actions, etc.)
  // They use API key authentication instead of user session auth for serverless compatibility
  
  const cronCallLog: { endpoint: string; callerIp: string; at: string }[] = [];
  const CRON_CALL_LOG_MAX = 50;

  const verifyCronSecret = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    const callerIp = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const endpoint = req.path;

    cronCallLog.push({ endpoint, callerIp, at: new Date().toISOString() });
    if (cronCallLog.length > CRON_CALL_LOG_MAX) cronCallLog.shift();

    if (!cronSecret) {
      console.warn('[Cron] Warning: CRON_SECRET not set. Cron endpoints are unprotected.');
      return next();
    }
    
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      console.warn(`[Cron] Unauthorized attempt on ${endpoint} from ${callerIp}`);
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing cron secret' });
    }
    
    console.log(`[Cron] Authenticated call to ${endpoint} from ${callerIp}`);
    next();
  };
  
  // Capture hourly snapshots for trend graphs
  // Call this every hour via external scheduler
  app.post("/api/cron/capture-snapshots", verifyCronSecret, async (req, res) => {
    const startTime = Date.now();
    try {
      const { captureHourlySnapshots } = await import("./jobs/snapshot-scheduler");
      const result = await captureHourlySnapshots();
      
      res.json({
        success: true,
        message: "Snapshots captured successfully",
        captured: result.captured,
        errors: result.errors,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Snapshot capture error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });
  
  // Run full data ingestion from external APIs
  // Call this every 2 hours via external scheduler (Basic tier X API)
  app.post("/api/cron/refresh-data", verifyCronSecret, async (req, res) => {
    const startTime = Date.now();
    try {
      const { runDataIngestion } = await import("./jobs/ingest");
      const result = await runDataIngestion();
      
      res.json({
        success: true,
        message: "Data ingestion completed",
        processed: result.processed,
        errors: result.errors,
        duration: result.duration,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Data ingestion error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });
  
  // PREVIEW scoring health check (uses cached API data WITHOUT writing to DB)
  // NOTE: This does NOT update trending_people - only ingest.ts writes to that table.
  // This endpoint is useful for monitoring and debugging the scoring engine health.
  app.post("/api/cron/run-scoring", verifyCronSecret, async (req, res) => {
    const startTime = Date.now();
    try {
      const { runQuickScoring } = await import("./jobs/quick-score");
      const result = await runQuickScoring();
      
      res.json({
        success: true,
        message: "Scoring PREVIEW complete (NOT written to DB - only ingest.ts writes)",
        processed: result.processed,
        errors: result.errors,
        healthSummary: result.healthSummary,
        topResults: result.results.slice(0, 10).map(r => ({ name: r.name, fameIndex: r.fameIndex, rank: r.rank })),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Scoring preview error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  });
  
  app.get("/api/cron/health", (req, res) => {
    res.json({
      status: "ok",
      serverTime: new Date().toISOString(),
      cronSecretConfigured: !!process.env.CRON_SECRET,
      recentCalls: cronCallLog.slice(-10),
    });
  });

  // ============ APPROVAL LEADERS ============
  // Get highest and lowest rated celebrities based on user votes
  app.get("/api/approval-leaders", async (req, res) => {
    try {
      // Query Supabase for aggregate ratings per person (snake_case columns)
      const { data: voteStats, error } = await supabaseServer
        .from('user_votes')
        .select('person_id, person_name, rating');

      if (error) {
        console.error("[Approval Leaders] Supabase error:", error);
        return res.status(500).json({ error: "Failed to fetch vote data" });
      }

      if (!voteStats || voteStats.length === 0) {
        // Return fallback celebrities for design preview when no votes exist
        // Fetch actual avatar images from trending_people table
        const [elonData] = await db.select({ avatar: trendingPeople.avatar, category: trendingPeople.category })
          .from(trendingPeople)
          .where(sql`LOWER(${trendingPeople.name}) LIKE '%elon musk%'`)
          .limit(1);
        
        const [nickData] = await db.select({ avatar: trendingPeople.avatar, category: trendingPeople.category })
          .from(trendingPeople)
          .where(sql`LOWER(${trendingPeople.name}) LIKE '%nick fuentes%'`)
          .limit(1);

        const fallbackHighest = {
          personId: "elon-musk",
          personName: "Elon Musk",
          avgRating: 4.7,
          voteCount: 0,
          approvalPercent: 92.5,
          avatar: elonData?.avatar || null,
          category: elonData?.category || "Tech"
        };
        const fallbackLowest = {
          personId: "nick-fuentes",
          personName: "Nick Fuentes",
          avgRating: 1.3,
          voteCount: 0,
          approvalPercent: 7.5,
          avatar: nickData?.avatar || null,
          category: nickData?.category || "Politics"
        };
        return res.json({ highest: fallbackHighest, lowest: fallbackLowest, isFallback: true });
      }

      // Aggregate ratings by personId
      const personRatings: Record<string, { personId: string; personName: string; totalRating: number; voteCount: number }> = {};
      
      for (const vote of voteStats) {
        const personId = vote.person_id;
        const personName = vote.person_name;
        if (!personRatings[personId]) {
          personRatings[personId] = {
            personId,
            personName,
            totalRating: 0,
            voteCount: 0,
          };
        }
        personRatings[personId].totalRating += vote.rating;
        personRatings[personId].voteCount += 1;
      }

      // Calculate average rating and approval percentage for each person
      const personStats = Object.values(personRatings).map(p => ({
        personId: p.personId,
        personName: p.personName,
        avgRating: p.totalRating / p.voteCount,
        voteCount: p.voteCount,
        approvalPercent: Math.round(((p.totalRating / p.voteCount) - 1) / 4 * 100),
      }));

      // Sort to find highest and lowest
      personStats.sort((a, b) => b.avgRating - a.avgRating);
      
      const highest = personStats[0] || null;
      const lowest = personStats.length > 1 ? personStats[personStats.length - 1] : null;

      // Get avatar from trending_people for each
      let highestWithAvatar = null;
      let lowestWithAvatar = null;

      if (highest) {
        const [personData] = await db.select({ avatar: trendingPeople.avatar, category: trendingPeople.category })
          .from(trendingPeople)
          .where(eq(trendingPeople.id, highest.personId))
          .limit(1);
        highestWithAvatar = {
          ...highest,
          avatar: personData?.avatar || null,
          category: personData?.category || null,
        };
      }

      if (lowest) {
        const [personData] = await db.select({ avatar: trendingPeople.avatar, category: trendingPeople.category })
          .from(trendingPeople)
          .where(eq(trendingPeople.id, lowest.personId))
          .limit(1);
        lowestWithAvatar = {
          ...lowest,
          avatar: personData?.avatar || null,
          category: personData?.category || null,
        };
      }

      res.json({
        highest: highestWithAvatar,
        lowest: lowestWithAvatar,
      });
    } catch (error: any) {
      console.error("[Approval Leaders] Error:", error);
      res.status(500).json({ error: "Failed to fetch approval leaders" });
    }
  });

  // ============ REAL-WORLD MARKETS (Open Markets) API ============

  app.get("/api/open-markets", async (req, res) => {
    try {
      const { category, featured, limit } = req.query;

      const conditions = [
        eq(predictionMarkets.marketType, "community"),
        eq(predictionMarkets.status, "OPEN"),
        inArray(predictionMarkets.visibility, ["live", "inactive"]),
      ];

      if (category && typeof category === "string") {
        conditions.push(eq(predictionMarkets.category, category));
      }

      if (featured === "true") {
        conditions.push(eq(predictionMarkets.featured, true));
      }

      const markets = await db
        .select()
        .from(predictionMarkets)
        .where(and(...conditions))
        .orderBy(desc(predictionMarkets.featured), desc(predictionMarkets.createdAt))
        .limit(limit && typeof limit === "string" ? parseInt(limit, 10) || 50 : 50);

      const marketIds = markets.map((m) => m.id);
      let entries: any[] = [];
      if (marketIds.length > 0) {
        entries = await db
          .select()
          .from(marketEntries)
          .where(inArray(marketEntries.marketId, marketIds))
          .orderBy(asc(marketEntries.displayOrder));
      }

      const entriesByMarket = new Map<string, typeof entries>();
      for (const entry of entries) {
        const list = entriesByMarket.get(entry.marketId) || [];
        list.push(entry);
        entriesByMarket.set(entry.marketId, list);
      }

      const personIds = markets.map(m => m.personId).filter(Boolean) as string[];
      let personAvatars = new Map<string, string>();
      if (personIds.length > 0) {
        const people = await db
          .select({ id: trendingPeople.id, avatar: trendingPeople.avatar, name: trendingPeople.name })
          .from(trendingPeople)
          .where(inArray(trendingPeople.id, personIds));
        for (const p of people) {
          if (p.avatar) personAvatars.set(p.id, p.avatar);
        }
      }

      const result = markets.map((m) => ({
        ...m,
        entries: entriesByMarket.get(m.id) || [],
        linkedPersonAvatar: m.personId ? personAvatars.get(m.personId) || null : null,
      }));

      res.json(result);
    } catch (error) {
      console.error("[Open Markets] List error:", error);
      res.status(500).json({ error: "Failed to fetch open markets" });
    }
  });

  app.get("/api/open-markets/:slug", async (req, res) => {
    try {
      const { slug } = req.params;

      const [market] = await db
        .select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.slug, slug),
            eq(predictionMarkets.marketType, "community")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      const entries = await db
        .select()
        .from(marketEntries)
        .where(eq(marketEntries.marketId, market.id))
        .orderBy(asc(marketEntries.displayOrder));

      const betCounts = await db
        .select({
          entryId: marketBets.entryId,
          betCount: count(),
        })
        .from(marketBets)
        .where(eq(marketBets.marketId, market.id))
        .groupBy(marketBets.entryId);

      const betCountMap = new Map<string, number>();
      for (const bc of betCounts) {
        betCountMap.set(bc.entryId, Number(bc.betCount));
      }

      const entriesWithCounts = entries.map((e) => ({
        ...e,
        betCount: betCountMap.get(e.id) || 0,
      }));

      const comments = await db
        .select()
        .from(openMarketComments)
        .where(eq(openMarketComments.marketId, market.id))
        .orderBy(desc(openMarketComments.createdAt))
        .limit(50);

      const [participantResult] = await db
        .select({
          uniqueParticipants: sql<number>`COUNT(DISTINCT ${marketBets.userId})`,
        })
        .from(marketBets)
        .where(eq(marketBets.marketId, market.id));

      res.json({
        ...market,
        entries: entriesWithCounts,
        comments,
        totalParticipants: Number(participantResult?.uniqueParticipants || 0),
      });
    } catch (error) {
      console.error("[Open Markets] Detail error:", error);
      res.status(500).json({ error: "Failed to fetch market details" });
    }
  });

  app.post("/api/admin/open-markets", requireAuth, requireAdmin, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const {
        title, slug, openMarketType, teaser, summary, description, category,
        tags, coverImageUrl, sourceUrl, featured, timezone, startAt, endAt,
        closeAt, resolutionCriteria, resolutionSources, resolveMethod, rules,
        seedParticipants, seedVolume, underlying, metric, strike, unit,
        entries: entryList, personId, isLive, visibility, inactiveMessage,
      } = req.body;

      if (!openMarketType || !["binary", "multi", "updown"].includes(openMarketType)) {
        return res.status(400).json({ error: "openMarketType must be binary, multi, or updown" });
      }

      if (!title || !slug || !endAt) {
        return res.status(400).json({ error: "title, slug, and endAt are required" });
      }

      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        return res.status(400).json({ error: "slug must be URL-safe (lowercase letters, numbers, dashes)" });
      }

      if (!Array.isArray(entryList) || entryList.length === 0) {
        return res.status(400).json({ error: "entries array is required" });
      }

      if (openMarketType === "binary" && entryList.length !== 2) {
        return res.status(400).json({ error: "Binary markets must have exactly 2 entries" });
      }

      if (openMarketType === "multi" && (entryList.length < 3 || entryList.length > 20)) {
        return res.status(400).json({ error: "Multi markets must have 3-20 entries" });
      }

      if (openMarketType === "updown") {
        if (entryList.length !== 2) {
          return res.status(400).json({ error: "Up/Down markets must have exactly 2 entries" });
        }
        if (!underlying || !metric || !strike || !unit) {
          return res.status(400).json({ error: "Up/Down markets require underlying, metric, strike, and unit" });
        }
      }

      const [createdMarket] = await db
        .insert(predictionMarkets)
        .values({
          marketType: "community",
          title,
          slug,
          openMarketType,
          teaser: teaser || null,
          summary: summary || null,
          description: description || null,
          category: category || null,
          tags: tags || null,
          coverImageUrl: coverImageUrl || null,
          sourceUrl: sourceUrl || null,
          featured: featured || false,
          timezone: timezone || "UTC",
          startAt: startAt ? new Date(startAt) : new Date(),
          endAt: new Date(endAt),
          closeAt: closeAt ? new Date(closeAt) : null,
          resolutionCriteria: resolutionCriteria || null,
          resolutionSources: resolutionSources || null,
          resolveMethod: resolveMethod || null,
          rules: rules || null,
          seedParticipants: seedParticipants || 0,
          seedVolume: seedVolume ? String(seedVolume) : "0",
          underlying: underlying || null,
          metric: metric || null,
          strike: strike ? String(strike) : null,
          unit: unit || null,
          createdBy: authReq.userId,
          status: "OPEN",
          personId: personId || null,
          isLive: isLive !== false,
          visibility: ["draft", "live", "inactive", "archived"].includes(visibility) ? visibility : "live",
          inactiveMessage: inactiveMessage || null,
        })
        .returning();

      const createdEntries = await db
        .insert(marketEntries)
        .values(
          entryList.map((e: any, i: number) => ({
            marketId: createdMarket.id,
            entryType: e.personId ? "person" : "custom" as const,
            personId: e.personId || null,
            label: e.label,
            description: e.description || null,
            displayOrder: e.displayOrder ?? i,
            seedCount: e.seedCount || 0,
            imageUrl: e.imageUrl || null,
          }))
        )
        .returning();

      res.json({ ...createdMarket, entries: createdEntries });
    } catch (error: any) {
      console.error("[Open Markets] Create error:", error);
      if (error?.code === "23505") {
        return res.status(409).json({ error: "A market with this slug already exists" });
      }
      res.status(500).json({ error: "Failed to create market" });
    }
  });

  app.patch("/api/admin/open-markets/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const [existing] = await db
        .select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.id, id),
            eq(predictionMarkets.marketType, "community")
          )
        )
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Market not found" });
      }

      if (existing.status !== "OPEN") {
        return res.status(400).json({ error: "Can only update markets with OPEN status" });
      }

      const {
        title, teaser, summary, description, category, tags, coverImageUrl,
        sourceUrl, featured, timezone, startAt, endAt, closeAt,
        resolutionCriteria, resolutionSources, resolveMethod, rules,
        seedParticipants, seedVolume, underlying, metric, strike, unit,
        openMarketType, personId, isLive, visibility, inactiveMessage, entries: entryList,
      } = req.body;

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (title !== undefined) updates.title = title;
      if (teaser !== undefined) updates.teaser = teaser;
      if (summary !== undefined) updates.summary = summary;
      if (description !== undefined) updates.description = description;
      if (category !== undefined) updates.category = category;
      if (tags !== undefined) updates.tags = tags;
      if (coverImageUrl !== undefined) updates.coverImageUrl = coverImageUrl;
      if (sourceUrl !== undefined) updates.sourceUrl = sourceUrl;
      if (featured !== undefined) updates.featured = featured;
      if (timezone !== undefined) updates.timezone = timezone;
      if (startAt !== undefined) updates.startAt = new Date(startAt);
      if (endAt !== undefined) updates.endAt = new Date(endAt);
      if (closeAt !== undefined) updates.closeAt = closeAt ? new Date(closeAt) : null;
      if (resolutionCriteria !== undefined) updates.resolutionCriteria = resolutionCriteria;
      if (resolutionSources !== undefined) updates.resolutionSources = resolutionSources;
      if (resolveMethod !== undefined) updates.resolveMethod = resolveMethod;
      if (rules !== undefined) updates.rules = rules;
      if (seedParticipants !== undefined) updates.seedParticipants = seedParticipants;
      if (seedVolume !== undefined) updates.seedVolume = String(seedVolume);
      if (underlying !== undefined) updates.underlying = underlying;
      if (metric !== undefined) updates.metric = metric;
      if (strike !== undefined) updates.strike = strike ? String(strike) : null;
      if (unit !== undefined) updates.unit = unit;
      if (openMarketType !== undefined) updates.openMarketType = openMarketType;
      if (personId !== undefined) updates.personId = personId || null;
      if (isLive !== undefined) updates.isLive = isLive;
      if (visibility !== undefined && ["draft", "live", "inactive", "archived"].includes(visibility)) {
        updates.visibility = visibility;
        updates.isLive = visibility === "live" || visibility === "inactive";
      }
      if (inactiveMessage !== undefined) updates.inactiveMessage = inactiveMessage || null;

      const [updated] = await db
        .update(predictionMarkets)
        .set(updates)
        .where(eq(predictionMarkets.id, id))
        .returning();

      if (entryList && Array.isArray(entryList)) {
        const existingEntries = await db
          .select()
          .from(marketEntries)
          .where(eq(marketEntries.marketId, id))
          .orderBy(asc(marketEntries.displayOrder));

        for (let i = 0; i < entryList.length; i++) {
          const e = entryList[i];
          if (i < existingEntries.length) {
            await db
              .update(marketEntries)
              .set({
                label: e.label,
                description: e.description || null,
                displayOrder: e.displayOrder ?? i,
                seedCount: e.seedCount || 0,
                imageUrl: e.imageUrl || null,
                personId: e.personId || null,
                entryType: e.personId ? "person" : "custom",
              })
              .where(eq(marketEntries.id, existingEntries[i].id));
          } else {
            await db
              .insert(marketEntries)
              .values({
                marketId: id,
                entryType: e.personId ? "person" : "custom",
                personId: e.personId || null,
                label: e.label,
                description: e.description || null,
                displayOrder: e.displayOrder ?? i,
                seedCount: e.seedCount || 0,
                imageUrl: e.imageUrl || null,
              });
          }
        }
        if (existingEntries.length > entryList.length) {
          const idsToRemove = existingEntries.slice(entryList.length).map(e => e.id);
          if (idsToRemove.length > 0) {
            await db.delete(marketEntries).where(inArray(marketEntries.id, idsToRemove));
          }
        }
      }

      const finalEntries = await db
        .select()
        .from(marketEntries)
        .where(eq(marketEntries.marketId, id))
        .orderBy(asc(marketEntries.displayOrder));

      res.json({ ...updated, entries: finalEntries });
    } catch (error) {
      console.error("[Open Markets] Update error:", error);
      res.status(500).json({ error: "Failed to update market" });
    }
  });

  app.post("/api/admin/open-markets/:id/settle", requireAuth, requireAdmin, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { id } = req.params;
      const { winnerEntryId, resolutionNotes } = req.body;

      if (!winnerEntryId) {
        return res.status(400).json({ error: "winnerEntryId is required" });
      }

      const [market] = await db
        .select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.id, id),
            eq(predictionMarkets.marketType, "community")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      if (market.status !== "OPEN") {
        return res.status(400).json({ error: "Market is not OPEN" });
      }

      const [winnerEntry] = await db
        .select()
        .from(marketEntries)
        .where(
          and(
            eq(marketEntries.id, winnerEntryId),
            eq(marketEntries.marketId, id)
          )
        )
        .limit(1);

      if (!winnerEntry) {
        return res.status(400).json({ error: "Winner entry not found in this market" });
      }

      const [updatedMarket] = await db
        .update(predictionMarkets)
        .set({
          status: "RESOLVED",
          resolvedAt: new Date(),
          settledBy: authReq.userId,
          resolutionNotes: resolutionNotes || null,
          updatedAt: new Date(),
        })
        .where(eq(predictionMarkets.id, id))
        .returning();

      await db
        .update(marketEntries)
        .set({ resolutionStatus: "winner" })
        .where(eq(marketEntries.id, winnerEntryId));

      await db
        .update(marketEntries)
        .set({ resolutionStatus: "loser" })
        .where(
          and(
            eq(marketEntries.marketId, id),
            ne(marketEntries.id, winnerEntryId)
          )
        );

      await db
        .update(marketBets)
        .set({ status: "won", settledAt: new Date() })
        .where(
          and(
            eq(marketBets.marketId, id),
            eq(marketBets.entryId, winnerEntryId)
          )
        );

      await db
        .update(marketBets)
        .set({ status: "lost", settledAt: new Date() })
        .where(
          and(
            eq(marketBets.marketId, id),
            ne(marketBets.entryId, winnerEntryId)
          )
        );

      res.json(updatedMarket);
    } catch (error) {
      console.error("[Open Markets] Settle error:", error);
      res.status(500).json({ error: "Failed to settle market" });
    }
  });

  app.post("/api/admin/open-markets/:id/void", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { voidReason } = req.body;

      if (!voidReason) {
        return res.status(400).json({ error: "voidReason is required" });
      }

      const [market] = await db
        .select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.id, id),
            eq(predictionMarkets.marketType, "community")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      const [updatedMarket] = await db
        .update(predictionMarkets)
        .set({
          status: "VOID",
          voidReason,
          updatedAt: new Date(),
        })
        .where(eq(predictionMarkets.id, id))
        .returning();

      await db
        .update(marketEntries)
        .set({ resolutionStatus: "void" })
        .where(eq(marketEntries.marketId, id));

      await db
        .update(marketBets)
        .set({ status: "void", settledAt: new Date() })
        .where(eq(marketBets.marketId, id));

      res.json(updatedMarket);
    } catch (error) {
      console.error("[Open Markets] Void error:", error);
      res.status(500).json({ error: "Failed to void market" });
    }
  });

  app.post("/api/open-markets/:slug/comments", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { slug } = req.params;
      const { body, parentId } = req.body;

      if (!body || typeof body !== "string" || body.trim().length === 0) {
        return res.status(400).json({ error: "Comment body is required" });
      }

      const [market] = await db
        .select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.slug, slug),
            eq(predictionMarkets.marketType, "community")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      const [profile] = await db
        .select({ username: profiles.username, avatarUrl: profiles.avatarUrl })
        .from(profiles)
        .where(eq(profiles.id, authReq.userId!))
        .limit(1);

      const [created] = await db
        .insert(openMarketComments)
        .values({
          marketId: market.id,
          userId: authReq.userId!,
          username: profile?.username || null,
          avatarUrl: profile?.avatarUrl || null,
          body: body.trim(),
          parentId: parentId || null,
        })
        .returning();

      res.json(created);
    } catch (error) {
      console.error("[Open Markets] Comment error:", error);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  app.get("/api/open-markets/:slug/comments", async (req, res) => {
    try {
      const { slug } = req.params;

      const [market] = await db
        .select({ id: predictionMarkets.id })
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.slug, slug),
            eq(predictionMarkets.marketType, "community")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found" });
      }

      const comments = await db
        .select()
        .from(openMarketComments)
        .where(eq(openMarketComments.marketId, market.id))
        .orderBy(desc(openMarketComments.createdAt))
        .limit(50);

      res.json(comments);
    } catch (error) {
      console.error("[Open Markets] Comments list error:", error);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  app.post("/api/open-markets/:slug/bet", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const { slug } = req.params;
      const { entryId, stakeAmount } = req.body;

      if (!entryId || !stakeAmount || typeof stakeAmount !== "number" || stakeAmount <= 0) {
        return res.status(400).json({ error: "Valid entryId and positive stakeAmount are required" });
      }

      const [market] = await db
        .select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.slug, slug),
            eq(predictionMarkets.marketType, "community"),
            eq(predictionMarkets.status, "OPEN")
          )
        )
        .limit(1);

      if (!market) {
        return res.status(404).json({ error: "Market not found or not open" });
      }

      if (market.closeAt && new Date(market.closeAt) < new Date()) {
        return res.status(400).json({ error: "Betting is closed for this market" });
      }

      const [entry] = await db
        .select()
        .from(marketEntries)
        .where(
          and(
            eq(marketEntries.id, entryId),
            eq(marketEntries.marketId, market.id)
          )
        )
        .limit(1);

      if (!entry) {
        return res.status(400).json({ error: "Entry not found in this market" });
      }

      const [profile] = await db
        .select({ predictCredits: profiles.predictCredits })
        .from(profiles)
        .where(eq(profiles.id, authReq.userId!))
        .limit(1);

      if (!profile) {
        return res.status(400).json({ error: "User profile not found" });
      }

      if (profile.predictCredits < stakeAmount) {
        return res.status(400).json({ error: "Insufficient credits" });
      }

      const allEntries = await db
        .select({ totalStake: marketEntries.totalStake })
        .from(marketEntries)
        .where(eq(marketEntries.marketId, market.id));

      const totalPool = allEntries.reduce((sum, e) => sum + e.totalStake, 0) + stakeAmount;
      const entryPool = entry.totalStake + stakeAmount;
      const entryShare = entryPool / totalPool;
      const potentialPayout = Math.round(stakeAmount / Math.max(entryShare, 0.01));

      await db
        .update(profiles)
        .set({ predictCredits: profile.predictCredits - stakeAmount })
        .where(eq(profiles.id, authReq.userId!));

      const [bet] = await db
        .insert(marketBets)
        .values({
          marketId: market.id,
          entryId,
          userId: authReq.userId!,
          stakeAmount,
          potentialPayout,
          status: "active",
        })
        .returning();

      await db
        .update(marketEntries)
        .set({ totalStake: entry.totalStake + stakeAmount })
        .where(eq(marketEntries.id, entryId));

      res.json({
        ...bet,
        potentialPayout,
        remainingCredits: profile.predictCredits - stakeAmount,
      });
    } catch (error) {
      console.error("[Open Markets] Bet error:", error);
      res.status(500).json({ error: "Failed to place bet" });
    }
  });

  // ============ NATIVE PREDICTION MARKET ENDPOINTS ============

  app.get("/api/native-markets/:type", async (req, res) => {
    try {
      const { type } = req.params;
      const validTypes = ['jackpot', 'updown', 'h2h', 'gainer'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: "Invalid market type" });
      }

      const markets = await db.select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.marketType, type),
            inArray(predictionMarkets.visibility, ["live", "inactive"])
          )
        )
        .orderBy(desc(predictionMarkets.featured), predictionMarkets.category);

      const marketIds = markets.map(m => m.id);
      let entries: any[] = [];
      if (marketIds.length > 0) {
        entries = await db.select()
          .from(marketEntries)
          .where(inArray(marketEntries.marketId, marketIds))
          .orderBy(marketEntries.displayOrder);
      }

      if (type === 'updown' || type === 'jackpot') {
        const personIds = markets.map(m => m.personId).filter(Boolean) as string[];
        let persons: any[] = [];
        if (personIds.length > 0) {
          persons = await db.select().from(trendingPeople).where(inArray(trendingPeople.id, personIds));
        }
        const personMap = Object.fromEntries(persons.map(p => [p.id, p]));

        const enriched = markets.map(m => ({
          ...m,
          person: m.personId ? personMap[m.personId] || null : null,
          entries: entries.filter(e => e.marketId === m.id),
        }));
        return res.json(enriched);
      }

      if (type === 'h2h' || type === 'gainer') {
        const personEntryIds = entries.filter(e => e.personId).map(e => e.personId!);
        let persons: any[] = [];
        if (personEntryIds.length > 0) {
          persons = await db.select().from(trendingPeople).where(inArray(trendingPeople.id, personEntryIds));
        }
        const personMap = Object.fromEntries(persons.map(p => [p.id, p]));

        const enriched = markets.map(m => ({
          ...m,
          entries: entries.filter(e => e.marketId === m.id).map(e => ({
            ...e,
            person: e.personId ? personMap[e.personId] || null : null,
          })),
        }));
        return res.json(enriched);
      }

      res.json(markets.map(m => ({
        ...m,
        entries: entries.filter(e => e.marketId === m.id),
      })));
    } catch (error: any) {
      console.error("Error fetching native markets:", error.message);
      res.status(500).json({ error: "Failed to fetch native markets" });
    }
  });

  app.post("/api/admin/native-markets/generate-updown", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() + mondayOffset);
      monday.setUTCHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      sunday.setUTCHours(23, 59, 59, 999);

      const jan1 = new Date(now.getUTCFullYear(), 0, 1);
      const weekNumber = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);

      const people = await db.select().from(trackedPeople).where(eq(trackedPeople.status, "main_leaderboard"));

      const existing = await db.select({ personId: predictionMarkets.personId })
        .from(predictionMarkets)
        .where(and(
          eq(predictionMarkets.marketType, "updown"),
          eq(predictionMarkets.weekNumber, weekNumber)
        ));
      const existingPersonIds = new Set(existing.map(e => e.personId));

      let created = 0;
      for (const person of people) {
        if (existingPersonIds.has(person.id)) continue;

        const slug = `updown-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-week-${weekNumber}`;

        try {
          const [market] = await db.insert(predictionMarkets).values({
            marketType: "updown",
            title: `${person.name}: Up or Down?`,
            slug,
            personId: person.id,
            category: person.category?.toLowerCase() || "misc",
            visibility: "live",
            status: "OPEN",
            startAt: monday,
            endAt: sunday,
            weekNumber,
            seedParticipants: 0,
            seedVolume: "0",
            seedConfig: {
              enabled: true,
              targetParticipantsMin: 30,
              targetParticipantsMax: 80,
              targetPoolMin: 5000,
              targetPoolMax: 15000,
              distributionBias: { up: 55, down: 45 },
            },
            featured: false,
          }).returning();

          await db.insert(marketEntries).values([
            {
              marketId: market.id,
              entryType: "custom",
              label: "Up",
              displayOrder: 0,
              seedCount: 0,
            },
            {
              marketId: market.id,
              entryType: "custom",
              label: "Down",
              displayOrder: 1,
              seedCount: 0,
            },
          ]);

          created++;
        } catch (slugErr: any) {
          if (slugErr.code === '23505') {
            const slugRetry = `${slug}-${randomUUID().slice(0, 6)}`;
            const [market] = await db.insert(predictionMarkets).values({
              marketType: "updown",
              title: `${person.name}: Up or Down?`,
              slug: slugRetry,
              personId: person.id,
              category: person.category?.toLowerCase() || "misc",
              visibility: "live",
              status: "OPEN",
              startAt: monday,
              endAt: sunday,
              weekNumber,
              seedParticipants: 0,
              seedVolume: "0",
              seedConfig: {
                enabled: true,
                targetParticipantsMin: 30,
                targetParticipantsMax: 80,
                targetPoolMin: 5000,
                targetPoolMax: 15000,
                distributionBias: { up: 55, down: 45 },
              },
              featured: false,
            }).returning();

            await db.insert(marketEntries).values([
              { marketId: market.id, entryType: "custom", label: "Up", displayOrder: 0, seedCount: 0 },
              { marketId: market.id, entryType: "custom", label: "Down", displayOrder: 1, seedCount: 0 },
            ]);
            created++;
          } else {
            throw slugErr;
          }
        }
      }

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "create",
        targetTable: "prediction_markets",
        targetId: "bulk-updown",
        metadata: { type: "updown", created, weekNumber },
      });

      res.json({ success: true, created, weekNumber });
    } catch (error: any) {
      console.error("Error generating updown markets:", error.message);
      res.status(500).json({ error: "Failed to generate updown markets" });
    }
  });

  app.post("/api/admin/native-markets/generate-jackpot", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() + mondayOffset);
      monday.setUTCHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      sunday.setUTCHours(23, 59, 59, 999);
      const jan1 = new Date(now.getUTCFullYear(), 0, 1);
      const weekNumber = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);

      const people = await db.select().from(trackedPeople).where(eq(trackedPeople.status, "main_leaderboard"));
      const existing = await db.select({ personId: predictionMarkets.personId })
        .from(predictionMarkets)
        .where(and(eq(predictionMarkets.marketType, "jackpot"), eq(predictionMarkets.weekNumber, weekNumber)));
      const existingPersonIds = new Set(existing.map(e => e.personId));

      let created = 0;
      for (const person of people) {
        if (existingPersonIds.has(person.id)) continue;
        const slug = `jackpot-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-week-${weekNumber}`;
        try {
          await db.insert(predictionMarkets).values({
            marketType: "jackpot",
            title: `${person.name}: Predict Exact Score`,
            slug,
            personId: person.id,
            category: person.category?.toLowerCase() || "misc",
            visibility: "live",
            status: "OPEN",
            startAt: monday,
            endAt: sunday,
            weekNumber,
            seedParticipants: 0,
            seedVolume: "0",
            seedConfig: {
              enabled: true,
              targetParticipantsMin: 10,
              targetParticipantsMax: 40,
              targetPoolMin: 2000,
              targetPoolMax: 8000,
            },
            featured: false,
          });
          created++;
        } catch (slugErr: any) {
          if (slugErr.code === '23505') {
            const slugRetry = `${slug}-${randomUUID().slice(0, 6)}`;
            await db.insert(predictionMarkets).values({
              marketType: "jackpot",
              title: `${person.name}: Predict Exact Score`,
              slug: slugRetry,
              personId: person.id,
              category: person.category?.toLowerCase() || "misc",
              visibility: "live",
              status: "OPEN",
              startAt: monday,
              endAt: sunday,
              weekNumber,
              seedParticipants: 0,
              seedVolume: "0",
              seedConfig: { enabled: true, targetParticipantsMin: 10, targetParticipantsMax: 40, targetPoolMin: 2000, targetPoolMax: 8000 },
              featured: false,
            });
            created++;
          }
        }
      }

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "create",
        targetTable: "prediction_markets",
        targetId: "bulk-jackpot",
        metadata: { type: "jackpot", created, weekNumber },
      });

      res.json({ success: true, created, weekNumber });
    } catch (error: any) {
      console.error("Error generating jackpot markets:", error.message);
      res.status(500).json({ error: "Failed to generate jackpot markets" });
    }
  });

  app.post("/api/admin/native-markets/h2h", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { personAId, personBId, category, visibility = "live", featured = false, seedConfig } = req.body;

      if (!personAId || !personBId) {
        return res.status(400).json({ error: "Both person A and person B are required" });
      }
      if (personAId === personBId) {
        return res.status(400).json({ error: "Person A and B must be different" });
      }

      const [personA] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personAId));
      const [personB] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personBId));

      if (!personA || !personB) {
        return res.status(404).json({ error: "One or both celebrities not found" });
      }

      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() + mondayOffset);
      monday.setUTCHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      sunday.setUTCHours(23, 59, 59, 999);

      const jan1 = new Date(now.getUTCFullYear(), 0, 1);
      const weekNumber = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);

      const title = `${personA.name} vs ${personB.name}`;
      let slug = `h2h-${personA.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-vs-${personB.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-week-${weekNumber}`;

      const defaultSeedConfig = {
        enabled: true,
        targetParticipantsMin: 40,
        targetParticipantsMax: 120,
        targetPoolMin: 10000,
        targetPoolMax: 35000,
        distributionBias: { personA: 50, personB: 50 },
      };

      let market: any;
      try {
        [market] = await db.insert(predictionMarkets).values({
          marketType: "h2h",
          title,
          slug,
          category: category || personA.category?.toLowerCase() || "misc",
          visibility,
          featured,
          status: "OPEN",
          startAt: monday,
          endAt: sunday,
          weekNumber,
          seedParticipants: 0,
          seedVolume: "0",
          seedConfig: seedConfig || defaultSeedConfig,
        }).returning();
      } catch (slugErr: any) {
        if (slugErr.code === '23505') {
          slug = `${slug}-${randomUUID().slice(0, 6)}`;
          [market] = await db.insert(predictionMarkets).values({
            marketType: "h2h",
            title,
            slug,
            category: category || personA.category?.toLowerCase() || "misc",
            visibility,
            featured,
            status: "OPEN",
            startAt: monday,
            endAt: sunday,
            weekNumber,
            seedParticipants: 0,
            seedVolume: "0",
            seedConfig: seedConfig || defaultSeedConfig,
          }).returning();
        } else {
          throw slugErr;
        }
      }

      await db.insert(marketEntries).values([
        {
          marketId: market.id,
          entryType: "person",
          personId: personA.id,
          label: personA.name,
          displayOrder: 0,
          seedCount: 0,
          imageUrl: personA.avatar,
        },
        {
          marketId: market.id,
          entryType: "person",
          personId: personB.id,
          label: personB.name,
          displayOrder: 1,
          seedCount: 0,
          imageUrl: personB.avatar,
        },
      ]);

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "create",
        targetTable: "prediction_markets",
        targetId: market.id,
        metadata: { type: "h2h", title, personAId, personBId },
      });

      res.json(market);
    } catch (error: any) {
      console.error("Error creating H2H market:", error.message);
      res.status(500).json({ error: "Failed to create H2H market" });
    }
  });

  app.post("/api/admin/native-markets/gainer", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { category, personIds, visibility = "live", featured = false, seedConfig } = req.body;

      const validCategories = ['tech', 'politics', 'business', 'sports', 'creator', 'music'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: "Invalid category" });
      }
      if (!personIds || !Array.isArray(personIds) || personIds.length === 0) {
        return res.status(400).json({ error: "At least one person ID required" });
      }
      if (personIds.length > 20) {
        return res.status(400).json({ error: "Maximum 20 celebrities per gainer market" });
      }

      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() + mondayOffset);
      monday.setUTCHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      sunday.setUTCHours(23, 59, 59, 999);

      const jan1 = new Date(now.getUTCFullYear(), 0, 1);
      const weekNumber = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);

      const [existingGainer] = await db.select().from(predictionMarkets).where(and(
        eq(predictionMarkets.marketType, "gainer"),
        eq(predictionMarkets.category, category),
        eq(predictionMarkets.weekNumber, weekNumber)
      ));
      if (existingGainer) {
        return res.status(409).json({ error: `A Top Gainer market for ${category} already exists this week`, existingId: existingGainer.id });
      }

      const persons = await db.select().from(trackedPeople).where(inArray(trackedPeople.id, personIds));
      if (persons.length !== personIds.length) {
        return res.status(400).json({ error: "Some person IDs not found" });
      }

      const title = `Top Gainer: ${category.charAt(0).toUpperCase() + category.slice(1)}`;
      let slug = `gainer-${category}-week-${weekNumber}`;

      const defaultSeedConfig = {
        enabled: true,
        targetParticipantsMin: 25,
        targetParticipantsMax: 60,
        targetPoolMin: 8000,
        targetPoolMax: 20000,
        distributionBias: {},
      };

      let market: any;
      try {
        [market] = await db.insert(predictionMarkets).values({
          marketType: "gainer",
          title,
          slug,
          category,
          visibility,
          featured,
          status: "OPEN",
          startAt: monday,
          endAt: sunday,
          weekNumber,
          seedParticipants: 0,
          seedVolume: "0",
          seedConfig: seedConfig || defaultSeedConfig,
        }).returning();
      } catch (slugErr: any) {
        if (slugErr.code === '23505') {
          slug = `${slug}-${randomUUID().slice(0, 6)}`;
          [market] = await db.insert(predictionMarkets).values({
            marketType: "gainer",
            title,
            slug,
            category,
            visibility,
            featured,
            status: "OPEN",
            startAt: monday,
            endAt: sunday,
            weekNumber,
            seedParticipants: 0,
            seedVolume: "0",
            seedConfig: seedConfig || defaultSeedConfig,
          }).returning();
        } else {
          throw slugErr;
        }
      }

      const entryValues = persons.map((person, idx) => ({
        marketId: market.id,
        entryType: "person" as const,
        personId: person.id,
        label: person.name,
        displayOrder: idx,
        seedCount: 0,
        imageUrl: person.avatar,
      }));

      await db.insert(marketEntries).values(entryValues);

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "create",
        targetTable: "prediction_markets",
        targetId: market.id,
        metadata: { type: "gainer", category, personCount: personIds.length },
      });

      res.json(market);
    } catch (error: any) {
      console.error("Error creating gainer market:", error.message);
      res.status(500).json({ error: "Failed to create gainer market" });
    }
  });

  app.patch("/api/admin/native-markets/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { visibility, featured, seedConfig, inactiveMessage } = req.body;

      const [existing] = await db.select().from(predictionMarkets).where(eq(predictionMarkets.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Market not found" });
      }

      const updates: any = { updatedAt: new Date() };
      if (visibility !== undefined) updates.visibility = visibility;
      if (featured !== undefined) updates.featured = featured;
      if (seedConfig !== undefined) updates.seedConfig = seedConfig;
      if (inactiveMessage !== undefined) updates.inactiveMessage = inactiveMessage;

      const [updated] = await db.update(predictionMarkets)
        .set(updates)
        .where(eq(predictionMarkets.id, id))
        .returning();

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "update",
        targetTable: "prediction_markets",
        targetId: id,
        metadata: { type: existing.marketType, changes: Object.keys(updates) },
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating native market:", error.message);
      res.status(500).json({ error: "Failed to update market" });
    }
  });

  app.post("/api/admin/native-markets/bulk-visibility", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { marketIds, visibility } = req.body;
      if (!marketIds?.length || !['live', 'inactive', 'archived', 'draft'].includes(visibility)) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      await db.update(predictionMarkets)
        .set({ visibility, updatedAt: new Date() })
        .where(inArray(predictionMarkets.id, marketIds));

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "update",
        targetTable: "prediction_markets",
        targetId: "bulk",
        metadata: { visibility, count: marketIds.length },
      });

      res.json({ success: true, updated: marketIds.length });
    } catch (error: any) {
      console.error("Error bulk updating visibility:", error.message);
      res.status(500).json({ error: "Failed to bulk update" });
    }
  });

  app.delete("/api/admin/native-markets/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [existing] = await db.select().from(predictionMarkets).where(eq(predictionMarkets.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Market not found" });
      }

      await db.delete(predictionMarkets).where(eq(predictionMarkets.id, id));

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "delete",
        targetTable: "prediction_markets",
        targetId: id,
        metadata: { type: existing.marketType, title: existing.title },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting native market:", error.message);
      res.status(500).json({ error: "Failed to delete market" });
    }
  });

  app.post("/api/admin/native-markets/:id/settle", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { winnerEntryId, notes } = req.body;

      const [market] = await db.select().from(predictionMarkets).where(eq(predictionMarkets.id, id));
      if (!market) return res.status(404).json({ error: "Market not found" });
      if (market.status === "RESOLVED") return res.status(400).json({ error: "Market already resolved" });

      await db.update(predictionMarkets).set({
        status: "RESOLVED",
        resolvedAt: new Date(),
        settledBy: req.userId!,
        resolutionNotes: notes,
        updatedAt: new Date(),
      }).where(eq(predictionMarkets.id, id));

      if (winnerEntryId) {
        await db.update(marketEntries)
          .set({ resolutionStatus: "loser" })
          .where(and(eq(marketEntries.marketId, id), sql`${marketEntries.id} != ${winnerEntryId}`));
        await db.update(marketEntries)
          .set({ resolutionStatus: "winner" })
          .where(eq(marketEntries.id, winnerEntryId));
      }

      await db.insert(adminAuditLog).values({
        adminId: req.userId!,
        adminEmail: null,
        actionType: "update",
        targetTable: "prediction_markets",
        targetId: id,
        metadata: { action: "settle", winnerEntryId, type: market.marketType },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error settling market:", error.message);
      res.status(500).json({ error: "Failed to settle market" });
    }
  });

  app.patch("/api/admin/native-markets/h2h/:id/entries", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { personAId, personBId } = req.body;

      const [market] = await db.select().from(predictionMarkets).where(
        and(eq(predictionMarkets.id, id), eq(predictionMarkets.marketType, "h2h"))
      );
      if (!market) return res.status(404).json({ error: "H2H market not found" });

      const [personA] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personAId));
      const [personB] = await db.select().from(trackedPeople).where(eq(trackedPeople.id, personBId));
      if (!personA || !personB) return res.status(404).json({ error: "Person not found" });

      await db.delete(marketEntries).where(eq(marketEntries.marketId, id));

      await db.insert(marketEntries).values([
        { marketId: id, entryType: "person", personId: personA.id, label: personA.name, displayOrder: 0, seedCount: 0, imageUrl: personA.avatar },
        { marketId: id, entryType: "person", personId: personB.id, label: personB.name, displayOrder: 1, seedCount: 0, imageUrl: personB.avatar },
      ]);

      await db.update(predictionMarkets).set({
        title: `${personA.name} vs ${personB.name}`,
        updatedAt: new Date(),
      }).where(eq(predictionMarkets.id, id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating H2H entries:", error.message);
      res.status(500).json({ error: "Failed to update entries" });
    }
  });

  app.patch("/api/admin/native-markets/gainer/:id/entries", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { personIds } = req.body;

      if (!personIds?.length || personIds.length > 20) {
        return res.status(400).json({ error: "1-20 person IDs required" });
      }

      const [market] = await db.select().from(predictionMarkets).where(
        and(eq(predictionMarkets.id, id), eq(predictionMarkets.marketType, "gainer"))
      );
      if (!market) return res.status(404).json({ error: "Gainer market not found" });

      const persons = await db.select().from(trackedPeople).where(inArray(trackedPeople.id, personIds));
      if (persons.length !== personIds.length) {
        return res.status(400).json({ error: "Some person IDs not found" });
      }

      await db.delete(marketEntries).where(eq(marketEntries.marketId, id));

      const entryValues = persons.map((person, idx) => ({
        marketId: id,
        entryType: "person" as const,
        personId: person.id,
        label: person.name,
        displayOrder: idx,
        seedCount: 0,
        imageUrl: person.avatar,
      }));

      await db.insert(marketEntries).values(entryValues);

      await db.update(predictionMarkets).set({ updatedAt: new Date() }).where(eq(predictionMarkets.id, id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating gainer entries:", error.message);
      res.status(500).json({ error: "Failed to update entries" });
    }
  });

  app.post("/api/admin/seed-engine/run", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runSeedBatch } = await import("./jobs/seed-engine");
      const result = await runSeedBatch(true);
      res.json(result);
    } catch (error: any) {
      console.error("Error running seed batch:", error.message);
      res.status(500).json({ error: "Failed to run seed batch" });
    }
  });

  app.post("/api/admin/weekly-reset", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const currentWeek = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

      const openMarkets = await db.select()
        .from(predictionMarkets)
        .where(
          and(
            eq(predictionMarkets.status, "OPEN"),
            inArray(predictionMarkets.marketType, ["updown", "h2h", "gainer", "jackpot"])
          )
        );

      let settled = 0;
      for (const market of openMarkets) {
        if (market.weekNumber && market.weekNumber < currentWeek) {
          await db.update(predictionMarkets).set({
            status: "RESOLVED",
            resolvedAt: new Date(),
            settledBy: req.userId!,
            resolutionNotes: "Auto-settled by weekly reset",
            updatedAt: new Date(),
          }).where(eq(predictionMarkets.id, market.id));
          settled++;
        }
      }

      res.json({ settled, currentWeek });
    } catch (error: any) {
      console.error("Error running weekly reset:", error.message);
      res.status(500).json({ error: "Failed to run weekly reset" });
    }
  });

  // ============ ADMIN: UNDERRATED/OVERRATED MANAGEMENT ============

  // GET /api/admin/vote/underrated - List all U/O cards for admin
  app.get("/api/admin/vote/underrated", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const results = await db
        .select({
          id: trendingPeople.id,
          name: trendingPeople.name,
          category: trendingPeople.category,
          avatar: trendingPeople.avatar,
          rank: trendingPeople.rank,
          trendScore: celebrityMetrics.trendScore,
          underratedPct: celebrityMetrics.underratedPct,
          overratedPct: celebrityMetrics.overratedPct,
          fairlyRatedPct: celebrityMetrics.fairlyRatedPct,
          underratedVotesCount: celebrityMetrics.underratedVotesCount,
          overratedVotesCount: celebrityMetrics.overratedVotesCount,
          fairlyRatedVotesCount: celebrityMetrics.fairlyRatedVotesCount,
          valueScore: celebrityMetrics.valueScore,
          visibility: celebrityMetrics.visibility,
        })
        .from(trendingPeople)
        .leftJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId))
        .orderBy(asc(trendingPeople.rank));

      res.json({ data: results, totalCount: results.length });
    } catch (error: any) {
      console.error("Error fetching admin U/O cards:", error);
      res.status(500).json({ error: "Failed to fetch U/O cards" });
    }
  });

  // POST /api/admin/vote/underrated/sync - Sync U/O cards from leaderboard (idempotent)
  app.post("/api/admin/vote/underrated/sync", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const allPeople = await db.select({ id: trendingPeople.id }).from(trendingPeople);
      const existingMetrics = await db.select({ celebrityId: celebrityMetrics.celebrityId }).from(celebrityMetrics);
      const existingIds = new Set(existingMetrics.map(m => m.celebrityId));

      let created = 0;
      for (const person of allPeople) {
        if (!existingIds.has(person.id)) {
          await db.insert(celebrityMetrics).values({
            celebrityId: person.id,
            updatedAt: new Date(),
          });
          created++;
        }
      }

      res.json({ created, total: allPeople.length });
    } catch (error: any) {
      console.error("Error syncing U/O cards:", error);
      res.status(500).json({ error: "Failed to sync U/O cards" });
    }
  });

  // PATCH /api/admin/vote/underrated/:id/visibility - Update U/O visibility
  app.patch("/api/admin/vote/underrated/:id/visibility", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { visibility } = req.body;
      if (!visibility || !['live', 'inactive', 'archived'].includes(visibility)) {
        return res.status(400).json({ error: "visibility must be 'live', 'inactive', or 'archived'" });
      }
      await db.update(celebrityMetrics).set({ visibility, updatedAt: new Date() }).where(eq(celebrityMetrics.celebrityId, id));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating U/O visibility:", error);
      res.status(500).json({ error: "Failed to update visibility" });
    }
  });

  // ============ ADMIN: CURATE PROFILE MANAGEMENT ============

  // GET /api/admin/vote/curate-profile - List all curate profile cards for admin
  app.get("/api/admin/vote/curate-profile", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const results = await db
        .select({
          id: trendingPeople.id,
          name: trendingPeople.name,
          category: trendingPeople.category,
          avatar: trendingPeople.avatar,
          rank: trendingPeople.rank,
          curateVisibility: celebrityMetrics.curateVisibility,
        })
        .from(trendingPeople)
        .leftJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId))
        .orderBy(asc(trendingPeople.rank));

      const imageStats = await db
        .select({
          personId: celebrityImages.personId,
          imageCount: count(),
          totalVotes: sql<number>`COALESCE(SUM(${celebrityImages.votesUp}), 0)`,
        })
        .from(celebrityImages)
        .groupBy(celebrityImages.personId);

      const imageMap = new Map(imageStats.map(s => [s.personId, { imageCount: Number(s.imageCount), totalVotes: Number(s.totalVotes) }]));

      const data = results.map(r => ({
        ...r,
        curateVisibility: r.curateVisibility || 'live',
        imageCount: imageMap.get(r.id)?.imageCount || 0,
        totalVotes: imageMap.get(r.id)?.totalVotes || 0,
      }));

      res.json({ data, totalCount: data.length });
    } catch (error: any) {
      console.error("Error fetching admin curate profile cards:", error);
      res.status(500).json({ error: "Failed to fetch curate profile cards" });
    }
  });

  // PATCH /api/admin/vote/curate-profile/:id/visibility - Update curate profile visibility
  app.patch("/api/admin/vote/curate-profile/:id/visibility", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { visibility } = req.body;
      if (!visibility || !['live', 'inactive', 'archived'].includes(visibility)) {
        return res.status(400).json({ error: "visibility must be 'live', 'inactive', or 'archived'" });
      }
      await db.update(celebrityMetrics).set({ curateVisibility: visibility, updatedAt: new Date() }).where(eq(celebrityMetrics.celebrityId, id));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating curate visibility:", error);
      res.status(500).json({ error: "Failed to update visibility" });
    }
  });

  // GET /api/admin/vote/curate-profile/:id/images - List all images for a celebrity
  app.get("/api/admin/vote/curate-profile/:id/images", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const images = await db
        .select()
        .from(celebrityImages)
        .where(eq(celebrityImages.personId, id))
        .orderBy(desc(celebrityImages.votesUp));
      res.json({ data: images });
    } catch (error: any) {
      console.error("Error fetching celebrity images:", error);
      res.status(500).json({ error: "Failed to fetch images" });
    }
  });

  async function syncWinningAvatarForPerson(personId: string) {
    const [topImage] = await db
      .select()
      .from(celebrityImages)
      .where(eq(celebrityImages.personId, personId))
      .orderBy(desc(sql`(${celebrityImages.votesUp} - ${celebrityImages.votesDown})`))
      .limit(1);

    if (topImage) {
      console.log(`[AvatarSync] Person ${personId}: winning image ${topImage.id} (votesUp=${topImage.votesUp}, votesDown=${topImage.votesDown}, url=${topImage.imageUrl.substring(0, 60)}...)`);
      await db.update(celebrityImages).set({ isPrimary: false }).where(eq(celebrityImages.personId, personId));
      await db.update(celebrityImages).set({ isPrimary: true }).where(eq(celebrityImages.id, topImage.id));
      await db.update(trackedPeople).set({ avatar: topImage.imageUrl }).where(eq(trackedPeople.id, personId));
      await db.update(trendingPeople).set({ avatar: topImage.imageUrl }).where(eq(trendingPeople.id, personId));
    }
  }

  // PATCH /api/admin/vote/curate-profile/images/:imageId/seed-votes - Set seed votes for an image
  app.patch("/api/admin/vote/curate-profile/images/:imageId/seed-votes", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { imageId } = req.params;
      const { votesUp } = req.body;
      if (typeof votesUp !== 'number' || votesUp < 0) {
        return res.status(400).json({ error: "votesUp must be a non-negative number" });
      }
      const [image] = await db.select().from(celebrityImages).where(eq(celebrityImages.id, imageId));
      if (!image) return res.status(404).json({ error: "Image not found" });

      await db.update(celebrityImages)
        .set({ votesUp })
        .where(eq(celebrityImages.id, imageId));

      await syncWinningAvatarForPerson(image.personId);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error setting seed votes:", error);
      res.status(500).json({ error: "Failed to set seed votes" });
    }
  });

  // POST /api/admin/vote/curate-profile/:id/images - Add a new image for a celebrity
  app.post("/api/admin/vote/curate-profile/:id/images", requireAuth, requireAdmin, upload.single('file'), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      const timestamp = Date.now();
      const filePath = `curate-profile/${id}/${timestamp}${ext}`;
      const bucketName = "public-images";

      const { data: buckets } = await supabaseServer.storage.listBuckets();
      const bucketExists = buckets?.some(b => b.name === bucketName);
      if (!bucketExists) {
        const { error: createError } = await supabaseServer.storage.createBucket(bucketName, {
          public: true,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          fileSizeLimit: 2 * 1024 * 1024,
        });
        if (createError) {
          console.error("Failed to create bucket:", createError);
          return res.status(500).json({ error: "Failed to create storage bucket" });
        }
      }

      const { error: uploadError } = await supabaseServer.storage
        .from(bucketName)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        console.error("Supabase upload error:", uploadError);
        return res.status(500).json({ error: "Failed to upload image" });
      }

      const { data: urlData } = supabaseServer.storage
        .from(bucketName)
        .getPublicUrl(filePath);

      const source = (req.body.source as string) || "admin_upload";

      const [newImage] = await db.insert(celebrityImages).values({
        personId: id,
        imageUrl: urlData.publicUrl,
        source,
        isPrimary: false,
        votesUp: 0,
        votesDown: 0,
      }).returning();

      res.json({ success: true, image: newImage });
    } catch (error: any) {
      console.error("Error adding celebrity image:", error);
      if (error.message?.includes('Only PNG')) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to add image" });
    }
  });

  // DELETE /api/admin/vote/curate-profile/images/:imageId - Delete a celebrity image
  app.delete("/api/admin/vote/curate-profile/images/:imageId", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { imageId } = req.params;

      const [image] = await db.select().from(celebrityImages).where(eq(celebrityImages.id, imageId)).limit(1);
      if (!image) return res.status(404).json({ error: "Image not found" });

      if (image.imageUrl.includes('supabase')) {
        try {
          const publicPrefix = '/storage/v1/object/public/';
          const idx = image.imageUrl.indexOf(publicPrefix);
          if (idx !== -1) {
            const afterPrefix = image.imageUrl.substring(idx + publicPrefix.length);
            const slashIdx = afterPrefix.indexOf('/');
            if (slashIdx !== -1) {
              const bucketName = afterPrefix.substring(0, slashIdx);
              const objectPath = afterPrefix.substring(slashIdx + 1);
              await supabaseServer.storage.from(bucketName).remove([objectPath]);
            }
          }
        } catch (e) {
          console.warn("Failed to delete from Supabase storage:", e);
        }
      }

      await db.delete(celebrityImages).where(eq(celebrityImages.id, imageId));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting celebrity image:", error);
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  // ============ ADMIN: INDUCTION QUEUE MANAGEMENT ============

  // GET /api/vote/induction - Public: list active induction candidates
  app.get("/api/vote/induction", async (req, res) => {
    try {
      const candidates = await db
        .select()
        .from(inductionCandidates)
        .where(eq(inductionCandidates.isActive, true))
        .orderBy(desc(inductionCandidates.seedVotes));
      res.json({ data: candidates, totalCount: candidates.length });
    } catch (error: any) {
      console.error("Error fetching induction candidates:", error);
      res.status(500).json({ error: "Failed to fetch induction candidates" });
    }
  });

  // POST /api/vote/induction/:id/vote - Public: vote for an induction candidate
  app.post("/api/vote/induction/:id/vote", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [candidate] = await db.select().from(inductionCandidates).where(eq(inductionCandidates.id, id)).limit(1);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });
      if (!candidate.isActive) return res.status(400).json({ error: "Candidate is not active" });

      await db.update(inductionCandidates)
        .set({ seedVotes: sql`${inductionCandidates.seedVotes} + 1` })
        .where(eq(inductionCandidates.id, id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error voting for induction candidate:", error);
      res.status(500).json({ error: "Failed to vote" });
    }
  });

  // GET /api/admin/induction - Admin: list all induction candidates
  app.get("/api/admin/induction", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const candidates = await db
        .select()
        .from(inductionCandidates)
        .orderBy(desc(inductionCandidates.seedVotes));
      res.json({ data: candidates, totalCount: candidates.length });
    } catch (error: any) {
      console.error("Error fetching admin induction candidates:", error);
      res.status(500).json({ error: "Failed to fetch induction candidates" });
    }
  });

  // POST /api/admin/induction - Admin: create a new induction candidate
  app.post("/api/admin/induction", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { displayName, category, imageSlug, wikiSlug, seedVotes } = req.body;
      if (!displayName || !category) return res.status(400).json({ error: "displayName and category are required" });

      const autoSlug = imageSlug || displayName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

      const existing = await db.select({ id: inductionCandidates.id }).from(inductionCandidates).where(eq(inductionCandidates.displayName, displayName)).limit(1);
      if (existing.length > 0) return res.status(409).json({ error: "Candidate with this name already exists" });

      const [created] = await db.insert(inductionCandidates).values({
        displayName,
        category,
        imageSlug: autoSlug,
        wikiSlug: wikiSlug || null,
        seedVotes: seedVotes || 0,
        isActive: true,
      }).returning();

      res.json(created);
    } catch (error: any) {
      console.error("Error creating induction candidate:", error);
      res.status(500).json({ error: "Failed to create candidate" });
    }
  });

  // PATCH /api/admin/induction/:id - Admin: update an induction candidate
  app.patch("/api/admin/induction/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { displayName, category, imageSlug, wikiSlug, seedVotes, isActive } = req.body;

      const updates: any = {};
      if (displayName !== undefined) updates.displayName = displayName;
      if (category !== undefined) updates.category = category;
      if (imageSlug !== undefined) updates.imageSlug = imageSlug;
      if (wikiSlug !== undefined) updates.wikiSlug = wikiSlug;
      if (seedVotes !== undefined) updates.seedVotes = seedVotes;
      if (isActive !== undefined) updates.isActive = isActive;

      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update" });

      const [updated] = await db.update(inductionCandidates).set(updates).where(eq(inductionCandidates.id, id)).returning();
      if (!updated) return res.status(404).json({ error: "Candidate not found" });

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating induction candidate:", error);
      res.status(500).json({ error: "Failed to update candidate" });
    }
  });

  // POST /api/admin/induction/:id/approve - Admin: approve and induct to leaderboard
  app.post("/api/admin/induction/:id/approve", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [candidate] = await db.select().from(inductionCandidates).where(eq(inductionCandidates.id, id)).limit(1);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });

      const existingPerson = await db.select({ id: trackedPeople.id }).from(trackedPeople).where(eq(trackedPeople.name, candidate.displayName)).limit(1);

      let personId: string;

      if (existingPerson.length > 0) {
        personId = existingPerson[0].id;
      } else {
        const maxOrder = await db.select({ maxOrder: sql<number>`COALESCE(MAX(${trackedPeople.displayOrder}), 0)` }).from(trackedPeople);
        const [newPerson] = await db.insert(trackedPeople).values({
          name: candidate.displayName,
          category: candidate.category,
          imageSlug: candidate.imageSlug,
          wikiSlug: candidate.wikiSlug,
          displayOrder: (maxOrder[0]?.maxOrder || 0) + 1,
          status: 'main_leaderboard',
        }).returning();
        personId = newPerson.id;

        await db.insert(trendingPeople).values({
          id: personId,
          name: candidate.displayName,
          category: candidate.category,
          rank: 999,
          trendScore: 0,
          fameIndex: 0,
        }).onConflictDoNothing();
      }

      await db.insert(celebrityMetrics).values({
        celebrityId: personId,
        updatedAt: new Date(),
      }).onConflictDoNothing();

      await db.update(inductionCandidates).set({ isActive: false }).where(eq(inductionCandidates.id, id));

      res.json({ success: true, personId, message: "Candidate approved and added to leaderboard" });
    } catch (error: any) {
      console.error("Error approving induction candidate:", error);
      res.status(500).json({ error: "Failed to approve candidate" });
    }
  });

  // POST /api/admin/induction/:id/reject - Admin: deactivate candidate
  app.post("/api/admin/induction/:id/reject", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [updated] = await db.update(inductionCandidates).set({ isActive: false }).where(eq(inductionCandidates.id, id)).returning();
      if (!updated) return res.status(404).json({ error: "Candidate not found" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error rejecting induction candidate:", error);
      res.status(500).json({ error: "Failed to reject candidate" });
    }
  });

  // DELETE /api/admin/induction/:id - Admin: delete candidate
  app.delete("/api/admin/induction/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const [deleted] = await db.delete(inductionCandidates).where(eq(inductionCandidates.id, id)).returning();
      if (!deleted) return res.status(404).json({ error: "Candidate not found" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting induction candidate:", error);
      res.status(500).json({ error: "Failed to delete candidate" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
