import { TrendingPerson, TrackedPerson, trendSnapshots, trackedPeople, ingestionRuns } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, gte, gt, isNotNull, lt } from "drizzle-orm";
import { SCORE_VERSION } from "./scoring/normalize";

interface CelebrityMetrics {
  name: string;
  category: string;
  newsCount: number;
  youtubeViews: number;
  spotifyFollowers: number;
  searchVolume: number;
  trendScore: number;
}

// Helper function to add timeout to fetch with AbortController
function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

// News API Integration
export async function fetchNewsMetrics(celebrityName: string): Promise<number> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return 0;

  try {
    const url = `https://newsapi.org/v2/everything?q="${encodeURIComponent(
      celebrityName
    )}"&language=en&sortBy=publishedAt&pageSize=100&apiKey=${apiKey}`;

    const response = await fetchWithTimeout(url, {}, 5000);
    if (!response.ok) return 0;

    const data = await response.json();
    return data.totalResults || 0;
  } catch (error) {
    console.error(`News API error for ${celebrityName}:`, error);
    return 0;
  }
}

// YouTube API Integration
export async function fetchYouTubeMetrics(celebrityName: string): Promise<number> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return 0;

  try {
    // Step 1: Search for videos
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      celebrityName
    )}&type=video&maxResults=10&key=${apiKey}`;

    const searchResponse = await fetchWithTimeout(searchUrl, {}, 5000);
    if (!searchResponse.ok) return 0;

    const searchData = await searchResponse.json();
    if (!searchData.items || searchData.items.length === 0) return 0;

    // Step 2: Get video statistics
    const videoIds = searchData.items.map((item: any) => item.id.videoId).join(',');
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds}&key=${apiKey}`;

    const statsResponse = await fetchWithTimeout(statsUrl, {}, 5000);
    if (!statsResponse.ok) return 0;

    const statsData = await statsResponse.json();
    
    // Sum up view counts
    const totalViews = statsData.items.reduce((sum: number, video: any) => {
      return sum + parseInt(video.statistics.viewCount || '0');
    }, 0);

    return totalViews;
  } catch (error) {
    console.error(`YouTube API error for ${celebrityName}:`, error);
    return 0;
  }
}

// Spotify API Integration
export async function fetchSpotifyMetrics(artistName: string): Promise<number> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  
  // Fail fast if credentials are missing
  if (!clientId || !clientSecret) {
    console.log('Spotify credentials not configured, skipping...');
    return 0;
  }

  try {
    // Get access token
    const tokenUrl = 'https://accounts.spotify.com/api/token';
    const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const tokenResponse = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    }, 5000);

    if (!tokenResponse.ok) return 0;
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Search for artist
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
      artistName
    )}&type=artist&limit=1`;

    const searchResponse = await fetchWithTimeout(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, 5000);

    if (!searchResponse.ok) return 0;
    const searchData = await searchResponse.json();

    if (!searchData.artists || !searchData.artists.items[0]) return 0;

    const artist = searchData.artists.items[0];
    return artist.followers?.total || 0;
  } catch (error) {
    console.error(`Spotify API error for ${artistName}:`, error);
    return 0;
  }
}

// SERP API (Google Trends) Integration
export async function fetchSearchTrends(query: string): Promise<number> {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return 0;

  try {
    const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(
      query
    )}&data_type=TIMESERIES&date=now 7-d&api_key=${apiKey}`;

    const response = await fetchWithTimeout(url, {}, 5000);
    if (!response.ok) return 0;

    const data = await response.json();
    
    // Extract recent search interest (average of last 7 days)
    if (data.interest_over_time?.timeline_data) {
      const recent = data.interest_over_time.timeline_data.slice(-7);
      const avgInterest = recent.reduce((sum: number, point: any) => 
        sum + (point.values?.[0]?.extracted_value || 0), 0
      ) / recent.length;
      
      return avgInterest * 1000; // Scale up for visualization
    }

    return 0;
  } catch (error) {
    console.error(`SERP API error for ${query}:`, error);
    return 0;
  }
}

// Helper function to calculate percentage change
function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

// Helper function to get historical snapshot from database
async function getHistoricalSnapshot(personId: string, hoursAgo: number): Promise<number | null> {
  const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  
  const [snapshot] = await db
    .select()
    .from(trendSnapshots)
    .where(and(
      eq(trendSnapshots.personId, personId),
      sql`${trendSnapshots.timestamp} <= ${cutoffTime}`
    ))
    .orderBy(desc(trendSnapshots.timestamp), desc(trendSnapshots.id))
    .limit(1);
  
  return snapshot?.trendScore || null;
}

// Generate realistic mock data for design work
function generateMockMetrics(name: string, index: number): CelebrityMetrics {
  // Use name hash for consistent pseudo-random values
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const seed = hash + index;
  
  // Generate varied trend scores (100k-500k range, with clustering at top)
  const baseTrendScore = 500000 - (index * 4000) - (Math.sin(seed) * 20000);
  const trendScore = Math.max(100000, Math.round(baseTrendScore));
  
  // Reverse engineer realistic component metrics
  const newsCount = Math.round((trendScore / 1000) * 0.3 * (0.8 + Math.random() * 0.4));
  const youtubeViews = Math.round(trendScore * 100 * (0.8 + Math.random() * 0.4));
  const spotifyFollowers = Math.round(trendScore * 20 * (0.8 + Math.random() * 0.4));
  const searchVolume = Math.round((trendScore / 1000) * 0.2 * (0.8 + Math.random() * 0.4));
  
  return {
    name,
    category: '', // Will be filled from DB
    newsCount,
    youtubeViews,
    spotifyFollowers,
    searchVolume,
    trendScore,
  };
}

/**
 * DEPRECATED: Mock historical data generation is disabled.
 * 
 * This function previously wrote raw trendScore values to trend_snapshots,
 * bypassing the stabilization logic in trendScore.ts (rate limiting, EMA smoothing,
 * 7-day mass baseline). This caused wild score fluctuations on the leaderboard.
 * 
 * All snapshot writing is now handled exclusively by ingest.ts, which:
 * - Fetches real data from Wikipedia/GDELT/Serper APIs
 * - Applies ±5% hourly rate limiting
 * - Applies EMA smoothing (alpha=0.04)
 * - Uses 7-day Wikipedia average for stable mass scores
 * 
 * @deprecated Do not use - function body is intentionally empty
 */
async function generateMockHistoricalData(personId: string, currentScore: number): Promise<void> {
  console.log("[generateMockHistoricalData] DISABLED - snapshots are written only by ingest.ts with stabilization");
  return;
}

// Aggregate all metrics into a unified trending score
export async function aggregateCelebrityData(): Promise<TrendingPerson[]> {
  // Fetch tracked people from database, ordered by displayOrder
  const celebrities = await db.select().from(trackedPeople).orderBy(trackedPeople.displayOrder);
  
  if (celebrities.length === 0) {
    console.warn('No tracked people found in database');
    return [];
  }

  console.log(`🎭 Using MOCK DATA for ${celebrities.length} tracked people (design mode)`);
  
  const results: CelebrityMetrics[] = [];

  // Generate mock metrics for each celebrity (using displayOrder as index for consistent scoring)
  for (let i = 0; i < celebrities.length; i++) {
    const celeb = celebrities[i];
    
    // Use displayOrder as the index (0 = first place, highest score). Fallback to i if displayOrder is null/undefined
    const orderIndex = celeb.displayOrder ?? i;
    const mockMetrics = generateMockMetrics(celeb.name, orderIndex);
    
    results.push({
      name: celeb.name,
      category: celeb.category,
      newsCount: mockMetrics.newsCount,
      youtubeViews: mockMetrics.youtubeViews,
      spotifyFollowers: mockMetrics.spotifyFollowers,
      searchVolume: mockMetrics.searchVolume,
      trendScore: mockMetrics.trendScore,
    });

    // Skip database snapshot operations for now to speed up initial load
    // Historical data generation can happen in background or on-demand
    // try {
    //   const anyHistory = await db
    //     .select()
    //     .from(trendSnapshots)
    //     .where(eq(trendSnapshots.personId, celeb.id))
    //     .limit(1);
    //   
    //   if (anyHistory.length === 0) {
    //     await generateMockHistoricalData(celeb.id, mockMetrics.trendScore);
    //   }
    //   
    //   await db.insert(trendSnapshots).values({
    //     personId: celeb.id,
    //     newsCount: mockMetrics.newsCount,
    //     youtubeViews: mockMetrics.youtubeViews,
    //     spotifyFollowers: mockMetrics.spotifyFollowers,
    //     searchVolume: mockMetrics.searchVolume,
    //     trendScore: mockMetrics.trendScore,
    //   });
    // } catch (snapshotError) {
    //   // Ignore errors, continue
    // }
  }

  // Check if displayOrder values are unique/differentiated - if not, sort by trendScore for consistent ranking
  const uniqueOrders = new Set(celebrities.map(c => c.displayOrder));
  if (uniqueOrders.size <= 1) {
    // All displayOrder values are the same (or all null), sort by trendScore descending
    console.log('[Aggregate] displayOrder not differentiated, sorting by trendScore');
    results.sort((a, b) => b.trendScore - a.trendScore);
    // Re-sort celebrities to match results order for proper rank assignment
    celebrities.sort((a, b) => {
      const scoreA = results.find(r => r.name === a.name)?.trendScore ?? 0;
      const scoreB = results.find(r => r.name === b.name)?.trendScore ?? 0;
      return scoreB - scoreA;
    });
  }
  
  // Fetch historical baselines using DETERMINISTIC run-based selection
  // Instead of "closest timestamp to 24h ago" (which causes systemic all-red/all-green),
  // we find the closest COMPLETED ingestion run to 24h/7d ago and use its snapshots.
  const now = new Date();
  const time24hAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const time7dAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const BASELINE_24H_WINDOW_MS = 6 * 60 * 60 * 1000; // ±6h strict window for 24h baseline
  const BASELINE_7D_WINDOW_MS = 24 * 60 * 60 * 1000; // ±24h window for 7d baseline
  
  const snapshot24hMap = new Map<string, { score: number; fameIndex: number | null }>();
  const snapshot7dMap = new Map<string, { score: number; fameIndex: number | null }>();
  
  // Find baseline run for 24h: closest completed run to 24h ago within ±6h window
  const [baselineRun24h] = await db
    .select({ id: ingestionRuns.id, finishedAt: ingestionRuns.finishedAt })
    .from(ingestionRuns)
    .where(and(
      eq(ingestionRuns.status, "completed"),
      eq(ingestionRuns.scoreVersion, SCORE_VERSION),
      gt(ingestionRuns.finishedAt, new Date(time24hAgo.getTime() - BASELINE_24H_WINDOW_MS)),
      lt(ingestionRuns.finishedAt, new Date(time24hAgo.getTime() + BASELINE_24H_WINDOW_MS))
    ))
    .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${time24hAgo}::timestamp))`)
    .limit(1);
  
  if (baselineRun24h) {
    const snapshots = await db.select({
      personId: trendSnapshots.personId,
      trendScore: trendSnapshots.trendScore,
      fameIndex: trendSnapshots.fameIndex,
    }).from(trendSnapshots)
      .where(eq(trendSnapshots.runId, baselineRun24h.id));
    
    for (const snap of snapshots) {
      snapshot24hMap.set(snap.personId, { score: snap.trendScore, fameIndex: snap.fameIndex });
    }
  }
  
  // Find baseline run for 7d: closest completed run to 7d ago within ±24h window
  const [baselineRun7d] = await db
    .select({ id: ingestionRuns.id, finishedAt: ingestionRuns.finishedAt })
    .from(ingestionRuns)
    .where(and(
      eq(ingestionRuns.status, "completed"),
      eq(ingestionRuns.scoreVersion, SCORE_VERSION),
      gt(ingestionRuns.finishedAt, new Date(time7dAgo.getTime() - BASELINE_7D_WINDOW_MS)),
      lt(ingestionRuns.finishedAt, new Date(time7dAgo.getTime() + BASELINE_7D_WINDOW_MS))
    ))
    .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${ingestionRuns.finishedAt} - ${time7dAgo}::timestamp))`)
    .limit(1);
  
  if (baselineRun7d) {
    const snapshots = await db.select({
      personId: trendSnapshots.personId,
      trendScore: trendSnapshots.trendScore,
      fameIndex: trendSnapshots.fameIndex,
    }).from(trendSnapshots)
      .where(eq(trendSnapshots.runId, baselineRun7d.id));
    
    for (const snap of snapshots) {
      snapshot7dMap.set(snap.personId, { score: snap.trendScore, fameIndex: snap.fameIndex });
    }
  }
  
  const baselineAge24h = baselineRun24h?.finishedAt 
    ? Math.round((now.getTime() - new Date(baselineRun24h.finishedAt).getTime()) / (1000 * 60 * 60) * 10) / 10
    : null;
  const baselineAge7d = baselineRun7d?.finishedAt
    ? Math.round((now.getTime() - new Date(baselineRun7d.finishedAt).getTime()) / (1000 * 60 * 60) * 10) / 10
    : null;
  
  console.log(`[Aggregate] Run-based baseline: 24h run=${baselineRun24h?.id?.slice(0,8) ?? 'NONE'} (${baselineAge24h}h ago, ${snapshot24hMap.size} snaps), 7d run=${baselineRun7d?.id?.slice(0,8) ?? 'NONE'} (${baselineAge7d}h ago, ${snapshot7dMap.size} snaps)`);
  
  // Convert to TrendingPerson format with historical changes (in displayOrder sequence)
  const trendingPeople: TrendingPerson[] = [];
  
  for (let index = 0; index < celebrities.length; index++) {
    const dbPerson = celebrities[index];
    const celeb = results.find(c => c.name === dbPerson.name);
    
    if (!dbPerson || !celeb) continue;
    
    // Calculate actual percentage changes from historical fameIndex (EMA-smoothed, stable)
    const prev24h = snapshot24hMap.get(dbPerson.id);
    const prev7d = snapshot7dMap.get(dbPerson.id);
    const currentFameIndex = Math.round(celeb.trendScore / 100);
    
    const change24h = prev24h?.fameIndex && prev24h.fameIndex > 0
      ? ((currentFameIndex - prev24h.fameIndex) / prev24h.fameIndex) * 100
      : (prev24h 
        ? ((celeb.trendScore - prev24h.score) / prev24h.score) * 100 
        : null);
    const change7d = prev7d?.fameIndex && prev7d.fameIndex > 0
      ? ((currentFameIndex - prev7d.fameIndex) / prev7d.fameIndex) * 100
      : (prev7d 
        ? ((celeb.trendScore - prev7d.score) / prev7d.score) * 100 
        : null);
    
    trendingPeople.push({
      id: dbPerson.id,
      name: celeb.name,
      avatar: dbPerson.avatar,
      bio: dbPerson.bio,
      rank: index + 1,
      trendScore: celeb.trendScore,
      fameIndex: currentFameIndex,
      fameIndexLive: null,
      liveRank: null,
      liveUpdatedAt: null,
      liveDampen: null,
      change24h: change24h !== null ? Math.round(change24h * 10) / 10 : null,
      change7d: change7d !== null ? Math.round(change7d * 10) / 10 : null,
      category: celeb.category,
      profileViews10m: null,
    });
  }
  
  return trendingPeople;
}

// Cache for aggregated data (short duration for mock data design work)
let cachedData: TrendingPerson[] = [];
let lastFetch: number = 0;
const CACHE_DURATION = 30 * 1000; // 30 seconds (fast refresh for design work with mock data)

// Lock to prevent simultaneous fetches
let fetchInProgress: Promise<TrendingPerson[]> | null = null;

/**
 * @deprecated DO NOT USE - This function generates mock data that corrupts the database.
 * Real trending data should ONLY be written by server/jobs/ingest.ts.
 * API endpoints should ONLY read from the database via storage.getTrendingPeople().
 * This function is kept for historical reference but should not be imported or called.
 */
export async function getTrendingData(): Promise<TrendingPerson[]> {
  console.error("[DEPRECATED] getTrendingData() called - this function should not be used!");
  console.error("[DEPRECATED] Real data comes from ingestion job. API endpoints should read from database only.");
  const now = Date.now();
  
  // Return cached data if still valid
  if (cachedData.length > 0 && now - lastFetch < CACHE_DURATION) {
    console.log('Using cached data');
    return cachedData;
  }

  // If a fetch is already in progress, wait for it
  if (fetchInProgress) {
    console.log('Waiting for ongoing fetch to complete...');
    return fetchInProgress;
  }

  console.log('Fetching fresh celebrity data from APIs...');
  
  // Create the fetch promise and store it
  fetchInProgress = (async () => {
    try {
      // Add a timeout to the entire aggregation process (increased for mock data generation)
      const timeoutPromise = new Promise<TrendingPerson[]>((_, reject) => 
        setTimeout(() => reject(new Error('Data aggregation timeout')), 120000)
      );
      
      const freshData = await Promise.race([
        aggregateCelebrityData(),
        timeoutPromise
      ]);
      
      // Only update cache if we got valid data
      if (freshData && freshData.length > 0) {
        cachedData = freshData;
        lastFetch = now;
        console.log(`Fetched ${cachedData.length} celebrities successfully`);
        return cachedData;
      } else {
        console.warn('No valid data returned from APIs');
        // Return stale cache if available
        if (cachedData.length > 0) {
          console.log('Returning stale cached data (no fresh data available)');
          return cachedData;
        }
        throw new Error('No trending data available');
      }
    } catch (error) {
      console.error('Error fetching trending data:', error);
      // Always try to return cached data on error, even if expired
      if (cachedData.length > 0) {
        console.log('Returning stale cached data due to error');
        return cachedData;
      }
      // If no cache exists, we have to throw
      throw new Error('Failed to fetch trending data and no cache available');
    } finally {
      // Clear the lock when done
      fetchInProgress = null;
    }
  })();
  
  return fetchInProgress;
}

// ========== Platform Insights Mock Data Generator ==========

interface PlatformInsightData {
  platform: string;
  insightType: string;
  metricName: string;
  items: {
    rank: number;
    title: string;
    metricValue: number;
    link?: string;
    imageUrl?: string;
    timestamp: Date;
  }[];
}

// Generate mock platform insights for a specific person
export function generateMockPlatformInsights(personName: string): PlatformInsightData[] {
  // Use name hash for consistent pseudo-random values
  const hash = personName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  const insights: PlatformInsightData[] = [];
  
  // Helper to generate varied metric values with rank decay
  const generateRankedValues = (baseValue: number, count: number = 5) => {
    return Array.from({ length: count }, (_, i) => {
      const rankFactor = 1 - (i * 0.25); // Each rank is ~25% less than previous
      const variance = 0.85 + Math.random() * 0.3; // ±15% variance
      return Math.round(baseValue * rankFactor * variance);
    });
  };
  
  // X/Twitter Insights
  const twitterLikes = generateRankedValues(250000 + (hash % 500000));
  const twitterRetweets = generateRankedValues(50000 + (hash % 100000));
  
  insights.push({
    platform: 'X',
    insightType: 'Most Liked Tweet',
    metricName: 'likes',
    items: twitterLikes.map((likes, i) => ({
      rank: i + 1,
      title: `${personName}'s tweet about ${['innovation', 'the future', 'breaking news', 'latest project', 'personal thoughts'][i]}`,
      metricValue: likes,
      link: `https://x.com/${personName.toLowerCase().replace(/\s+/g, '')}/status/${Math.floor(Math.random() * 1000000000000)}`,
      timestamp: new Date(Date.now() - (i + 1) * 7 * 24 * 60 * 60 * 1000), // weeks ago
    })),
  });
  
  insights.push({
    platform: 'X',
    insightType: 'Most Retweeted',
    metricName: 'retweets',
    items: twitterRetweets.map((retweets, i) => ({
      rank: i + 1,
      title: `${personName}'s announcement about ${['major update', 'collaboration', 'upcoming event', 'industry news', 'exclusive reveal'][i]}`,
      metricValue: retweets,
      link: `https://x.com/${personName.toLowerCase().replace(/\s+/g, '')}/status/${Math.floor(Math.random() * 1000000000000)}`,
      timestamp: new Date(Date.now() - (i + 2) * 6 * 24 * 60 * 60 * 1000),
    })),
  });
  
  // YouTube Insights
  const youtubeViews = generateRankedValues(5000000 + (hash % 10000000));
  const youtubeLikes = generateRankedValues(150000 + (hash % 300000));
  
  insights.push({
    platform: 'YouTube',
    insightType: 'Most Viewed Video',
    metricName: 'views',
    items: youtubeViews.map((views, i) => ({
      rank: i + 1,
      title: `${personName} - ${['Exclusive Interview', 'Behind the Scenes', 'Q&A Session', 'Special Announcement', 'Documentary'][i]}`,
      metricValue: views,
      link: `https://youtube.com/watch?v=${Math.random().toString(36).substring(7)}`,
      imageUrl: `https://picsum.photos/seed/${hash + i}/320/180`,
      timestamp: new Date(Date.now() - (i + 1) * 30 * 24 * 60 * 60 * 1000), // months ago
    })),
  });
  
  insights.push({
    platform: 'YouTube',
    insightType: 'Most Liked Video',
    metricName: 'likes',
    items: youtubeLikes.map((likes, i) => ({
      rank: i + 1,
      title: `${personName} - ${['Highlights Reel', 'Best Moments', 'Compilation', 'Special Event', 'Live Performance'][i]}`,
      metricValue: likes,
      link: `https://youtube.com/watch?v=${Math.random().toString(36).substring(7)}`,
      imageUrl: `https://picsum.photos/seed/${hash + i + 100}/320/180`,
      timestamp: new Date(Date.now() - (i + 2) * 25 * 24 * 60 * 60 * 1000),
    })),
  });
  
  // Instagram Insights
  const instagramLikes = generateRankedValues(800000 + (hash % 1000000));
  const instagramComments = generateRankedValues(25000 + (hash % 50000));
  
  insights.push({
    platform: 'Instagram',
    insightType: 'Top Post by Likes',
    metricName: 'likes',
    items: instagramLikes.map((likes, i) => ({
      rank: i + 1,
      title: `${personName}'s post featuring ${['stunning visuals', 'candid moment', 'special occasion', 'daily life', 'exclusive content'][i]}`,
      metricValue: likes,
      link: `https://instagram.com/p/${Math.random().toString(36).substring(7)}`,
      imageUrl: `https://picsum.photos/seed/${hash + i + 200}/400/400`,
      timestamp: new Date(Date.now() - (i + 1) * 14 * 24 * 60 * 60 * 1000), // weeks ago
    })),
  });
  
  insights.push({
    platform: 'Instagram',
    insightType: 'Most Commented Post',
    metricName: 'comments',
    items: instagramComments.map((comments, i) => ({
      rank: i + 1,
      title: `${personName} shares ${['big news', 'controversial opinion', 'heartfelt message', 'exciting update', 'fan appreciation'][i]}`,
      metricValue: comments,
      link: `https://instagram.com/p/${Math.random().toString(36).substring(7)}`,
      imageUrl: `https://picsum.photos/seed/${hash + i + 300}/400/400`,
      timestamp: new Date(Date.now() - (i + 1) * 10 * 24 * 60 * 60 * 1000),
    })),
  });
  
  // TikTok Insights
  const tiktokViews = generateRankedValues(10000000 + (hash % 20000000));
  const tiktokLikes = generateRankedValues(1200000 + (hash % 2000000));
  
  insights.push({
    platform: 'TikTok',
    insightType: 'Most Viewed Video',
    metricName: 'views',
    items: tiktokViews.map((views, i) => ({
      rank: i + 1,
      title: `${personName}'s viral ${['dance challenge', 'trend', 'comedy skit', 'tutorial', 'duet'][i]}`,
      metricValue: views,
      link: `https://tiktok.com/@${personName.toLowerCase().replace(/\s+/g, '')}/video/${Math.floor(Math.random() * 10000000000000000)}`,
      imageUrl: `https://picsum.photos/seed/${hash + i + 400}/300/400`,
      timestamp: new Date(Date.now() - (i + 1) * 5 * 24 * 60 * 60 * 1000), // days ago
    })),
  });
  
  insights.push({
    platform: 'TikTok',
    insightType: 'Most Liked Video',
    metricName: 'likes',
    items: tiktokLikes.map((likes, i) => ({
      rank: i + 1,
      title: `${personName} ${['trending audio', 'original sound', 'challenge entry', 'reaction video', 'behind the scenes'][i]}`,
      metricValue: likes,
      link: `https://tiktok.com/@${personName.toLowerCase().replace(/\s+/g, '')}/video/${Math.floor(Math.random() * 10000000000000000)}`,
      imageUrl: `https://picsum.photos/seed/${hash + i + 500}/300/400`,
      timestamp: new Date(Date.now() - (i + 2) * 4 * 24 * 60 * 60 * 1000),
    })),
  });
  
  // Spotify Insights (for musicians/artists)
  const spotifyPlays = generateRankedValues(50000000 + (hash % 100000000));
  const spotifyMonthlyListeners = generateRankedValues(5000000 + (hash % 10000000));
  
  insights.push({
    platform: 'Spotify',
    insightType: 'Top Track by Plays',
    metricName: 'plays',
    items: spotifyPlays.map((plays, i) => ({
      rank: i + 1,
      title: `${personName} - ${['Hit Single', 'Chart Topper', 'Fan Favorite', 'Latest Release', 'Classic Track'][i]}`,
      metricValue: plays,
      link: `https://open.spotify.com/track/${Math.random().toString(36).substring(7)}`,
      timestamp: new Date(Date.now() - (i + 1) * 60 * 24 * 60 * 60 * 1000), // months ago
    })),
  });
  
  // News Insights
  const newsViews = generateRankedValues(500000 + (hash % 1000000));
  
  insights.push({
    platform: 'News',
    insightType: 'Top News Story',
    metricName: 'views',
    items: newsViews.map((views, i) => ({
      rank: i + 1,
      title: `${personName} ${['Makes Headlines', 'Featured in Major Story', 'Exclusive Interview', 'Breaking News', 'Special Report'][i]}`,
      metricValue: views,
      link: `https://news.example.com/${personName.toLowerCase().replace(/\s+/g, '-')}-${i + 1}`,
      timestamp: new Date(Date.now() - (i + 1) * 3 * 24 * 60 * 60 * 1000), // days ago
    })),
  });
  
  return insights;
}
