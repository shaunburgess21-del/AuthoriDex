import { TrendingPerson } from "@shared/schema";

// Celebrity list to track across all APIs
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
  { name: "Kanye West", category: "Music" },
  { name: "Serena Williams", category: "Sports" },
  { name: "Roger Federer", category: "Sports" },
  { name: "Tom Brady", category: "Sports" },
  { name: "Oprah Winfrey", category: "Entertainment" },
  { name: "Ellen DeGeneres", category: "Entertainment" },
  { name: "Will Smith", category: "Entertainment" },
  { name: "Dwayne Johnson", category: "Entertainment" },
  { name: "Jennifer Lopez", category: "Entertainment" },
  { name: "Brad Pitt", category: "Entertainment" },
  { name: "Angelina Jolie", category: "Entertainment" },
  { name: "George Clooney", category: "Entertainment" },
  { name: "Donald Trump", category: "Politics" },
  { name: "Joe Biden", category: "Politics" },
  { name: "Barack Obama", category: "Politics" },
  { name: "Jeff Bezos", category: "Business" },
  { name: "Mark Zuckerberg", category: "Tech" },
  { name: "Bill Gates", category: "Tech" },
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

// News API Integration
export async function fetchNewsMetrics(celebrityName: string): Promise<number> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return 0;

  try {
    const url = `https://newsapi.org/v2/everything?q="${encodeURIComponent(
      celebrityName
    )}"&language=en&sortBy=publishedAt&pageSize=100&apiKey=${apiKey}`;

    const response = await fetch(url);
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

    const searchResponse = await fetch(searchUrl);
    if (!searchResponse.ok) return 0;

    const searchData = await searchResponse.json();
    if (!searchData.items || searchData.items.length === 0) return 0;

    // Step 2: Get video statistics
    const videoIds = searchData.items.map((item: any) => item.id.videoId).join(',');
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds}&key=${apiKey}`;

    const statsResponse = await fetch(statsUrl);
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
  
  if (!clientId) return 0;

  try {
    // Get access token
    const tokenUrl = 'https://accounts.spotify.com/api/token';
    const authString = Buffer.from(`${clientId}:${clientSecret || ''}`).toString('base64');
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!tokenResponse.ok) return 0;
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Search for artist
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
      artistName
    )}&type=artist&limit=1`;

    const searchResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

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

    const response = await fetch(url);
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

      // Calculate weighted trend score
      const trendScore = 
        (newsCount * 5) +           // News mentions (weight: 5)
        (youtubeViews / 100000) +   // YouTube views (normalized)
        (spotifyFollowers / 10000) + // Spotify followers (normalized)
        (searchVolume * 10);         // Search trends (weight: 10)

      results.push({
        name: celeb.name,
        category: celeb.category,
        newsCount,
        youtubeViews,
        spotifyFollowers,
        searchVolume,
        trendScore,
      });

      // Rate limiting: small delay between API calls
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error aggregating data for ${celeb.name}:`, error);
    }
  }

  // Sort by trend score and convert to TrendingPerson format
  results.sort((a, b) => b.trendScore - a.trendScore);

  return results.map((celeb, index) => ({
    id: `person-${index + 1}`,
    name: celeb.name,
    avatar: null,
    rank: index + 1,
    trendScore: Math.round(celeb.trendScore),
    change24h: (Math.random() - 0.5) * 20, // Mock for now (need historical data)
    change7d: (Math.random() - 0.5) * 40,  // Mock for now (need historical data)
    category: celeb.category,
  }));
}

// Cache for aggregated data (refresh every 30 minutes)
let cachedData: TrendingPerson[] = [];
let lastFetch: number = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

export async function getTrendingData(): Promise<TrendingPerson[]> {
  const now = Date.now();
  
  if (cachedData.length > 0 && now - lastFetch < CACHE_DURATION) {
    return cachedData;
  }

  console.log('Fetching fresh celebrity data from APIs...');
  cachedData = await aggregateCelebrityData();
  lastFetch = now;
  
  return cachedData;
}
