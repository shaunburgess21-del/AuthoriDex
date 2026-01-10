import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getTrendingData, generateMockPlatformInsights } from "./api-integrations";
import { db } from "./db";
import { trendSnapshots, trackedPeople, communityInsights, insightVotes, insightComments, commentVotes, faceOffs, votes, xpActions, celebrityImages, profiles, userFavourites, trendingPeople, creditLedger, adminAuditLog, predictionMarkets, pageViews, insertCommunityInsightSchema, insertInsightVoteSchema, insertInsightCommentSchema, insertCommentVoteSchema, insertVoteSchema, type CelebrityProfile, type InsertCelebrityProfile, type FaceOff, type Vote, type Profile } from "@shared/schema";
import { eq, desc, and, sql, count, gte } from "drizzle-orm";
import { seedSupabasePersons } from "./supabase-seed";
import { supabaseServer } from "./supabase";
import { requireAuth, optionalAuth, type AuthRequest } from "./auth-middleware";
import OpenAI from "openai";
import { gamificationService } from "./services/gamification";

export async function registerRoutes(app: Express): Promise<Server> {
  // Note: Using local PostgreSQL database instead of Supabase
  // Supabase seeding disabled while Supabase is paused
  // seedSupabasePersons().catch(err => {
  //   console.error('Failed to seed Supabase:', err);
  // });

  // ============ PAGE VIEW TRACKING MIDDLEWARE ============
  // Log page views for analytics (only frontend routes, not API calls)
  app.use(async (req, res, next) => {
    // Skip API calls, static assets, and health checks
    if (req.path.startsWith('/api/') || 
        req.path.startsWith('/assets/') ||
        req.path.includes('.') ||
        req.path === '/favicon.ico') {
      return next();
    }
    
    // Log the page view asynchronously (don't block the response)
    setImmediate(async () => {
      try {
        await db.insert(pageViews).values({
          path: req.path,
          userAgent: req.headers['user-agent'] || null,
          referrer: req.headers['referer'] || null,
          sessionId: req.sessionID || null,
        });
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
      
      // If storage is empty, fetch fresh data from APIs
      if (people.length === 0) {
        const freshData = await getTrendingData();
        await storage.updateTrendingPeople(freshData);
        people = freshData;
      }

      // Apply search filter
      if (search && typeof search === 'string') {
        const searchLower = search.toLowerCase();
        people = people.filter(p => 
          p.name.toLowerCase().includes(searchLower) ||
          (p.category && p.category.toLowerCase().includes(searchLower))
        );
      }

      // Apply category filter
      if (category && typeof category === 'string') {
        people = people.filter(p => p.category === category);
      }

      // Apply sorting
      if (sort === 'rank') {
        people.sort((a, b) => a.rank - b.rank);
      } else if (sort === 'score') {
        people.sort((a, b) => b.trendScore - a.trendScore);
      } else if (sort === '24h') {
        people.sort((a, b) => b.change24h - a.change24h);
      } else if (sort === '7d') {
        people.sort((a, b) => b.change7d - a.change7d);
      }

      // Store total count before pagination
      const totalCount = people.length;

      // Apply pagination if limit is provided
      if (limit && typeof limit === 'string') {
        const limitNum = parseInt(limit, 10);
        const offsetNum = offset && typeof offset === 'string' ? parseInt(offset, 10) : 0;
        
        if (!isNaN(limitNum) && limitNum > 0) {
          people = people.slice(offsetNum, offsetNum + limitNum);
        }
      }

      // Return paginated response with totalCount
      res.json({
        data: people,
        totalCount,
        hasMore: limit ? (parseInt(offset as string || '0', 10) + people.length) < totalCount : false
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
      let person = await storage.getTrendingPerson(id);
      
      if (!person) {
        // Try to get from fresh data
        const allPeople = await getTrendingData();
        person = allPeople.find(p => p.id === id);
      }

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
      const snapshots = await db
        .select()
        .from(trendSnapshots)
        .where(and(
          eq(trendSnapshots.personId, id),
          sql`${trendSnapshots.timestamp} >= ${cutoffDate}`
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

  // Refresh trending data (can be called periodically)
  app.post("/api/trending/refresh", async (req, res) => {
    try {
      const freshData = await getTrendingData();
      await storage.updateTrendingPeople(freshData);
      res.json({ success: true, count: freshData.length });
    } catch (error) {
      console.error("Error refreshing trending data:", error);
      res.status(500).json({ error: "Failed to refresh data" });
    }
  });

  // Get top movers (gainers/droppers)
  app.get("/api/trending/movers/:type", async (req, res) => {
    try {
      const { type } = req.params;
      let people = await storage.getTrendingPeople();
      
      if (people.length === 0) {
        const freshData = await getTrendingData();
        await storage.updateTrendingPeople(freshData);
        people = freshData;
      }

      if (type === 'gainers') {
        people = [...people].sort((a, b) => b.change7d - a.change7d).slice(0, 10);
      } else if (type === 'droppers') {
        people = [...people].sort((a, b) => a.change7d - b.change7d).slice(0, 10);
      } else if (type === 'daily') {
        people = [...people].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, 10);
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

  // Get AI-generated celebrity profile with 30-day caching
  app.get("/api/celebrity-profile/:personId", async (req, res) => {
    try {
      const { personId } = req.params;
      const CACHE_DURATION_DAYS = 30;
      
      // Check cache first
      const cached = await storage.getCelebrityProfile(personId);
      if (cached) {
        // Check if cache is still fresh (within 30 days)
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
      
      // Initialize OpenAI with Replit AI Integrations
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });
      
      // Generate comprehensive profile using AI
      // Note: Using gpt-4o for better knowledge of current events (training cutoff: Oct 2023+)
      const currentYear = new Date().getFullYear();
      const prompt = `You are a celebrity data expert. Generate accurate, factual information about ${person.name}.

CRITICAL INSTRUCTIONS:
1. This person's data will be cached for 30 days, so accuracy is essential.
2. If this person is a politician, CEO, or public figure, state their CURRENT title/position as of ${currentYear}.
3. For politicians: If they are currently serving in office (president, prime minister, governor, etc.), this MUST be stated clearly.
4. For business leaders: State their current company and role.
5. Use your most recent knowledge - prefer information from 2023-${currentYear} when relevant.
6. If someone was recently elected or appointed to a new role, mention this prominently.

Return a JSON object with exactly these fields:
{
  "shortBio": "A concise 2-3 sentence summary emphasizing their CURRENT primary role and most notable achievements (150-200 characters)",
  "longBio": "A comprehensive 4-6 sentence biography covering their current position, career highlights, major achievements, and recent notable activities (400-600 characters). This should provide more depth than the short bio.",
  "knownFor": "Their primary areas of expertise or fame, comma-separated (e.g., 'Tech entrepreneurship, SpaceX, Tesla, X/Twitter')",
  "fromCountry": "Their country of origin (full name, e.g., 'South Africa')",
  "fromCountryCode": "ISO 3166-1 alpha-2 code (e.g., 'ZA')",
  "basedIn": "Where they currently live or work (full name, e.g., 'United States')", 
  "basedInCountryCode": "ISO 3166-1 alpha-2 code (e.g., 'US')",
  "estimatedNetWorth": "Estimated net worth in 2025 (e.g., '$250 billion')"
}

Be factual, accurate, and emphasize their current status. Only return the JSON object, nothing else.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
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
      
      res.json(profile);
    } catch (error: any) {
      console.error("Error generating celebrity profile:", error);
      res.status(500).json({ error: "Failed to generate profile", message: error.message });
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
      
      // Get user details from Supabase
      const { data: { user }, error: userError } = await supabaseServer.auth.admin.getUserById(userId);
      
      if (userError || !user) {
        return res.status(400).json({ error: "Could not fetch user details" });
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
      
      // Total page views (all time)
      const [totalViews] = await db.select({ count: sql<number>`count(*)` }).from(pageViews);
      
      // Today's page views
      const [todayViews] = await db.select({ count: sql<number>`count(*)` })
        .from(pageViews)
        .where(gte(pageViews.createdAt, today));
      
      // Last 7 days
      const [weekViews] = await db.select({ count: sql<number>`count(*)` })
        .from(pageViews)
        .where(gte(pageViews.createdAt, sevenDaysAgo));
      
      // Last 30 days
      const [monthViews] = await db.select({ count: sql<number>`count(*)` })
        .from(pageViews)
        .where(gte(pageViews.createdAt, thirtyDaysAgo));
      
      // Top pages (last 7 days)
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
        total: Number(totalViews?.count || 0),
        today: Number(todayViews?.count || 0),
        last7Days: Number(weekViews?.count || 0),
        last30Days: Number(monthViews?.count || 0),
        topPages: topPages.map(p => ({ path: p.path, views: Number(p.views) })),
      });
    } catch (error: any) {
      console.error("Error fetching traffic stats:", error.message);
      res.status(500).json({ error: "Failed to fetch traffic stats" });
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
  
  // Run scoring engine (recalculates rankings using cached API data)
  app.post("/api/admin/run-scoring", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { runQuickScoring } = await import("./jobs/quick-score");
      const result = await runQuickScoring();
      res.json({ 
        success: true, 
        message: "Scoring and rankings updated",
        processed: result.processed,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error("Error running scoring:", error.message);
      res.status(500).json({ error: "Failed to run scoring" });
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
  // Call this every 8 hours via external scheduler
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
  
  // Run scoring and update rankings (uses cached API data)
  // Call this after data ingestion or on-demand to recalculate trending rankings
  // Note: This is different from capture-snapshots - this updates the trending_people table
  app.post("/api/cron/run-scoring", verifyCronSecret, async (req, res) => {
    const startTime = Date.now();
    try {
      const { runQuickScoring } = await import("./jobs/quick-score");
      const result = await runQuickScoring();
      
      res.json({
        success: true,
        message: "Scoring and rankings updated",
        processed: result.processed,
        errors: result.errors,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[Cron] Scoring error:", error);
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

  const httpServer = createServer(app);

  return httpServer;
}
