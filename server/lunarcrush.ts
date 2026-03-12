/**
 * @deprecated THIS ENTIRE FILE IS DEPRECATED AND UNUSED
 * 
 * DO NOT IMPORT OR USE ANY FUNCTIONS FROM THIS FILE.
 * 
 * This file generates mock data that can corrupt the trending_people database.
 * Real trending data should ONLY be written by server/jobs/ingest.ts.
 * 
 * This file is kept for historical reference only and should be deleted
 * in a future cleanup if no issues arise.
 */

import { TrendingPerson } from "@shared/schema";

/** @deprecated - generates mock data, do not use */
function generateMockTrendingPeople(): TrendingPerson[] {
  console.error("[DEPRECATED] generateMockTrendingPeople() should not be called!");
  const categories = ["Music", "Sports", "Tech", "Politics", "Business", "Creator"];
  const firstNames = [
    "Taylor", "Elon", "Cristiano", "Kim", "Lionel", "Beyoncé", "LeBron", "Rihanna",
    "Ariana", "Drake", "Selena", "Justin", "Kanye", "Serena", "Roger", "Tom",
    "Oprah", "Ellen", "Will", "Dwayne", "Jennifer", "Brad", "Angelina", "George"
  ];
  const lastNames = [
    "Swift", "Musk", "Ronaldo", "Kardashian", "Messi", "Knowles", "James", "Fenty",
    "Grande", "Graham", "Gomez", "Bieber", "West", "Williams", "Federer", "Brady",
    "Winfrey", "DeGeneres", "Smith", "Johnson", "Lopez", "Pitt", "Jolie", "Clooney"
  ];

  const people: TrendingPerson[] = [];
  
  // Rank 1: Elon Musk
  people.push({
    id: "person-1",
    name: "Elon Musk",
    avatar: null,
    bio: null,
    rank: 1,
    trendScore: 10000,
    fameIndex: 100,
    fameIndexLive: null,
    liveRank: null,
    liveUpdatedAt: null,
    liveDampen: null,
    change24h: (Math.random() - 0.5) * 30,
    change7d: (Math.random() - 0.5) * 60,
    category: "Tech",
    profileViews10m: null,
  });

  // Rank 2: Donald Trump
  people.push({
    id: "person-2",
    name: "Donald Trump",
    avatar: "/assets/donald-trump.png",
    bio: null,
    rank: 2,
    trendScore: 9950,
    fameIndex: 100,
    fameIndexLive: null,
    liveRank: null,
    liveUpdatedAt: null,
    liveDampen: null,
    change24h: (Math.random() - 0.5) * 30,
    change7d: (Math.random() - 0.5) * 60,
    category: "Politics",
    profileViews10m: null,
  });
  
  for (let i = 2; i < 100; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[i % lastNames.length];
    const name = `${firstName} ${lastName}${i > 23 ? ` ${Math.floor(i / 24)}` : ''}`;
    
    people.push({
      id: `person-${i + 1}`,
      name,
      avatar: null,
      bio: null,
      rank: i + 1,
      trendScore: 9900 - ((i - 2) * 50) + Math.random() * 100,
      fameIndex: Math.round((9900 - ((i - 2) * 50) + Math.random() * 100) / 100),
      fameIndexLive: null,
      liveRank: null,
      liveUpdatedAt: null,
      liveDampen: null,
      change24h: (Math.random() - 0.5) * 30,
      change7d: (Math.random() - 0.5) * 60,
      category: categories[i % categories.length],
      profileViews10m: null,
    });
  }

  return people;
}

export async function fetchTrendingData(): Promise<TrendingPerson[]> {
  const apiKey = process.env.LUNARCRUSH_API_KEY;

  // If API key exists, attempt to fetch from LunarCrush
  if (apiKey) {
    try {
      // LunarCrush API integration would go here
      // For now, we'll use mock data as LunarCrush primarily tracks crypto/stocks
      console.log("LunarCrush API key found, but using mock data for celebrity tracking");
    } catch (error) {
      console.error("Error fetching from LunarCrush:", error);
    }
  }

  // Return mock data
  return generateMockTrendingPeople();
}

export async function fetchPersonDetails(personId: string): Promise<TrendingPerson | null> {
  const allPeople = await fetchTrendingData();
  return allPeople.find(p => p.id === personId) || null;
}
