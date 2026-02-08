import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generateMockPlatformInsights } from "./api-integrations";
import { db } from "./db";
import { trendSnapshots, trackedPeople, communityInsights, insightVotes, insightComments, commentVotes, faceOffs, votes, xpActions, celebrityImages, profiles, userFavourites, trendingPeople, creditLedger, adminAuditLog, predictionMarkets, pageViews, apiCache, sentimentVotes, celebrityMetrics, celebrityValueVotes, userVotes, trendingPolls, trendingPollVotes, insertCommunityInsightSchema, insertInsightVoteSchema, insertInsightCommentSchema, insertCommentVoteSchema, insertVoteSchema, type CelebrityProfile, type InsertCelebrityProfile, type FaceOff, type Vote, type Profile, type TrendingPoll } from "@shared/schema";
import { eq, desc, and, gt, sql, count, gte, ilike, SQL } from "drizzle-orm";
import { seedSupabasePersons } from "./supabase-seed";
import { supabaseServer } from "./supabase";
import { requireAuth, optionalAuth, type AuthRequest } from "./auth-middleware";
import OpenAI from "openai";
import { createHash } from "crypto";
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
} from "./scoring/normalize";
import {
  getCurrentHealthSnapshot,
  hasAnyDegradedSource,
  getHealthSummary,
} from "./scoring/sourceHealth";

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
          approvalVotesCount: celebrityMetrics.approvalVotesCount,
          underratedPct: celebrityMetrics.underratedPct,
          overratedPct: celebrityMetrics.overratedPct,
          valueScore: celebrityMetrics.valueScore,
        })
        .from(celebrityMetrics);
      
      // Create a lookup map for metrics
      const metricsMap = new Map<string, typeof metrics[0]>();
      for (const m of metrics) {
        metricsMap.set(m.celebrityId, m);
      }

      // Merge metrics into people
      let enrichedPeople = people.map(p => {
        const m = metricsMap.get(p.id);
        return {
          ...p,
          approvalPct: m?.approvalPct ?? null,
          approvalVotesCount: m?.approvalVotesCount ?? null,
          underratedPct: m?.underratedPct ?? null,
          overratedPct: m?.overratedPct ?? null,
          valueScore: m?.valueScore ?? null,
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
        // Sort by approval percentage (highest first, nulls last)
        enrichedPeople.sort((a, b) => {
          if (a.approvalPct === null && b.approvalPct === null) return 0;
          if (a.approvalPct === null) return 1;
          if (b.approvalPct === null) return -1;
          return b.approvalPct - a.approvalPct;
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

      // Return paginated response with totalCount
      res.json({
        data: enrichedPeople,
        totalCount,
        hasMore: limit ? (parseInt(offset as string || '0', 10) + enrichedPeople.length) < totalCount : false
      });
    } catch (error) {
      console.error("Error fetching trending people:", error);
      res.status(500).json({ error: "Failed to fetch trending data" });
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

      res.json(person);
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
        .orderBy(desc(trendSnapshots.timestamp))
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
          x: formatRelativeTime(context.sourceTimestamps.x),
        },
      });
    } catch (error) {
      console.error("Error fetching trend context:", error);
      res.status(500).json({ error: "Failed to fetch trend context" });
    }
  });
  
  // Get trend context for multiple people (batch endpoint for leaderboard)
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
            x: formatRelativeTime(context.sourceTimestamps.x),
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
      
      for (const stat of cacheStats) {
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
      
      res.json({
        freshness,
        systemStatus: Object.values(freshness).every(f => f.status !== "stale") ? "healthy" : "degraded",
      });
    } catch (error) {
      console.error("Error fetching system freshness:", error);
      res.status(500).json({ error: "Failed to fetch system status" });
    }
  });

  // Get top movers (gainers/droppers)
  app.get("/api/trending/movers/:type", async (req, res) => {
    try {
      const { type } = req.params;
      let people = await storage.getTrendingPeople();
      
      // If storage is empty, return empty array (ingestion job populates the database)
      // DO NOT fetch mock data here - it corrupts real scores
      if (people.length === 0) {
        console.log('[API] trending_people is empty for movers - waiting for ingestion job');
        res.json([]);
        return;
      }

      if (type === 'gainers') {
        people = [...people].sort((a, b) => (b.change7d ?? 0) - (a.change7d ?? 0)).slice(0, 10);
      } else if (type === 'droppers') {
        people = [...people].sort((a, b) => (a.change7d ?? 0) - (b.change7d ?? 0)).slice(0, 10);
      } else if (type === 'daily') {
        people = [...people].sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0)).slice(0, 10);
      }

      res.json(people);
    } catch (error) {
      console.error("Error fetching movers:", error);
      res.status(500).json({ error: "Failed to fetch movers data" });
    }
  });

  // Get platform insights for a person
  app.get("/api/people/:id/insights", async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get person details from database
      const [person] = await db
        .select()
        .from(trackedPeople)
        .where(eq(trackedPeople.id, id))
        .limit(1);
      
      if (!person) {
        return res.status(404).json({ error: "Person not found" });
      }
      
      // Generate mock platform insights
      const insights = generateMockPlatformInsights(person.name);
      
      // Generate mock follower counts for each platform
      const hash = person.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const followerCounts = {
        'X': Math.round(1000000 + (hash % 50000000)), // 1M-51M followers
        'YouTube': Math.round(500000 + (hash % 20000000)), // 500K-20.5M subscribers
        'Instagram': Math.round(2000000 + (hash % 100000000)), // 2M-102M followers
        'TikTok': Math.round(5000000 + (hash % 150000000)), // 5M-155M followers
        'Spotify': Math.round(100000 + (hash % 10000000)), // 100K-10.1M monthly listeners
        'News': 0, // No followers for news
      };
      
      // Add follower counts to the response
      res.json({
        insights,
        followerCounts,
      });
    } catch (error) {
      console.error("Error fetching platform insights:", error);
      res.status(500).json({ error: "Failed to fetch platform insights" });
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
        })
        .from(celebrityMetrics)
        .where(eq(celebrityMetrics.celebrityId, celebrityId))
        .limit(1);

      const seedApprovalCount = existingMetrics?.seedApprovalCount || 0;
      const seedApprovalSum = existingMetrics?.seedApprovalSum || 0;
      const seedUnderratedCount = existingMetrics?.seedUnderratedCount || 0;
      const seedOverratedCount = existingMetrics?.seedOverratedCount || 0;

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

      const realUnderratedCount = Number(underratedResult[0]?.count || 0);
      const realOverratedCount = Number(overratedResult[0]?.count || 0);

      // Calculate DISPLAY totals: seed + real
      const underratedVotesCount = seedUnderratedCount + realUnderratedCount;
      const overratedVotesCount = seedOverratedCount + realOverratedCount;
      const totalValueVotes = underratedVotesCount + overratedVotesCount;

      let underratedPct: number | null = null;
      let overratedPct: number | null = null;
      let valueScore: number | null = null;

      if (totalValueVotes > 0) {
        underratedPct = Math.round((underratedVotesCount / totalValueVotes) * 100);
        overratedPct = Math.round((overratedVotesCount / totalValueVotes) * 100);
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
          underratedVotesCount,
          overratedVotesCount,
          underratedPct,
          overratedPct,
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
            underratedPct,
            overratedPct,
            valueScore,
            updatedAt: new Date(),
          },
        });

      return {
        approvalPct,
        underratedPct,
        overratedPct,
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

      if (!vote || !['underrated', 'overrated'].includes(vote)) {
        return res.status(400).json({ error: "vote must be 'underrated' or 'overrated'" });
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
        valueScore: metrics?.valueScore ?? null,
        underratedVotesCount: metrics?.underratedVotesCount ?? 0,
        overratedVotesCount: metrics?.overratedVotesCount ?? 0,
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

      // Generate consistent distribution based on average rating
      // This creates a bell curve centered around the average rating
      const generateDistribution = (avg: number) => {
        const weights = [0, 0, 0, 0, 0];
        
        // Create a distribution that peaks at the rating closest to avg
        for (let i = 0; i < 5; i++) {
          const rating = i + 1;
          const distance = Math.abs(rating - avg);
          // Higher weight for ratings closer to average
          weights[i] = Math.exp(-distance * 0.8);
        }
        
        // Normalize to 100%
        const total = weights.reduce((a, b) => a + b, 0);
        const normalized = weights.map(w => Math.round((w / total) * 100));
        
        // Adjust to ensure sum is exactly 100
        const sum = normalized.reduce((a, b) => a + b, 0);
        if (sum !== 100) {
          // Add/subtract difference from the largest value
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
        distribution: generateDistribution(avgRating)
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
      
      // Apply category filter if provided
      if (category && category !== 'all') {
        conditions.push(eq(trendingPeople.category, category));
      }
      
      // Apply search filter if provided
      if (search && search.trim()) {
        const searchTerm = `%${search.trim().toLowerCase()}%`;
        conditions.push(sql`LOWER(${trendingPeople.name}) LIKE ${searchTerm}`);
      }

      // Get total count for pagination (before limit/offset)
      let countQuery = db
        .select({ count: sql<number>`COUNT(*)` })
        .from(trendingPeople);
      
      if (conditions.length > 0) {
        countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
      }
      
      const [countResult] = await countQuery;
      const totalCount = Number(countResult?.count) || 0;

      // Base query: join trending_people with celebrity_metrics
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
          // Metrics
          approvalPct: celebrityMetrics.approvalPct,
          approvalVotesCount: celebrityMetrics.approvalVotesCount,
          underratedPct: celebrityMetrics.underratedPct,
          overratedPct: celebrityMetrics.overratedPct,
          valueScore: celebrityMetrics.valueScore,
        })
        .from(trendingPeople)
        .leftJoin(celebrityMetrics, eq(trendingPeople.id, celebrityMetrics.celebrityId));

      // Apply filters
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      // Determine sort column based on tab
      let orderByColumn;
      switch (tab) {
        case 'approval':
          orderByColumn = celebrityMetrics.approvalPct;
          break;
        case 'value':
          orderByColumn = celebrityMetrics.valueScore;
          break;
        case 'fame':
        default:
          orderByColumn = trendingPeople.fameIndex;
          break;
      }

      // Apply sort order (nulls last, alphabetical tiebreaker for equal values)
      if (sortDir === 'asc') {
        query = query.orderBy(sql`${orderByColumn} ASC NULLS LAST, ${trendingPeople.name} ASC`) as typeof query;
      } else {
        query = query.orderBy(sql`${orderByColumn} DESC NULLS LAST, ${trendingPeople.name} ASC`) as typeof query;
      }

      query = query.limit(limit).offset(offset) as typeof query;

      const results = await query;

      // If user is authenticated and on value tab, fetch their votes
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

      // Map results with user vote state
      const leaderboard = results.map((person, index) => ({
        ...person,
        leaderboardRank: offset + index + 1,
        userValueVote: userValueVotes[person.id] || null,
      }));

      res.json({
        tab,
        sortDir,
        total: leaderboard.length,
        totalCount,
        data: leaderboard,
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

  const WHY_TRENDING_PROMPT_VERSION = 2;
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
    return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
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
      
      // A) Top-10 hysteresis: update eligibility state, then check it
      const eligible = await updateTop10Eligibility(personId, person.rank ?? null);
      
      if (!eligible) {
        return res.json({
          personId,
          personName: person.name,
          hasContext: false,
          message: "Why Trending is only available for top 10 ranked celebrities",
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
      const WHY_TRENDING_LOCK_TTL_SECONDS = 60;
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
          if (previousResult.inputHash === currentInputHash && previousResult.hasContext) {
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
      const prompt = `Based on these recent news headlines about ${person.name}, write a brief 1-2 sentence summary explaining why they are currently trending or in the news.

IMPORTANT GUIDELINES:
- Be strictly neutral and objective - do not express opinions or take sides
- Focus only on factual events and actions, not interpretations or judgments
- Avoid loaded, biased, or emotionally charged language
- Do not use words like "controversial", "criticized", "scandal", "backlash" unless directly quoting a headline
- Present information as a neutral news reporter would
- For political figures, be especially careful to remain impartial and balanced

Headlines:
${headlinesText}

Return a JSON object with:
{
  "summary": "1-2 sentence neutral, factual summary of why they're trending",
  "category": "One of: Politics, Business, Entertainment, Sports, Technology, Legal, Personal Life, Controversy, or General News"
}

Be concise, factual, and strictly neutral. Only return the JSON object.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
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
      // Release lock on error so it doesn't block for 60s
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

  // Polymarket API proxy (to avoid CORS issues)
  app.post("/api/polymarket/markets", async (req, res) => {
    try {
      const { personName } = req.body;
      
      if (!personName || typeof personName !== 'string') {
        return res.status(400).json({ error: "personName is required" });
      }

      const query = `
        query GetPersonMarkets($name: String!) {
          markets(search: $name, limit: 5, sort: "volume") {
            id
            question
            slug
            volume
            endDate
          }
        }
      `;

      const response = await fetch("https://api.polymarket.com/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { name: personName },
        }),
      });

      if (!response.ok) {
        throw new Error(`Polymarket API error: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.errors) {
        throw new Error(result.errors[0]?.message || "GraphQL error");
      }

      res.json({ markets: result.data?.markets || [] });
    } catch (error: any) {
      console.error("Polymarket proxy error:", error.message);
      res.status(500).json({ error: "Failed to fetch prediction markets", markets: [] });
    }
  });

  // ==================== Face-Offs API ====================
  
  // Get all face-offs with vote counts (with dynamic avatar lookup from tracked_people)
  app.get("/api/face-offs", async (req, res) => {
    try {
      const { category, active } = req.query;
      
      // Get all face-offs
      let faceOffList = await db.select().from(faceOffs).orderBy(desc(faceOffs.createdAt));
      
      // Filter by category if provided
      if (category && category !== 'All') {
        faceOffList = faceOffList.filter(f => f.category === category);
      }
      
      // Filter by active status if provided
      if (active === 'true') {
        faceOffList = faceOffList.filter(f => f.isActive);
      }
      
      // Build a lookup map for celebrity avatars (name -> avatar URL)
      const celebrities = await db.select({
        name: trackedPeople.name,
        avatar: trackedPeople.avatar,
      }).from(trackedPeople);
      
      const avatarLookup: Record<string, string | null> = {};
      for (const celeb of celebrities) {
        avatarLookup[celeb.name.toLowerCase()] = celeb.avatar;
      }
      
      // Get vote counts for each face-off and dynamically resolve avatars
      const faceOffsWithVotes = await Promise.all(faceOffList.map(async (faceOff) => {
        const voteResults = await db.select({
          value: votes.value,
          count: count(),
        })
        .from(votes)
        .where(and(
          eq(votes.voteType, 'face_off'),
          eq(votes.targetId, faceOff.id)
        ))
        .groupBy(votes.value);
        
        const optionAVotes = voteResults.find(v => v.value === 'option_a')?.count || 0;
        const optionBVotes = voteResults.find(v => v.value === 'option_b')?.count || 0;
        const totalVotes = Number(optionAVotes) + Number(optionBVotes);
        
        // Dynamically resolve avatars from tracked_people (fallback to snapshot)
        const optionAImageResolved = avatarLookup[faceOff.optionAText.toLowerCase()] || faceOff.optionAImage;
        const optionBImageResolved = avatarLookup[faceOff.optionBText.toLowerCase()] || faceOff.optionBImage;
        
        return {
          ...faceOff,
          optionAImage: optionAImageResolved,
          optionBImage: optionBImageResolved,
          optionAVotes: Number(optionAVotes),
          optionBVotes: Number(optionBVotes),
          totalVotes,
          optionAPercent: totalVotes > 0 ? Math.round((Number(optionAVotes) / totalVotes) * 100) : 50,
          optionBPercent: totalVotes > 0 ? Math.round((Number(optionBVotes) / totalVotes) * 100) : 50,
        };
      }));
      
      res.json(faceOffsWithVotes);
    } catch (error: any) {
      console.error("Error fetching face-offs:", error.message);
      res.status(500).json({ error: "Failed to fetch face-offs" });
    }
  });
  
  // Get user's votes on face-offs (supports anonymous via session ID)
  app.get("/api/face-offs/user-votes", optionalAuth, async (req: AuthRequest, res) => {
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
      
      // Convert to a map of faceOffId -> votedOption
      const voteMap: Record<string, string> = {};
      userVotes.forEach(vote => {
        voteMap[vote.targetId] = vote.value;
      });
      
      res.json(voteMap);
    } catch (error: any) {
      console.error("Error fetching user face-off votes:", error.message);
      res.status(500).json({ error: "Failed to fetch user votes" });
    }
  });
  
  // Submit a vote on a face-off (supports anonymous via session ID)
  app.post("/api/face-offs/:id/vote", optionalAuth, async (req: AuthRequest, res) => {
    try {
      // Use userId if logged in, otherwise use session ID for anonymous voting
      const voterId = req.userId || req.sessionId;
      if (!voterId) {
        return res.status(400).json({ error: "Unable to track vote - no session available" });
      }
      
      const { id } = req.params;
      const { option } = req.body;
      
      if (!option || (option !== 'option_a' && option !== 'option_b')) {
        return res.status(400).json({ error: "Invalid option. Must be 'option_a' or 'option_b'" });
      }
      
      // Check if face-off exists
      const [faceOff] = await db.select().from(faceOffs).where(eq(faceOffs.id, id));
      if (!faceOff) {
        return res.status(404).json({ error: "Face-off not found" });
      }
      
      // Check if user/session already voted
      const [existingVote] = await db.select()
        .from(votes)
        .where(and(
          eq(votes.userId, voterId),
          eq(votes.voteType, 'face_off'),
          eq(votes.targetId, id)
        ));
      
      if (existingVote) {
        return res.status(400).json({ error: "You have already voted on this face-off" });
      }
      
      // Insert the vote
      await db.insert(votes).values({
        userId: voterId,
        voteType: 'face_off',
        targetType: 'face_off',
        targetId: id,
        value: option,
        weight: 1.0,
      });
      
      // Award XP for authenticated users only (not anonymous sessions)
      let xpResult = null;
      if (req.userId) {
        try {
          xpResult = await gamificationService.awardXp(
            req.userId,
            'vote_face_off',
            `face_off_${id}_${req.userId}`, // Unique idempotency key
            { faceOffId: id, votedOption: option }
          );
        } catch (xpError) {
          console.error("XP award failed:", xpError);
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
      
      const optionAVotes = voteResults.find(v => v.value === 'option_a')?.count || 0;
      const optionBVotes = voteResults.find(v => v.value === 'option_b')?.count || 0;
      const totalVotes = Number(optionAVotes) + Number(optionBVotes);
      
      res.json({
        success: true,
        optionAVotes: Number(optionAVotes),
        optionBVotes: Number(optionBVotes),
        totalVotes,
        optionAPercent: totalVotes > 0 ? Math.round((Number(optionAVotes) / totalVotes) * 100) : 50,
        optionBPercent: totalVotes > 0 ? Math.round((Number(optionBVotes) / totalVotes) * 100) : 50,
        votedOption: option,
        xpAwarded: xpResult?.success ? xpResult.xpAwarded : 0,
      });
    } catch (error: any) {
      console.error("Error submitting face-off vote:", error.message);
      res.status(500).json({ error: "Failed to submit vote" });
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
  const ADMIN_EMAILS = ["shaun.burgess21@gmail.com"];
  
  // Sync profile after Supabase auth - creates profile if doesn't exist
  // Implements admin backdoor for specific emails
  app.post("/api/profile/sync", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.userId!;
      
      // Get user details from Supabase with retry logic
      let user = null;
      let userError = null;
      
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await supabaseServer.auth.admin.getUserById(userId);
        user = result.data?.user;
        userError = result.error;
        
        if (user) break;
        
        // Wait before retry (100ms, 200ms, 400ms)
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
        }
      }
      
      if (userError || !user) {
        console.error(`[Profile] Failed to fetch user ${userId}:`, userError?.message || "User not found");
        return res.status(400).json({ error: "Could not fetch user details", details: userError?.message });
      }
      
      const email = user.email;
      const fullName = user.user_metadata?.full_name || user.user_metadata?.name || null;
      const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
      
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

      // Check 2: Look at Supabase Auth Metadata
      const { data: { user }, error: authError } = await supabaseServer.auth.admin.getUserById(userId);
      if (authError) {
        console.log(`[requireAdmin] Step 5 - Supabase auth error: ${authError.message}`);
      }
      const authEmail = user?.email || "NO_EMAIL";
      const authEmailLower = authEmail.toLowerCase();
      const authMetaRole = user?.user_metadata?.role || "NOT_SET";
      const isAuthAdmin = user?.user_metadata?.role === 'admin';
      
      console.log(`[requireAdmin] Step 5 - Supabase Auth email: "${authEmail}"`);
      console.log(`[requireAdmin] Step 6 - Email (lowercase): "${authEmailLower}"`);
      console.log(`[requireAdmin] Step 7 - Supabase Auth metadata role: "${authMetaRole}"`);
      console.log(`[requireAdmin] Step 8 - isAuthAdmin check: ${isAuthAdmin}`);
      
      // Check against ADMIN_EMAILS list (case-insensitive)
      const adminEmailsLower = ADMIN_EMAILS.map(e => e.toLowerCase());
      const isInAdminList = adminEmailsLower.includes(authEmailLower);
      console.log(`[requireAdmin] Step 9 - ADMIN_EMAILS list: [${ADMIN_EMAILS.join(", ")}]`);
      console.log(`[requireAdmin] Step 10 - Is email in ADMIN_EMAILS (case-insensitive)? ${isInAdminList}`);
      
      console.log(`[requireAdmin] SUMMARY: isDbAdmin=${isDbAdmin}, isAuthAdmin=${isAuthAdmin}, isInAdminList=${isInAdminList}`);

      // If EITHER is true, let them in
      if (isDbAdmin || isAuthAdmin) {
        console.log(`[requireAdmin] ACCESS GRANTED - Reason: ${isDbAdmin ? "DB_ROLE" : "AUTH_METADATA"}`);
        console.log(`==========================================\n`);
        return next();
      }

      console.log(`[requireAdmin] ACCESS DENIED - Neither DB role nor Auth metadata is 'admin'`);
      console.log(`==========================================\n`);
      return res.status(403).json({ error: "Admin access required" });
    } catch (error: any) {
      console.error("[requireAdmin] ERROR:", error.message);
      console.log(`==========================================\n`);
      res.status(500).json({ error: "Failed to verify admin status" });
    }
  };
  
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
      const markets = await db.select().from(predictionMarkets).orderBy(desc(predictionMarkets.createdAt)).limit(100);
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
        .orderBy(desc(trendSnapshots.timestamp))
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
          x: PLATFORM_WEIGHTS.velocity.x,
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

  // Face-Offs CRUD
  app.get("/api/admin/face-offs", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const faceOffList = await db.select().from(faceOffs).orderBy(faceOffs.displayOrder, desc(faceOffs.createdAt));
      res.json(faceOffList);
    } catch (error: any) {
      console.error("Error fetching face-offs:", error.message);
      res.status(500).json({ error: "Failed to fetch face-offs" });
    }
  });

  app.post("/api/admin/face-offs", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { title, category, optionAText, optionAImage, optionBText, optionBImage, isActive } = req.body;
      const adminId = req.userId!;
      
      if (!title || !optionAText || !optionBText) {
        return res.status(400).json({ error: "Title and both options are required" });
      }
      
      // Get next display order
      const [maxOrder] = await db.select({ max: sql<number>`COALESCE(MAX(display_order), 0)` }).from(faceOffs);
      const nextOrder = (maxOrder?.max || 0) + 1;
      
      const [created] = await db.insert(faceOffs).values({
        title,
        category: category || 'General',
        optionAText,
        optionAImage: optionAImage || null,
        optionBText,
        optionBImage: optionBImage || null,
        isActive: isActive !== false,
        displayOrder: nextOrder,
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
      console.error("Error creating face-off:", error.message);
      res.status(500).json({ error: "Failed to create face-off" });
    }
  });

  app.patch("/api/admin/face-offs/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { title, category, optionAText, optionAImage, optionBText, optionBImage, isActive, displayOrder } = req.body;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(faceOffs).where(eq(faceOffs.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Face-off not found" });
      }
      
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (category !== undefined) updates.category = category;
      if (optionAText !== undefined) updates.optionAText = optionAText;
      if (optionAImage !== undefined) updates.optionAImage = optionAImage;
      if (optionBText !== undefined) updates.optionBText = optionBText;
      if (optionBImage !== undefined) updates.optionBImage = optionBImage;
      if (isActive !== undefined) updates.isActive = isActive;
      if (displayOrder !== undefined) updates.displayOrder = displayOrder;
      
      await db.update(faceOffs).set(updates).where(eq(faceOffs.id, id));
      
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
      
      const [updated] = await db.select().from(faceOffs).where(eq(faceOffs.id, id));
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating face-off:", error.message);
      res.status(500).json({ error: "Failed to update face-off" });
    }
  });

  app.delete("/api/admin/face-offs/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminId = req.userId!;
      
      const [existing] = await db.select().from(faceOffs).where(eq(faceOffs.id, id));
      if (!existing) {
        return res.status(404).json({ error: "Face-off not found" });
      }
      
      // Delete associated votes first
      await db.delete(votes).where(and(eq(votes.voteType, 'face_off'), eq(votes.targetId, id)));
      await db.delete(faceOffs).where(eq(faceOffs.id, id));
      
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
      console.error("Error deleting face-off:", error.message);
      res.status(500).json({ error: "Failed to delete face-off" });
    }
  });

  // Reorder face-offs
  app.post("/api/admin/face-offs/reorder", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { orderedIds } = req.body;
      const adminId = req.userId!;
      
      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: "orderedIds must be an array" });
      }
      
      // Update each face-off with its new order
      for (let i = 0; i < orderedIds.length; i++) {
        await db.update(faceOffs).set({ displayOrder: i + 1 }).where(eq(faceOffs.id, orderedIds[i]));
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
      console.error("Error reordering face-offs:", error.message);
      res.status(500).json({ error: "Failed to reorder face-offs" });
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
      const { status, category, headline, subjectText, personId, description, timeline, deadlineAt, imageUrl, seedSupportCount, seedNeutralCount, seedOpposeCount } = req.body;
      const adminId = req.userId!;

      if (!headline || !subjectText || !category) {
        return res.status(400).json({ error: "Headline, subject text, and category are required" });
      }

      const [created] = await db.insert(trendingPolls).values({
        status: status || "draft",
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

      const { status, category, headline, subjectText, personId, description, timeline, deadlineAt, imageUrl, seedSupportCount, seedNeutralCount, seedOpposeCount } = req.body;

      const updates: any = { updatedAt: new Date() };
      if (status !== undefined) updates.status = status;
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
        { headline: "Taylor's Eras Tour pricing", description: "Are dynamic ticket prices fair to fans?", category: "Entertainment", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 234567, personName: "Taylor Swift" },
        { headline: "Spotify's royalty model", description: "Are artists fairly compensated by streaming?", category: "Entertainment", approvePercent: 22, neutralPercent: 28, disapprovePercent: 50, totalVotes: 145678 },
        { headline: "MrBeast's philanthropy", description: "Is it genuine or just content?", category: "Creator", approvePercent: 68, neutralPercent: 20, disapprovePercent: 12, totalVotes: 98765, personName: "MrBeast" },
        { headline: "NFL Sunday Ticket pricing", description: "Is streaming football too expensive?", category: "Sports", approvePercent: 18, neutralPercent: 22, disapprovePercent: 60, totalVotes: 76543 },
        { headline: "Meta's rebrand to AI company", description: "Is the pivot from social media working?", category: "Tech", approvePercent: 25, neutralPercent: 35, disapprovePercent: 40, totalVotes: 112345, personName: "Mark Zuckerberg" },
        { headline: "Drake vs Kendrick beef", description: "Who won the rap battle?", category: "Entertainment", approvePercent: 45, neutralPercent: 15, disapprovePercent: 40, totalVotes: 287654, personName: "Drake" },
        { headline: "LeBron's longevity", description: "Greatest athlete of all time?", category: "Sports", approvePercent: 55, neutralPercent: 25, disapprovePercent: 20, totalVotes: 198765, personName: "LeBron James" },
        { headline: "Crypto regulation", description: "Should governments control digital currencies?", category: "Business", approvePercent: 40, neutralPercent: 20, disapprovePercent: 40, totalVotes: 134567 },
        { headline: "TikTok ban debate", description: "National security vs free speech?", category: "Politics", approvePercent: 35, neutralPercent: 30, disapprovePercent: 35, totalVotes: 256789 },
        { headline: "OpenAI board drama", description: "Was firing Sam Altman justified?", category: "Tech", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 189432, personName: "Sam Altman" },
        { headline: "Beyonce's country album", description: "Authentic exploration or cultural appropriation?", category: "Entertainment", approvePercent: 65, neutralPercent: 20, disapprovePercent: 15, totalVotes: 176543, personName: "Beyonce" },
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
  // CRON ENDPOINTS (Serverless/Vercel Compatible)
  // ===========================================
  // These endpoints can be triggered by external schedulers (Vercel Cron, GitHub Actions, etc.)
  // They use API key authentication instead of user session auth for serverless compatibility
  
  const verifyCronSecret = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    
    // If CRON_SECRET is not set, allow access (development mode)
    if (!cronSecret) {
      console.warn('[Cron] Warning: CRON_SECRET not set. Cron endpoints are unprotected.');
      return next();
    }
    
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing cron secret' });
    }
    
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
  
  // Health check for cron jobs (useful for monitoring)
  app.get("/api/cron/health", (req, res) => {
    res.json({
      status: "ok",
      serverTime: new Date().toISOString(),
      cronSecretConfigured: !!process.env.CRON_SECRET,
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

  const httpServer = createServer(app);

  return httpServer;
}
