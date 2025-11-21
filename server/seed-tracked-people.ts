import { db } from "./db";
import { trackedPeople } from "@shared/schema";

// Top 100 most trending people across all categories (2025)
// Based on research from TIME 100, Forbes, Rolling Stone, and other authoritative sources
const TOP_100_PEOPLE = [
  // Rank 1-2: Top trending
  { name: "Elon Musk", category: "Tech", displayOrder: 1, avatar: "/attached_assets/elon-musk.png", bio: "CEO of Tesla, SpaceX, Boring Company and Neuralink, entrepreneur and innovator pushing the boundaries of technology and space exploration." },
  { name: "Donald Trump", category: "Politics", displayOrder: 2, avatar: "/assets/donald-trump.png", bio: "Former President of the United States and prominent political figure." },
  
  // Social Media Creators & Influencers (25)
  { name: "Kai Cenat", category: "Creator", displayOrder: 3 },
  { name: "MrBeast", category: "Creator", displayOrder: 4 },
  { name: "Khaby Lame", category: "Creator", displayOrder: 5 },
  { name: "Alix Earle", category: "Creator", displayOrder: 6 },
  { name: "Charli D'Amelio", category: "Creator", displayOrder: 7 },
  { name: "Logan Paul", category: "Creator", displayOrder: 8 },
  { name: "Jake Paul", category: "Creator", displayOrder: 9 },
  { name: "PewDiePie", category: "Creator", displayOrder: 10 },
  { name: "Pokimane", category: "Creator", displayOrder: 11 },
  { name: "Keith Lee", category: "Creator", displayOrder: 12 },
  { name: "Sean Evans", category: "Creator", displayOrder: 13 },
  { name: "Theo Von", category: "Creator", displayOrder: 14 },
  { name: "Dave Portnoy", category: "Creator", displayOrder: 15 },
  { name: "Lilly Singh", category: "Creator", displayOrder: 16 },
  { name: "Livvy Dunne", category: "Creator", displayOrder: 17 },
  { name: "Quenlin Blackwell", category: "Creator", displayOrder: 18 },
  { name: "Lele Pons", category: "Creator", displayOrder: 19 },
  { name: "Druski", category: "Creator", displayOrder: 20 },
  { name: "Brittany Broski", category: "Creator", displayOrder: 21 },
  { name: "Rachel Sennott", category: "Creator", displayOrder: 22 },
  { name: "Meredith Hayden", category: "Creator", displayOrder: 23 },
  { name: "Alan Chikin Chow", category: "Creator", displayOrder: 24 },
  { name: "Jannat Zubair", category: "Creator", displayOrder: 25 },
  { name: "Virginia", category: "Creator", displayOrder: 26 },
  { name: "Kay Poyer", category: "Creator", displayOrder: 27 },
  
  // Traditional Celebrities (20)
  { name: "Cristiano Ronaldo", category: "Sports", displayOrder: 28 },
  { name: "Lionel Messi", category: "Sports", displayOrder: 29 },
  { name: "Selena Gomez", category: "Music", displayOrder: 30 },
  { name: "Kim Kardashian", category: "Entertainment", displayOrder: 31 },
  { name: "Kylie Jenner", category: "Entertainment", displayOrder: 32 },
  { name: "Rihanna", category: "Music", displayOrder: 33 },
  { name: "Beyoncé", category: "Music", displayOrder: 34 },
  { name: "Taylor Swift", category: "Music", displayOrder: 35 },
  { name: "Ariana Grande", category: "Music", displayOrder: 36 },
  { name: "Justin Timberlake", category: "Music", displayOrder: 37 },
  { name: "Cardi B", category: "Music", displayOrder: 38 },
  { name: "Nicki Minaj", category: "Music", displayOrder: 39 },
  { name: "Chris Brown", category: "Music", displayOrder: 40 },
  { name: "Ed Sheeran", category: "Music", displayOrder: 41 },
  { name: "Ryan Reynolds", category: "Entertainment", displayOrder: 42 },
  { name: "Dwayne Johnson", category: "Entertainment", displayOrder: 43 },
  { name: "Sebastian Stan", category: "Entertainment", displayOrder: 44 },
  { name: "Jeremy Allen White", category: "Entertainment", displayOrder: 45 },
  { name: "Charli XCX", category: "Music", displayOrder: 46 },
  { name: "PinkPantheress", category: "Music", displayOrder: 47 },

  // Tech & Business Leaders (18 - Elon and Trump moved to top)
  { name: "Jensen Huang", category: "Tech", displayOrder: 48 },
  { name: "Mark Zuckerberg", category: "Tech", displayOrder: 49 },
  { name: "Satya Nadella", category: "Tech", displayOrder: 50 },
  { name: "Sundar Pichai", category: "Tech", displayOrder: 51 },
  { name: "Tim Cook", category: "Tech", displayOrder: 52 },
  { name: "Sam Altman", category: "Tech", displayOrder: 53 },
  { name: "Jack Ma", category: "Business", displayOrder: 54 },
  { name: "Pony Ma", category: "Tech", displayOrder: 55 },
  { name: "Mary Barra", category: "Business", displayOrder: 56 },
  { name: "Mark Cuban", category: "Business", displayOrder: 57 },
  { name: "Sheryl Sandberg", category: "Business", displayOrder: 58 },
  { name: "Arianna Huffington", category: "Business", displayOrder: 59 },
  { name: "Tony Robbins", category: "Business", displayOrder: 60 },
  { name: "Reshma Saujani", category: "Business", displayOrder: 61 },
  { name: "Duncan Wardle", category: "Business", displayOrder: 62 },
  { name: "Karren Brady", category: "Business", displayOrder: 63 },
  { name: "Piers Linney", category: "Business", displayOrder: 64 },
  { name: "Matthew Syed", category: "Business", displayOrder: 65 },
  { name: "Amy Edmondson", category: "Business", displayOrder: 66 },

  // Politicians & World Leaders (14 - Trump moved to top)
  { name: "Narendra Modi", category: "Politics", displayOrder: 67 },
  { name: "Xi Jinping", category: "Politics", displayOrder: 68 },
  { name: "Vladimir Putin", category: "Politics", displayOrder: 69 },
  { name: "Claudia Sheinbaum", category: "Politics", displayOrder: 70 },
  { name: "Mark Carney", category: "Politics", displayOrder: 71 },
  { name: "Bernie Sanders", category: "Politics", displayOrder: 72 },
  { name: "Emmanuel Macron", category: "Politics", displayOrder: 73 },
  { name: "Keir Starmer", category: "Politics", displayOrder: 74 },
  { name: "Mike Johnson", category: "Politics", displayOrder: 75 },
  { name: "Hakeem Jeffries", category: "Politics", displayOrder: 76 },
  { name: "Sarah McBride", category: "Politics", displayOrder: 77 },
  { name: "Andy Kim", category: "Politics", displayOrder: 78 },
  { name: "Prabowo Subianto", category: "Politics", displayOrder: 79 },
  { name: "Cyril Ramaphosa", category: "Politics", displayOrder: 80 },

  // Athletes (20)
  { name: "LeBron James", category: "Sports", displayOrder: 81 },
  { name: "Stephen Curry", category: "Sports", displayOrder: 82 },
  { name: "Kylian Mbappé", category: "Sports", displayOrder: 83 },
  { name: "Neymar", category: "Sports", displayOrder: 84 },
  { name: "Giannis Antetokounmpo", category: "Sports", displayOrder: 85 },
  { name: "Anthony Edwards", category: "Sports", displayOrder: 86 },
  { name: "Jayson Tatum", category: "Sports", displayOrder: 87 },
  { name: "Victor Wembanyama", category: "Sports", displayOrder: 88 },
  { name: "Jalen Hurts", category: "Sports", displayOrder: 89 },
  { name: "Dak Prescott", category: "Sports", displayOrder: 90 },
  { name: "Saquon Barkley", category: "Sports", displayOrder: 91 },
  { name: "Shohei Ohtani", category: "Sports", displayOrder: 92 },
  { name: "Juan Soto", category: "Sports", displayOrder: 93 },
  { name: "Kevin Durant", category: "Sports", displayOrder: 94 },
  { name: "Karim Benzema", category: "Sports", displayOrder: 95 },
  { name: "Sachin Tendulkar", category: "Sports", displayOrder: 96 },
  { name: "Tyson Fury", category: "Sports", displayOrder: 97 },
  { name: "Serena Williams", category: "Sports", displayOrder: 98 },
  { name: "Simone Biles", category: "Sports", displayOrder: 99 },
  { name: "Naomi Osaka", category: "Sports", displayOrder: 100 },
];

export async function seedTrackedPeople() {
  console.log("🌱 Seeding tracked people...");
  
  try {
    // Clear existing data
    await db.delete(trackedPeople);
    
    // Insert all 100 people
    const inserted = await db.insert(trackedPeople).values(TOP_100_PEOPLE).returning();
    
    console.log(`✅ Successfully seeded ${inserted.length} tracked people`);
    return inserted;
  } catch (error) {
    console.error("❌ Error seeding tracked people:", error);
    throw error;
  }
}

// Run if executed directly (ES modules)
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  seedTrackedPeople()
    .then(() => {
      console.log("✨ Seeding complete!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Seeding failed:", error);
      process.exit(1);
    });
}
