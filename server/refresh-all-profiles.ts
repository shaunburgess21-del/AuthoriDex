import { db } from "./db";
import { trackedPeople, type TrackedPerson, type TrendingPerson } from "@shared/schema";
import { getOrGenerateCelebrityProfile } from "./services/profile-generator";

async function refreshAllProfiles() {
  console.log("Starting bulk profile refresh for all celebrities...");
  
  const people = await db.select().from(trackedPeople);
  console.log(`Found ${people.length} celebrities to refresh.`);
  
  let successCount = 0;
  let errorCount = 0;
  
  const batchSize = 5;
  for (let i = 0; i < people.length; i += batchSize) {
    const batch = people.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (person: TrackedPerson) => {
      try {
        console.log(`\nProcessing: ${person.name}`);

        const result = await getOrGenerateCelebrityProfile(toTrendingPerson(person), { forceRefresh: true });
        successCount++;
        console.log(`  ✓ ${person.name}: ${result.profile.shortBio?.substring(0, 60)}...`);
      } catch (err: any) {
        errorCount++;
        console.error(`  ✗ ${person.name}: ${err.message}`);
      }
    }));
    
    if (i + batchSize < people.length) {
      console.log(`\nWaiting 2 seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`\n========================================`);
  console.log(`Bulk refresh complete!`);
  console.log(`Success: ${successCount}/${people.length}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`========================================`);
  
  process.exit(0);
}

refreshAllProfiles().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

function toTrendingPerson(person: TrackedPerson): TrendingPerson {
  return {
    id: person.id,
    name: person.name,
    avatar: person.avatar ?? null,
    bio: person.bio ?? null,
    rank: person.displayOrder || 9999,
    trendScore: 0,
    fameIndex: 0,
    fameIndexLive: null,
    liveRank: null,
    liveUpdatedAt: null,
    liveDampen: null,
    change24h: null,
    change7d: null,
    category: person.category,
    profileViews10m: null,
  };
}
