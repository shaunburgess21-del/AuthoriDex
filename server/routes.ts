import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getTrendingData, generateMockPlatformInsights } from "./api-integrations";
import { db } from "./db";
import { trendSnapshots, trackedPeople, communityInsights, insightVotes, insightComments, commentVotes, faceOffs, votes, xpActions, celebrityImages, insertCommunityInsightSchema, insertInsightVoteSchema, insertInsightCommentSchema, insertCommentVoteSchema, insertVoteSchema, type CelebrityProfile, type InsertCelebrityProfile, type FaceOff, type Vote } from "@shared/schema";
import { eq, desc, and, sql, count } from "drizzle-orm";
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

  // Get all trending people
  app.get("/api/trending", async (req, res) => {
    try {
      const { search, category, sort } = req.query;
      
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

      res.json(people);
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
  
  // Get all face-offs with vote counts
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
      
      // Get vote counts for each face-off
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
        
        return {
          ...faceOff,
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

  const httpServer = createServer(app);

  return httpServer;
}
