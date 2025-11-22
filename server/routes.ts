import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getTrendingData, generateMockPlatformInsights } from "./api-integrations";
import { db } from "./db";
import { trendSnapshots, trackedPeople } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
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

  const httpServer = createServer(app);

  return httpServer;
}
