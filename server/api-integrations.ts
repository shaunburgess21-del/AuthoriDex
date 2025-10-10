import { TrendingPerson } from "@shared/schema";

// Celebrity list to track across all APIs (limited to top 15 for performance)
const CELEBRITIES = [
  { name: "Taylor Swift", category: "Music" },
  { name: "Elon Musk", category: "Tech" },
  { name: "Cristiano Ronaldo", category: "Sports" },
  { name: "Kim Kardashian", category: "Entertainment" },
  { name: "Lionel Messi", category: "Sports" },
  { name: "Beyoncé", category: "Music" },
  { name: "LeBron James", category: "Sports" },
  { name: "Rihanna", category: "Music" },
  { name: "Ariana Grande", category: "Music" },
  { name: "Drake", category: "Music" },
  { name: "Selena Gomez", category: "Music" },
  { name: "Justin Bieber", category: "Music" },
  { name: "Donald Trump", category: "Politics" },
  { name: "Dwayne Johnson", category: "Entertainment" },
  { name: "Mark Zuckerberg", category: "Tech" },
];

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

// Aggregate all metrics into a unified trending score
export async function aggregateCelebrityData(): Promise<TrendingPerson[]> {
  const results: CelebrityMetrics[] = [];

  // Fetch metrics for each celebrity (with rate limiting)
  for (let i = 0; i < CELEBRITIES.length; i++) {
    const celeb = CELEBRITIES[i];
    
    try {
      const [newsCount, youtubeViews, spotifyFollowers, searchVolume] = await Promise.all([
        fetchNewsMetrics(celeb.name),
        fetchYouTubeMetrics(celeb.name),
        celeb.category === 'Music' ? fetchSpotifyMetrics(celeb.name) : Promise.resolve(0),
        fetchSearchTrends(celeb.name),
      ]);

      // Calculate balanced weighted trend score
      // Normalize all metrics to similar scales (0-1000 range) then weight them
      const normalizedNews = Math.min(newsCount / 100, 1000);        // News: 0-100 articles = 0-1000
      const normalizedYouTube = Math.min(youtubeViews / 10000000, 1000); // YouTube: 10M views = 1000
      const normalizedSpotify = Math.min(spotifyFollowers / 1000000, 1000); // Spotify: 1M followers = 1000
      const normalizedSearch = Math.min(searchVolume / 100, 1000);   // Search: 0-100 interest = 0-1000
      
      const trendScore = 
        (normalizedNews * 0.30) +      // News mentions: 30% weight
        (normalizedYouTube * 0.25) +   // YouTube popularity: 25% weight
        (normalizedSpotify * 0.25) +   // Spotify followers: 25% weight
        (normalizedSearch * 0.20);     // Search trends: 20% weight

      results.push({
        name: celeb.name,
        category: celeb.category,
        newsCount,
        youtubeViews,
        spotifyFollowers,
        searchVolume,
        trendScore: Math.round(trendScore * 1000), // Scale up for display
      });

      // Rate limiting: small delay between API calls
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error aggregating data for ${celeb.name}:`, error);
      // On error, add with zero scores to maintain list consistency
      results.push({
        name: celeb.name,
        category: celeb.category,
        newsCount: 0,
        youtubeViews: 0,
        spotifyFollowers: 0,
        searchVolume: 0,
        trendScore: 0,
      });
    }
  }

  // Sort by trend score and convert to TrendingPerson format
  results.sort((a, b) => b.trendScore - a.trendScore);

  // Filter out zero-score entries (failed API calls) before mapping
  const validResults = results.filter(r => r.trendScore > 0);
  
  return validResults.map((celeb, index) => ({
    id: `person-${index + 1}`,
    name: celeb.name,
    avatar: null,
    rank: index + 1,
    trendScore: celeb.trendScore,
    change24h: (Math.random() - 0.5) * 20, // TODO: Replace with historical data tracking
    change7d: (Math.random() - 0.5) * 40,  // TODO: Replace with historical data tracking
    category: celeb.category,
  }));
}

// Cache for aggregated data (refresh every 30 minutes)
let cachedData: TrendingPerson[] = [];
let lastFetch: number = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Lock to prevent simultaneous fetches
let fetchInProgress: Promise<TrendingPerson[]> | null = null;

export async function getTrendingData(): Promise<TrendingPerson[]> {
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
      // Add a timeout to the entire aggregation process
      const timeoutPromise = new Promise<TrendingPerson[]>((_, reject) => 
        setTimeout(() => reject(new Error('Data aggregation timeout')), 15000)
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
