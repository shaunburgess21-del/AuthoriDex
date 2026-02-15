import { db } from "./db";
import { trackedPeople } from "@shared/schema";

// Top 100 most trending people across all categories (2025)
// Based on research from TIME 100, Forbes, Rolling Stone, and other authoritative sources
const TOP_100_PEOPLE = [
  // Rank 1-2: Top trending
  { name: "Elon Musk", category: "Tech", displayOrder: 1, avatar: "/attached_assets/elon-musk.png", bio: "CEO of Tesla and SpaceX, founder of multiple groundbreaking startups, and a bold innovator driven to advance technology and protect humanity's future." },
  { name: "Donald Trump", category: "Politics", displayOrder: 2, avatar: "/attached_assets/Donald Trump_1763764394332.png", bio: "Former President of the United States and prominent political and business figure." },
  
  // Social Media Creators & Influencers (25)
  { name: "Narendra Modi", category: "Politics", displayOrder: 3, avatar: "/attached_assets/Narendra Modi_1763764500021.png", bio: "Prime Minister of India and influential political leader shaping South Asia's future." },
  { name: "MrBeast", category: "Creator", displayOrder: 4, bio: "YouTube creator known for elaborate challenges, philanthropy, and record-breaking viral content." },
  { name: "Jensen Huang", category: "Tech", displayOrder: 5, avatar: "/attached_assets/Jensen Huang_1763842832854.png", bio: "CEO of NVIDIA and visionary leader driving AI and computing innovation worldwide." },
  { name: "Jeff Bezos", category: "Business", displayOrder: 6, avatar: "/attached_assets/Jeff Bezos_1763842832852.png", bio: "Founder of Amazon and Blue Origin, pioneering e-commerce and space exploration." },
  { name: "Charli D'Amelio", category: "Creator", displayOrder: 7, bio: "Early TikTok superstar known for dance videos and pioneering platform success." },
  { name: "Logan Paul", category: "Creator", displayOrder: 8, bio: "YouTuber, boxer, and entertainer known for high-energy content and controversial projects." },
  { name: "Jake Paul", category: "Creator", displayOrder: 9, bio: "Content creator and boxer who gained fame through YouTube and social media stunts." },
  { name: "Bill Gates", category: "Tech", displayOrder: 10, avatar: "/attached_assets/Bill Gates_1763842832852.png", bio: "Co-founder of Microsoft and philanthropist dedicated to global health and education initiatives." },
  { name: "Joe Rogan", category: "Creator", displayOrder: 11, avatar: "/attached_assets/Joe Rogan_1763842832853.png", bio: "Podcast host and comedian with one of the most popular shows globally." },
  { name: "Satya Nadella", category: "Tech", displayOrder: 12, avatar: "/attached_assets/Satya Nadella_1763842832853.png", bio: "CEO of Microsoft leading the company's cloud and AI transformation." },
  { name: "Sean Evans", category: "Creator", displayOrder: 13, bio: "Host of popular Hot Ones show featuring celebrities eating increasingly spicy chicken." },
  { name: "Theo Von", category: "Creator", displayOrder: 14, bio: "Stand-up comedian and podcast host known for storytelling and engaging audiences." },
  { name: "Sundar Pichai", category: "Tech", displayOrder: 15, avatar: "/attached_assets/Sundar Pichai_1763842832855.jpeg", bio: "CEO of Google and Alphabet, leading innovations in search, AI, and cloud computing." },
  { name: "Sam Altman", category: "Tech", displayOrder: 16, avatar: "/attached_assets/Sam Altman_1763842832856.jpeg", bio: "CEO of OpenAI, pioneering advanced artificial intelligence and AGI development." },
  { name: "Mark Zuckerberg", category: "Tech", displayOrder: 17, avatar: "/attached_assets/Mark Zukerberg_1763842832855.png", bio: "Founder and CEO of Meta, leading social media and metaverse innovation." },
  { name: "Tim Cook", category: "Tech", displayOrder: 18, avatar: "/attached_assets/Tim Cook_1763844637319.png", bio: "CEO of Apple, driving innovation in consumer technology and sustainable business practices." },
  { name: "Lele Pons", category: "Creator", displayOrder: 19, bio: "Entertainment personality known for music, acting, and social media presence." },
  { name: "Druski", category: "Creator", displayOrder: 20, bio: "Comedian known for sketches and comedy content on social platforms." },
  { name: "Brittany Broski", category: "Creator", displayOrder: 21, bio: "Content creator and influencer known for vlogs and entertainment content." },
  { name: "Rachel Sennott", category: "Creator", displayOrder: 22, bio: "Actress and comedian known for film roles and entertainment projects." },
  { name: "Meredith Hayden", category: "Creator", displayOrder: 23, bio: "Content creator and influencer with growing presence on social platforms." },
  { name: "Alan Chikin Chow", category: "Creator", displayOrder: 24, bio: "Social media creator known for viral content and entertainment videos." },
  { name: "Jannat Zubair", category: "Creator", displayOrder: 25, bio: "Indian actress and social media personality with massive fan following." },
  { name: "Virginia", category: "Creator", displayOrder: 26, bio: "Content creator known for lifestyle and entertainment social media content." },
  { name: "Kay Poyer", category: "Creator", displayOrder: 27, bio: "Social media personality and content creator with growing audience reach." },
  
  // Traditional Celebrities (20)
  { name: "Cristiano Ronaldo", category: "Sports", displayOrder: 28, avatar: "/attached_assets/Christiano Ronaldo_1763842832843.png", bio: "Soccer legend and one of the greatest athletes of all time with global influence." },
  { name: "Lionel Messi", category: "Sports", displayOrder: 29, bio: "Iconic footballer known for skills, championships, and global sports influence." },
  { name: "Selena Gomez", category: "Music", displayOrder: 30, bio: "Singer, actress, and producer known for pop hits and cultural impact." },
  { name: "Kim Kardashian", category: "Creator", displayOrder: 31, bio: "Television personality, businesswoman, and cultural influencer with massive reach." },
  { name: "Kylie Jenner", category: "Creator", displayOrder: 32, bio: "Entrepreneur and media personality known for cosmetics business and influence." },
  { name: "Rihanna", category: "Music", displayOrder: 33, bio: "Grammy-winning artist, businesswoman, and cultural icon with global influence." },
  { name: "Beyoncé", category: "Music", displayOrder: 34, bio: "Legendary performer, songwriting powerhouse, and cultural trendsetter." },
  { name: "Taylor Swift", category: "Music", displayOrder: 35, bio: "Multiplatinum artist known for songwriting, career reinvention, and global impact." },
  { name: "Ariana Grande", category: "Music", displayOrder: 36, bio: "Pop sensation known for vocal talent, chart success, and devoted fanbase." },
  { name: "Justin Timberlake", category: "Music", displayOrder: 37, bio: "Singer, dancer, and actor known for music career and entertainment success." },
  { name: "Cardi B", category: "Music", displayOrder: 38, bio: "Grammy-winning rapper known for boldness, hits, and cultural commentary." },
  { name: "Nicki Minaj", category: "Music", displayOrder: 39, bio: "Rap icon known for unique style, lyrical skills, and industry influence." },
  { name: "Chris Brown", category: "Music", displayOrder: 40, bio: "Versatile artist known for dancing, singing, and music production." },
  { name: "Ed Sheeran", category: "Music", displayOrder: 41, bio: "Singer-songwriter known for acoustic hits and record-breaking chart performance." },
  { name: "Ryan Reynolds", category: "Creator", displayOrder: 42, bio: "Actor known for comedy roles and humor both on and off screen." },
  { name: "Dwayne Johnson", category: "Creator", displayOrder: 43, bio: "Action star and businessmen known for charisma and diverse entertainment portfolio." },
  { name: "Sebastian Stan", category: "Creator", displayOrder: 44, bio: "Actor known for film roles and growing entertainment industry presence." },
  { name: "Jeremy Allen White", category: "Creator", displayOrder: 45, bio: "Actor known for acclaimed television and film performances." },
  { name: "Charli XCX", category: "Music", displayOrder: 46, bio: "Electronic music artist known for innovative sound and cultural influence." },
  { name: "PinkPantheress", category: "Music", displayOrder: 47, bio: "Emerging music artist known for genre-blending sounds and creative expression." },

  // Tech & Business Leaders (remaining after promotions)
  { name: "Jack Ma", category: "Business", displayOrder: 48 },
  { name: "Pony Ma", category: "Tech", displayOrder: 49 },
  { name: "Mary Barra", category: "Business", displayOrder: 50 },
  { name: "Mark Cuban", category: "Business", displayOrder: 51 },
  { name: "Sheryl Sandberg", category: "Business", displayOrder: 52 },
  { name: "Arianna Huffington", category: "Business", displayOrder: 53 },
  { name: "Tony Robbins", category: "Business", displayOrder: 54 },
  { name: "Reshma Saujani", category: "Business", displayOrder: 55 },
  { name: "Duncan Wardle", category: "Business", displayOrder: 56 },
  { name: "Karren Brady", category: "Business", displayOrder: 57 },
  { name: "Piers Linney", category: "Business", displayOrder: 58 },
  { name: "Matthew Syed", category: "Business", displayOrder: 59 },
  { name: "Amy Edmondson", category: "Business", displayOrder: 60 },

  // Politicians & World Leaders (14 - Trump moved to top)
  { name: "Xi Jinping", category: "Politics", displayOrder: 61 },
  { name: "Vladimir Putin", category: "Politics", displayOrder: 62 },
  { name: "Claudia Sheinbaum", category: "Politics", displayOrder: 63 },
  { name: "Mark Carney", category: "Politics", displayOrder: 64 },
  { name: "Bernie Sanders", category: "Politics", displayOrder: 65 },
  { name: "Emmanuel Macron", category: "Politics", displayOrder: 66 },
  { name: "Keir Starmer", category: "Politics", displayOrder: 67 },
  { name: "Mike Johnson", category: "Politics", displayOrder: 68 },
  { name: "Hakeem Jeffries", category: "Politics", displayOrder: 69 },
  { name: "Sarah McBride", category: "Politics", displayOrder: 70 },
  { name: "Andy Kim", category: "Politics", displayOrder: 71 },
  { name: "Prabowo Subianto", category: "Politics", displayOrder: 72 },
  { name: "Cyril Ramaphosa", category: "Politics", displayOrder: 73 },

  // Athletes (20)
  { name: "LeBron James", category: "Sports", displayOrder: 74 },
  { name: "Stephen Curry", category: "Sports", displayOrder: 75 },
  { name: "Kylian Mbappé", category: "Sports", displayOrder: 76 },
  { name: "Neymar", category: "Sports", displayOrder: 77 },
  { name: "Giannis Antetokounmpo", category: "Sports", displayOrder: 78 },
  { name: "Anthony Edwards", category: "Sports", displayOrder: 79 },
  { name: "Jayson Tatum", category: "Sports", displayOrder: 80 },
  { name: "Victor Wembanyama", category: "Sports", displayOrder: 81 },
  { name: "Jalen Hurts", category: "Sports", displayOrder: 82 },
  { name: "Dak Prescott", category: "Sports", displayOrder: 83 },
  { name: "Saquon Barkley", category: "Sports", displayOrder: 84 },
  { name: "Shohei Ohtani", category: "Sports", displayOrder: 85 },
  { name: "Juan Soto", category: "Sports", displayOrder: 86 },
  { name: "Kevin Durant", category: "Sports", displayOrder: 87 },
  { name: "Karim Benzema", category: "Sports", displayOrder: 88 },
  { name: "Sachin Tendulkar", category: "Sports", displayOrder: 89 },
  { name: "Tyson Fury", category: "Sports", displayOrder: 90 },
  { name: "Serena Williams", category: "Sports", displayOrder: 91 },
  { name: "Simone Biles", category: "Sports", displayOrder: 92 },
  { name: "Naomi Osaka", category: "Sports", displayOrder: 93 },
  
  // Additional Notable Figures
  { name: "Roger Federer", category: "Sports", displayOrder: 94 },
  { name: "Rafael Nadal", category: "Sports", displayOrder: 95 },
  { name: "Lewis Hamilton", category: "Sports", displayOrder: 96 },
  { name: "Usain Bolt", category: "Sports", displayOrder: 97 },
  { name: "Michael Phelps", category: "Sports", displayOrder: 98 },
  { name: "Tiger Woods", category: "Sports", displayOrder: 99 },
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
