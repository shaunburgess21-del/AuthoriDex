import { db } from "./db";
import { trackedPeople } from "@shared/schema";

// Top 100 most trending people across all categories (2025)
// Based on research from TIME 100, Forbes, Rolling Stone, and other authoritative sources
const TOP_100_PEOPLE = [
  // Social Media Creators & Influencers (25)
  { name: "Kai Cenat", category: "Creator" },
  { name: "MrBeast", category: "Creator" },
  { name: "Khaby Lame", category: "Creator" },
  { name: "Alix Earle", category: "Creator" },
  { name: "Charli D'Amelio", category: "Creator" },
  { name: "Logan Paul", category: "Creator" },
  { name: "Jake Paul", category: "Creator" },
  { name: "PewDiePie", category: "Creator" },
  { name: "Pokimane", category: "Creator" },
  { name: "Keith Lee", category: "Creator" },
  { name: "Sean Evans", category: "Creator" },
  { name: "Theo Von", category: "Creator" },
  { name: "Dave Portnoy", category: "Creator" },
  { name: "Lilly Singh", category: "Creator" },
  { name: "Livvy Dunne", category: "Creator" },
  { name: "Quenlin Blackwell", category: "Creator" },
  { name: "Lele Pons", category: "Creator" },
  { name: "Druski", category: "Creator" },
  { name: "Brittany Broski", category: "Creator" },
  { name: "Rachel Sennott", category: "Creator" },
  { name: "Meredith Hayden", category: "Creator" },
  { name: "Alan Chikin Chow", category: "Creator" },
  { name: "Jannat Zubair", category: "Creator" },
  { name: "Virginia", category: "Creator" },
  { name: "Kay Poyer", category: "Creator" },
  
  // Traditional Celebrities (20)
  { name: "Cristiano Ronaldo", category: "Sports" },
  { name: "Lionel Messi", category: "Sports" },
  { name: "Selena Gomez", category: "Music" },
  { name: "Kim Kardashian", category: "Entertainment" },
  { name: "Kylie Jenner", category: "Entertainment" },
  { name: "Rihanna", category: "Music" },
  { name: "Beyoncé", category: "Music" },
  { name: "Taylor Swift", category: "Music" },
  { name: "Ariana Grande", category: "Music" },
  { name: "Justin Timberlake", category: "Music" },
  { name: "Cardi B", category: "Music" },
  { name: "Nicki Minaj", category: "Music" },
  { name: "Chris Brown", category: "Music" },
  { name: "Ed Sheeran", category: "Music" },
  { name: "Ryan Reynolds", category: "Entertainment" },
  { name: "Dwayne Johnson", category: "Entertainment" },
  { name: "Sebastian Stan", category: "Entertainment" },
  { name: "Jeremy Allen White", category: "Entertainment" },
  { name: "Charli XCX", category: "Music" },
  { name: "PinkPantheress", category: "Music" },

  // Tech & Business Leaders (20)
  { name: "Elon Musk", category: "Tech", avatar: "/attached_assets/elon-musk.png", bio: "CEO of Tesla, SpaceX, Boring Company and Neuralink, entrepreneur and innovator pushing the boundaries of technology and space exploration." },
  { name: "Jensen Huang", category: "Tech" },
  { name: "Mark Zuckerberg", category: "Tech" },
  { name: "Satya Nadella", category: "Tech" },
  { name: "Sundar Pichai", category: "Tech" },
  { name: "Tim Cook", category: "Tech" },
  { name: "Sam Altman", category: "Tech" },
  { name: "Jack Ma", category: "Business" },
  { name: "Pony Ma", category: "Tech" },
  { name: "Mary Barra", category: "Business" },
  { name: "Mark Cuban", category: "Business" },
  { name: "Sheryl Sandberg", category: "Business" },
  { name: "Arianna Huffington", category: "Business" },
  { name: "Tony Robbins", category: "Business" },
  { name: "Reshma Saujani", category: "Business" },
  { name: "Duncan Wardle", category: "Business" },
  { name: "Karren Brady", category: "Business" },
  { name: "Piers Linney", category: "Business" },
  { name: "Matthew Syed", category: "Business" },
  { name: "Amy Edmondson", category: "Business" },

  // Politicians & World Leaders (15)
  { name: "Donald Trump", category: "Politics" },
  { name: "Narendra Modi", category: "Politics" },
  { name: "Xi Jinping", category: "Politics" },
  { name: "Vladimir Putin", category: "Politics" },
  { name: "Claudia Sheinbaum", category: "Politics" },
  { name: "Mark Carney", category: "Politics" },
  { name: "Bernie Sanders", category: "Politics" },
  { name: "Emmanuel Macron", category: "Politics" },
  { name: "Keir Starmer", category: "Politics" },
  { name: "Mike Johnson", category: "Politics" },
  { name: "Hakeem Jeffries", category: "Politics" },
  { name: "Sarah McBride", category: "Politics" },
  { name: "Andy Kim", category: "Politics" },
  { name: "Prabowo Subianto", category: "Politics" },
  { name: "Cyril Ramaphosa", category: "Politics" },

  // Athletes (20)
  { name: "LeBron James", category: "Sports" },
  { name: "Stephen Curry", category: "Sports" },
  { name: "Kylian Mbappé", category: "Sports" },
  { name: "Neymar", category: "Sports" },
  { name: "Giannis Antetokounmpo", category: "Sports" },
  { name: "Anthony Edwards", category: "Sports" },
  { name: "Jayson Tatum", category: "Sports" },
  { name: "Victor Wembanyama", category: "Sports" },
  { name: "Jalen Hurts", category: "Sports" },
  { name: "Dak Prescott", category: "Sports" },
  { name: "Saquon Barkley", category: "Sports" },
  { name: "Shohei Ohtani", category: "Sports" },
  { name: "Juan Soto", category: "Sports" },
  { name: "Kevin Durant", category: "Sports" },
  { name: "Karim Benzema", category: "Sports" },
  { name: "Sachin Tendulkar", category: "Sports" },
  { name: "Tyson Fury", category: "Sports" },
  { name: "Serena Williams", category: "Sports" },
  { name: "Simone Biles", category: "Sports" },
  { name: "Naomi Osaka", category: "Sports" },
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
