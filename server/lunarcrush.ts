import { TrendingPerson } from "@shared/schema";

//todo: remove mock functionality - this generates mock trending data
function generateMockTrendingPeople(): TrendingPerson[] {
  const categories = ["Music", "Sports", "Tech", "Entertainment", "Politics", "Business"];
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
    rank: 1,
    trendScore: 10000,
    change24h: (Math.random() - 0.5) * 30,
    change7d: (Math.random() - 0.5) * 60,
    category: "Tech",
  });

  // Rank 2: Donald Trump
  people.push({
    id: "person-2",
    name: "Donald Trump",
    avatar: "/assets/donald-trump.png",
    rank: 2,
    trendScore: 9950,
    change24h: (Math.random() - 0.5) * 30,
    change7d: (Math.random() - 0.5) * 60,
    category: "Politics",
  });
  
  for (let i = 2; i < 100; i++) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[i % lastNames.length];
    const name = `${firstName} ${lastName}${i > 23 ? ` ${Math.floor(i / 24)}` : ''}`;
    
    people.push({
      id: `person-${i + 1}`,
      name,
      avatar: null,
      rank: i + 1,
      trendScore: 10000 - (i * 50) + Math.random() * 100,
      change24h: (Math.random() - 0.5) * 30,
      change7d: (Math.random() - 0.5) * 60,
      category: categories[i % categories.length],
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
