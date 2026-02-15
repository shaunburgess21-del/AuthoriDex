/**
 * Founding Seed Script
 * 
 * This script applies founding vote counts to specific celebrities.
 * These votes represent the initial sentiment baseline for each celebrity.
 * 
 * Usage: npx tsx scripts/seed-founding-votes.ts
 */

import { db } from "../server/db";
import { trackedPeople, votes } from "../shared/schema";
import { eq } from "drizzle-orm";

// Founding vote data - maps celebrity name to their initial vote distribution
// Format: { name: { love: number, like: number, neutral: number, dislike: number, hate: number } }
const foundingVotes: Record<string, { love: number; like: number; neutral: number; dislike: number; hate: number }> = {
  // Tech leaders
  "Elon Musk": { love: 450, like: 300, neutral: 150, dislike: 200, hate: 180 },
  "Mark Zuckerberg": { love: 120, like: 200, neutral: 350, dislike: 280, hate: 150 },
  "Sam Altman": { love: 280, like: 320, neutral: 200, dislike: 100, hate: 60 },
  "Sundar Pichai": { love: 180, like: 340, neutral: 280, dislike: 80, hate: 40 },
  "Satya Nadella": { love: 200, like: 380, neutral: 250, dislike: 60, hate: 30 },
  "Tim Cook": { love: 220, like: 350, neutral: 280, dislike: 70, hate: 40 },
  "Jensen Huang": { love: 300, like: 320, neutral: 180, dislike: 50, hate: 30 },
  
  // Music artists
  "Taylor Swift": { love: 580, like: 320, neutral: 100, dislike: 80, hate: 60 },
  "Drake": { love: 380, like: 300, neutral: 180, dislike: 120, hate: 80 },
  "Beyoncé": { love: 520, like: 300, neutral: 120, dislike: 60, hate: 40 },
  "Kendrick Lamar": { love: 420, like: 350, neutral: 150, dislike: 50, hate: 30 },
  "The Weeknd": { love: 380, like: 340, neutral: 180, dislike: 60, hate: 40 },
  "Post Malone": { love: 320, like: 300, neutral: 220, dislike: 80, hate: 50 },
  "Ariana Grande": { love: 400, like: 320, neutral: 160, dislike: 80, hate: 50 },
  "Billie Eilish": { love: 350, like: 300, neutral: 200, dislike: 100, hate: 60 },
  
  // Politics
  "Donald Trump": { love: 380, like: 200, neutral: 100, dislike: 250, hate: 350 },
  "Joe Biden": { love: 200, like: 280, neutral: 220, dislike: 280, hate: 180 },
  "Kamala Harris": { love: 180, like: 260, neutral: 280, dislike: 200, hate: 120 },
  "Barack Obama": { love: 420, like: 300, neutral: 150, dislike: 120, hate: 80 },
  "Bernie Sanders": { love: 320, like: 280, neutral: 200, dislike: 150, hate: 100 },
  "Alexandria Ocasio-Cortez": { love: 280, like: 240, neutral: 180, dislike: 200, hate: 150 },
  
  // Sports
  "LeBron James": { love: 450, like: 320, neutral: 120, dislike: 80, hate: 60 },
  "Patrick Mahomes": { love: 380, like: 350, neutral: 180, dislike: 50, hate: 30 },
  "Lionel Messi": { love: 520, like: 300, neutral: 100, dislike: 40, hate: 30 },
  "Cristiano Ronaldo": { love: 480, like: 280, neutral: 120, dislike: 80, hate: 60 },
  "Serena Williams": { love: 400, like: 340, neutral: 160, dislike: 60, hate: 40 },
  "Stephen Curry": { love: 420, like: 350, neutral: 150, dislike: 50, hate: 30 },
  
  // Creators
  "MrBeast": { love: 480, like: 320, neutral: 120, dislike: 60, hate: 40 },
  "PewDiePie": { love: 380, like: 300, neutral: 180, dislike: 80, hate: 60 },
  "Ninja": { love: 280, like: 260, neutral: 280, dislike: 100, hate: 80 },
  "KSI": { love: 320, like: 280, neutral: 220, dislike: 100, hate: 80 },
  "Logan Paul": { love: 240, like: 220, neutral: 240, dislike: 180, hate: 140 },
  "Pokimane": { love: 300, like: 280, neutral: 240, dislike: 100, hate: 80 },
  "Markiplier": { love: 380, like: 320, neutral: 180, dislike: 60, hate: 40 },
  
  // Music
  "Dwayne Johnson": { love: 450, like: 350, neutral: 120, dislike: 50, hate: 30 },
  "Tom Hanks": { love: 480, like: 340, neutral: 100, dislike: 40, hate: 30 },
  "Zendaya": { love: 420, like: 340, neutral: 160, dislike: 50, hate: 30 },
  "Leonardo DiCaprio": { love: 400, like: 350, neutral: 150, dislike: 60, hate: 40 },
  "Kim Kardashian": { love: 280, like: 240, neutral: 200, dislike: 180, hate: 140 },
  "Kylie Jenner": { love: 260, like: 220, neutral: 220, dislike: 180, hate: 140 },
};

// Value mapping for vote types
const voteValues: Record<string, number> = {
  love: 5,
  like: 4,
  neutral: 3,
  dislike: 2,
  hate: 1,
};

async function seedFoundingVotes() {
  console.log("🚀 Starting founding votes seed...\n");
  
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  
  for (const [celebrityName, voteCounts] of Object.entries(foundingVotes)) {
    try {
      // Find the celebrity
      const celebrity = await db
        .select()
        .from(trackedPeople)
        .where(eq(trackedPeople.name, celebrityName))
        .limit(1);
      
      if (celebrity.length === 0) {
        console.log(`⚠️  Skipped: "${celebrityName}" not found in database`);
        skipCount++;
        continue;
      }
      
      const celebrityId = celebrity[0].id;
      let totalVotesAdded = 0;
      
      // Add votes for each sentiment type
      for (const [sentimentType, count] of Object.entries(voteCounts)) {
        const sentimentValue = voteValues[sentimentType];
        
        // Create founding votes in batches
        const votesToInsert = Array(count).fill(null).map(() => ({
          userId: "founding-system",
          voteType: "sentiment",
          targetType: "celebrity",
          targetId: celebrityId.toString(),
          value: sentimentValue.toString(),
          weight: 1,
          metadata: { source: "founding_seed", sentiment: sentimentType },
        }));
        
        // Insert in batches of 100
        const batchSize = 100;
        for (let i = 0; i < votesToInsert.length; i += batchSize) {
          const batch = votesToInsert.slice(i, i + batchSize);
          await db.insert(votes).values(batch);
        }
        
        totalVotesAdded += count;
      }
      
      const totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0);
      const weightedSum = 
        voteCounts.love * 5 + 
        voteCounts.like * 4 + 
        voteCounts.neutral * 3 + 
        voteCounts.dislike * 2 + 
        voteCounts.hate * 1;
      const avgSentiment = (weightedSum / totalVotes).toFixed(2);
      
      console.log(`✅ ${celebrityName}: ${totalVotesAdded} votes seeded (avg sentiment: ${avgSentiment})`);
      successCount++;
      
    } catch (error: any) {
      console.error(`❌ Error seeding "${celebrityName}":`, error.message);
      errorCount++;
    }
  }
  
  console.log("\n📊 Seed Summary:");
  console.log(`   ✅ Success: ${successCount} celebrities`);
  console.log(`   ⚠️  Skipped: ${skipCount} celebrities`);
  console.log(`   ❌ Errors: ${errorCount} celebrities`);
  console.log("\n🎉 Founding votes seed complete!");
}

// Run the seed
seedFoundingVotes()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
