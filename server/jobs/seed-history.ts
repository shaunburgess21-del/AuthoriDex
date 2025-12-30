import { db } from "../db";
import { trendSnapshots, trendingPeople } from "@shared/schema";

export async function seedHistoricalSnapshots(daysBack: number = 7): Promise<{ created: number }> {
  console.log(`[Seed] Generating ${daysBack} days of historical trend data...`);
  
  let created = 0;
  
  try {
    const people = await db.select().from(trendingPeople);
    console.log(`[Seed] Processing ${people.length} people`);
    
    const now = new Date();
    
    for (const person of people) {
      const baseScore = person.trendScore || 100000;
      
      for (let day = daysBack; day >= 1; day--) {
        const hoursPerDay = 4;
        
        for (let hour = 0; hour < hoursPerDay; hour++) {
          const timestamp = new Date(now);
          timestamp.setDate(timestamp.getDate() - day);
          timestamp.setHours(hour * 6, 0, 0, 0);
          
          const dayVariation = (Math.random() - 0.5) * 0.3;
          const hourVariation = (Math.random() - 0.5) * 0.05;
          const trendBias = (daysBack - day) / daysBack * 0.15;
          
          const multiplier = 1 + dayVariation + hourVariation - trendBias;
          const trendScore = Math.round(baseScore * Math.max(0.5, Math.min(1.5, multiplier)));
          
          const velocityScore = Math.random() * 50 + 25;
          const massScore = Math.random() * 30 + 20;
          
          await db.insert(trendSnapshots).values({
            personId: person.id,
            timestamp,
            trendScore,
            newsCount: Math.round(Math.random() * 100 + 10),
            searchVolume: Math.round(Math.random() * 500 + 50),
            youtubeViews: 0,
            spotifyFollowers: 0,
            wikiPageviews: Math.round(baseScore / 10 * (0.8 + Math.random() * 0.4)),
            wikiDelta: (Math.random() - 0.5) * 20,
            newsDelta: (Math.random() - 0.5) * 15,
            searchDelta: (Math.random() - 0.5) * 25,
            xQuoteVelocity: Math.random() * 10,
            xReplyVelocity: Math.random() * 15,
            massScore,
            velocityScore,
            confidence: 0.7 + Math.random() * 0.2,
            momentum: Math.random() > 0.5 ? "up" : "down",
            drivers: ["wiki", "search", "x"],
          });
          
          created++;
        }
      }
    }
    
    console.log(`[Seed] Created ${created} historical snapshots`);
  } catch (error) {
    console.error("[Seed] Error:", error);
  }
  
  return { created };
}
