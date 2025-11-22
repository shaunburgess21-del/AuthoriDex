import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getTrendingData, generateMockPlatformInsights } from "./api-integrations";
import { db } from "./db";
import { trendSnapshots, trackedPeople, communityInsights, insightVotes, insertCommunityInsightSchema, insertInsightVoteSchema } from "@shared/schema";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { seedSupabasePersons } from "./supabase-seed";
import { supabaseServer } from "./supabase";

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
          communityInsights.createdAt
        )
        .orderBy(desc(sql`CAST(COUNT(CASE WHEN ${insightVotes.voteType} = 'up' THEN 1 END) AS INTEGER) - CAST(COUNT(CASE WHEN ${insightVotes.voteType} = 'down' THEN 1 END) AS INTEGER)`));

      res.json(insights);
    } catch (error) {
      console.error("Error fetching community insights:", error);
      res.status(500).json({ error: "Failed to fetch community insights" });
    }
  });

  // Create a new community insight
  app.post("/api/community-insights", async (req, res) => {
    try {
      const validatedData = insertCommunityInsightSchema.parse(req.body);
      
      const [newInsight] = await db
        .insert(communityInsights)
        .values(validatedData)
        .returning();

      res.json(newInsight);
    } catch (error: any) {
      console.error("Error creating community insight:", error);
      res.status(400).json({ error: error.message || "Failed to create insight" });
    }
  });

  // Vote on a community insight
  app.post("/api/community-insights/:id/vote", async (req, res) => {
    try {
      const { id } = req.params;
      const { userId, voteType } = req.body;

      if (!userId || !voteType || !['up', 'down'].includes(voteType)) {
        return res.status(400).json({ error: "Invalid vote data" });
      }

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

  // Get user's vote status for insights
  app.get("/api/community-insights/:personId/votes/:userId", async (req, res) => {
    try {
      const { personId, userId } = req.params;
      
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

  const httpServer = createServer(app);

  return httpServer;
}
